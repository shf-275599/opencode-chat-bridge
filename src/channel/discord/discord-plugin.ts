import { Client, GatewayIntentBits, Partials, Message as DiscordMessage, TextChannel } from "discord.js"
import { randomUUID } from "node:crypto"
import {
    BaseChannelPlugin,
} from "../base-plugin.js"
import type {
    ChannelId,
    ChannelMeta,
    ChannelConfigAdapter,
    ChannelGatewayAdapter,
    ChannelMessagingAdapter,
    ChannelOutboundAdapter,
    ChannelStreamingAdapter,
    ChannelThreadingAdapter,
    NormalizedMessage,
    OutboundMessage,
    OutboundTarget,
    StreamTarget,
    StreamingSession,
    ThreadKey,
} from "../types.js"
import type { AppConfig, DiscordConfig } from "../../utils/config.js"
import type { Logger } from "../../utils/logger.js"

export interface DiscordPluginDeps {
    appConfig: AppConfig
    logger: Logger
    onMessage?: (event: any) => Promise<void>
}

export class DiscordPlugin extends BaseChannelPlugin {
    override id = "discord" as ChannelId
    override meta: ChannelMeta = {
        id: "discord" as ChannelId,
        label: "Discord",
        description: "Discord Bot integration",
    }

    private readonly appConfig: AppConfig
    private readonly discordConfig: DiscordConfig
    private readonly logger: Logger
    private client: Client | null = null

    override config: ChannelConfigAdapter
    override gateway: ChannelGatewayAdapter
    override messaging: ChannelMessagingAdapter
    override outbound: ChannelOutboundAdapter
    override streaming: ChannelStreamingAdapter
    override threading: ChannelThreadingAdapter

    private readonly _threadMap = new Map<ThreadKey, string>()

    constructor(deps: DiscordPluginDeps) {
        super()
        this.appConfig = deps.appConfig
        this.logger = deps.logger

        if (!this.appConfig.discord) {
            throw new Error("Discord config is missing but DiscordPlugin was instantiated")
        }
        this.discordConfig = this.appConfig.discord

        // 1. Config adapter
        this.config = {
            listAccountIds: () => ["default"],
            resolveAccount: (_id: string) => this.discordConfig,
        }

        // 2. Gateway adapter
        this.gateway = {
            startAccount: async (_accountId: string, _signal: AbortSignal): Promise<void> => {
                this.client = new Client({
                    intents: [
                        GatewayIntentBits.Guilds,
                        GatewayIntentBits.GuildMessages,
                        GatewayIntentBits.MessageContent,
                        GatewayIntentBits.DirectMessages,
                    ],
                    partials: [Partials.Channel, Partials.Message],
                })

                this.client.on("ready", () => {
                    this.logger.info(`[Discord] Bot logged in as ${this.client?.user?.tag}`)
                })

                this.client.on("error", (error) => {
                    this.logger.error(`[Discord] Client error:`, error)
                })

                this.client.on("messageCreate", (msg: DiscordMessage) => {
                    // Ignore own messages or other bots
                    if (msg.author.bot) return

                    // Filter by allowed channel IDs if provided
                    if (this.discordConfig.allowedChannelIds && this.discordConfig.allowedChannelIds.length > 0) {
                        if (!this.discordConfig.allowedChannelIds.includes(msg.channelId)) {
                            return
                        }
                    }

                    // Create synthetic event
                    const syntheticEvent = {
                        event_id: msg.id,
                        event_type: "message",
                        chat_id: msg.channelId,
                        chat_type: "p2p" as const,
                        message_id: msg.id,
                        sender: {
                            sender_id: { open_id: msg.author.id },
                            sender_type: "user",
                            tenant_key: "discord",
                        },
                        message: {
                            message_type: "text",
                            content: JSON.stringify({ text: msg.content }),
                        },
                        _channelId: "discord",
                        msg: msg, // Original message for `normalizeInbound`
                    }

                    if (deps.onMessage) {
                        deps.onMessage(syntheticEvent).catch((err) => {
                            this.logger.error(`[Discord] Error handling message:`, err)
                        })
                    }
                })

                await this.client.login(this.discordConfig.botToken)
                this.logger.info("[DiscordPlugin] Gateway started")
            },

            stopAccount: async (_accountId: string): Promise<void> => {
                if (this.client) {
                    this.client.destroy()
                    this.client = null
                }
                this.logger.info("[DiscordPlugin] Gateway stopped")
            },
        }

        // 3. Messaging adapter
        this.messaging = {
            normalizeInbound: (raw: unknown): NormalizedMessage => {
                const synthetic = raw as { msg: DiscordMessage }
                const discordMsg = synthetic.msg

                return {
                    messageId: discordMsg.id,
                    senderId: discordMsg.author.id,
                    senderName: discordMsg.author.displayName || discordMsg.author.username,
                    text: discordMsg.content.trim(),
                    chatId: discordMsg.channelId,
                    timestamp: discordMsg.createdTimestamp,
                }
            },

            formatOutbound: (msg: OutboundMessage): unknown => {
                return msg.text // Discord accepts markdown
            },
        }

        // 4. Outbound adapter
        const MAX_LENGTH = 2000 // Discord limit
        this.outbound = {
            sendText: async (target: OutboundTarget, text: string): Promise<void> => {
                if (!this.client) {
                    this.logger.error("[Discord] Cannot send message, client not initialized")
                    return
                }

                try {
                    const channel = await this.client.channels.fetch(target.address)
                    if (!channel || !channel.isTextBased()) {
                        this.logger.warn(`[Discord] Cannot send message, channel ${target.address} is not text-based or not found.`)
                        return
                    }

                    let remainingText = text

                    while (remainingText.length > 0) {
                        let chunk = remainingText.slice(0, MAX_LENGTH)

                        if (chunk.length === MAX_LENGTH) {
                            const lastNewline = chunk.lastIndexOf("\n")
                            if (lastNewline > 0 && MAX_LENGTH - lastNewline < 100) {
                                chunk = remainingText.slice(0, lastNewline)
                            }
                        }

                        await (<TextChannel>channel).send(chunk)
                        remainingText = remainingText.slice(chunk.length)
                    }
                } catch (error) {
                    this.logger.error(`[Discord] Failed to send text:`, error)
                }
            },
        }

        // 5. Streaming adapter
        this.streaming = {
            createStreamingSession: (target: StreamTarget): StreamingSession => {
                return {
                    sessionId: randomUUID(),
                    target,
                    pendingUpdates: [],
                    createdAt: Date.now(),
                    flush: async () => { },
                }
            },
        }

        // 6. Threading adapter
        this.threading = {
            resolveThread: (inbound: NormalizedMessage): ThreadKey => {
                if (inbound.threadId) {
                    return `${inbound.chatId}:${inbound.threadId}` as ThreadKey
                }
                return inbound.chatId as ThreadKey
            },
            mapSession: (threadKey: ThreadKey, sessionId: string): void => {
                this._threadMap.set(threadKey, sessionId)
            },
            getSession: (threadKey: ThreadKey): string | null => {
                return this._threadMap.get(threadKey) ?? null
            },
        }
    }
}
