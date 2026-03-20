import { BaseChannelPlugin } from "../base-plugin.js"
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
import type { AppConfig } from "../../utils/config.js"
import type { Logger } from "../../utils/logger.js"
import { Bot, ReceiverMode, segment } from "qq-official-bot"

export interface QQPluginDeps {
    appConfig: AppConfig
    logger: Logger
    onMessage?: (event: any) => Promise<void>
}

export class QQPlugin extends BaseChannelPlugin {
    override id = "qq" as ChannelId
    override meta: ChannelMeta = {
        id: "qq" as ChannelId,
        label: "QQ",
        description: "QQ official bot channel integration",
    }

    private readonly appConfig: AppConfig
    private readonly logger: Logger
    private qqBot!: Bot

    override config: ChannelConfigAdapter
    override gateway: ChannelGatewayAdapter
    override messaging: ChannelMessagingAdapter
    override outbound: ChannelOutboundAdapter
    override streaming: ChannelStreamingAdapter
    override threading: ChannelThreadingAdapter

    private readonly _qqThreadMap = new Map<ThreadKey, string>()

    constructor(deps: QQPluginDeps) {
        super()
        this.appConfig = deps.appConfig
        this.logger = deps.logger

        if (!this.appConfig.qq) {
            throw new Error("QQ config is missing but QQPlugin was instantiated")
        }

        this.qqBot = new Bot({
            appid: this.appConfig.qq.appId,
            secret: this.appConfig.qq.secret,
            sandbox: this.appConfig.qq.sandbox,
            removeAt: true,
            logLevel: "info",
            maxRetry: 10,
            intents: [
                "C2C_MESSAGE_CREATE", // Private messages
            ],
            mode: ReceiverMode.WEBSOCKET,
        })

        // 1. Config adapter
        this.config = {
            listAccountIds: () => ["default"],
            resolveAccount: (_id: string) => this.appConfig,
        }

        // 2. Gateway adapter
        this.gateway = {
            startAccount: async (_accountId: string, signal: AbortSignal): Promise<void> => {
                this.qqBot.on("message.private", async (event) => {
                    this.logger.info(`QQ Gateway received message from ${event.user_id}`)
                    if (deps.onMessage) {
                        const syntheticEvent = {
                            event_id: event.id || event.message_id,
                            event_type: "message",
                            chat_id: event.user_id,
                            chat_type: "p2p",
                            message_id: event.id || event.message_id,
                            sender: {
                                sender_id: { open_id: event.user_id },
                                sender_type: "user",
                                tenant_key: "qq"
                            },
                            message: {
                                message_type: "text",
                                content: JSON.stringify({ text: (event as any).raw_message || (event as any).content || "" })
                            },
                            _channelId: "qq",
                        }
                        await deps.onMessage(syntheticEvent as any)
                    }
                })

                await this.qqBot.start()

                signal.addEventListener("abort", () => {
                    this.qqBot.stop().catch(err => this.logger.warn(`Failed to stop QQ bot: ${err}`))
                })
            },
            stopAccount: async (_accountId: string): Promise<void> => {
                await this.qqBot.stop()
            }
        }

        // 3. Messaging adapter
        this.messaging = {
            normalizeInbound: (raw: any): NormalizedMessage => {
                // Since we pass syntheticEvent from Gateway
                const ev = raw

                return {
                    messageId: ev.id || ev.message_id,
                    senderId: ev.user_id,
                    text: ev.raw_message || ev.content || "",
                    chatId: ev.user_id, // For C2C, chat ID is the user ID
                    threadId: ev.user_id, // C2C thread is the user
                    timestamp: ev.timestamp ? new Date(ev.timestamp).getTime() : Date.now(),
                }
            },

            formatOutbound: (msg: OutboundMessage): unknown => {
                return msg.text
            },
        }

        // 4. Outbound adapter
        this.outbound = {
      sendText: async (target: OutboundTarget, text: string): Promise<void> => {
        this.logger.info(`[QQPlugin] Attempting to send message to ${target.address}`)
        try {
          const res = await this.qqBot.messageService.sendPrivateMessage(target.address, [segment.markdown(text)])
          this.logger.info(`[QQPlugin] Message sent successfully. Response: ${JSON.stringify(res)}`)
        } catch (err) {
          this.logger.error(`[QQPlugin] Failed to send message to ${target.address}: ${err}`)
          throw err
        }
      },

      sendImage: async (target: OutboundTarget, filePath: string): Promise<void> => {
        this.logger.info(`[QQPlugin] Attempting to send image to ${target.address}: ${filePath}`)
        try {
          const res = await this.qqBot.messageService.sendPrivateMessage(
            target.address,
            [segment.image(filePath)],
          )
          this.logger.info(`[QQPlugin] Image sent successfully. Response: ${JSON.stringify(res)}`)
        } catch (err) {
          this.logger.error(`[QQPlugin] Failed to send image to ${target.address}: ${err}`)
          throw err
        }
      },
        }

        // 5. Streaming adapter
        this.streaming = {
            createStreamingSession: (target: StreamTarget): StreamingSession => {
                const sessionId = `qq_stream_${Date.now()}`
                let buffer = ""

                const session: StreamingSession = {
                    sessionId,
                    target,
                    pendingUpdates: [],
                    createdAt: Date.now(),
                    flush: async () => {
                        // For QQ, we don't stream edit cards like Feishu, 
                        // We can just accumulate text and send it out or do nothing and wait for SessionIdle.
                        // Typically we don't want to spam C2C messages for every streamed delta.
                        // We will rely on Final/Idle state emitting normal sendText calls,
                        // so streaming flush can be a no-op here.
                    },
                }
                return session
            },
        }

        // 6. Threading adapter
        this.threading = {
            resolveThread: (inbound: NormalizedMessage): ThreadKey => {
                return inbound.chatId as ThreadKey
            },
            mapSession: (threadKey: ThreadKey, sessionId: string): void => {
                this._qqThreadMap.set(threadKey, sessionId)
            },
            getSession: (threadKey: ThreadKey): string | null => {
                return this._qqThreadMap.get(threadKey) ?? null
            },
        }
    }
}
