/**
 * FeishuPlugin — channel adapter wrapping existing Feishu modules.
 * Extends BaseChannelPlugin and implements all 6 adapters.
 */

import { readFile } from "node:fs/promises"
import { basename } from "node:path"
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
import type { FeishuApiClient } from "../../feishu/api-client.js"
import type { CardKitClient } from "../../feishu/cardkit-client.js"
import type { Logger } from "../../utils/logger.js"
import type { FeishuMessageEvent, FeishuCardAction } from "../../types.js"
import { buildResponseCard } from "../../feishu/card-builder.js"
import { StreamingCardSession } from "../../streaming/streaming-card.js"
import { createFeishuWSGateway } from "../../feishu/ws-client.js"

// ── Dependencies ──

export interface FeishuPluginDeps {
  appConfig: AppConfig
  feishuClient: FeishuApiClient
  cardkitClient: CardKitClient
  logger: Logger
  onMessage?: (event: FeishuMessageEvent) => Promise<void>
  onCardAction?: (action: FeishuCardAction) => Promise<void>
}

// ── Plugin ──

export class FeishuPlugin extends BaseChannelPlugin {
  override id = "feishu" as ChannelId
  override meta: ChannelMeta = {
    id: "feishu" as ChannelId,
    label: "Feishu",
    description: "\u98de\u4e66 channel integration",
  }

  private readonly appConfig: AppConfig
  private readonly feishuClient: FeishuApiClient
  private readonly cardkitClient: CardKitClient
  private readonly logger: Logger

  // ── Adapters ──

  override config: ChannelConfigAdapter
  override gateway: ChannelGatewayAdapter
  override messaging: ChannelMessagingAdapter
  override outbound: ChannelOutboundAdapter
  override streaming: ChannelStreamingAdapter
  override threading: ChannelThreadingAdapter

  private readonly _feishuThreadMap = new Map<ThreadKey, string>()

  constructor(deps: FeishuPluginDeps) {
    super()
    this.appConfig = deps.appConfig
    this.feishuClient = deps.feishuClient
    this.cardkitClient = deps.cardkitClient
    this.logger = deps.logger

    // 1. Config adapter
    this.config = {
      listAccountIds: () => ["default"],
      resolveAccount: (_id: string) => this.appConfig,
    }

    // 2. Gateway adapter
    this.gateway = {
      startAccount: async (_accountId: string, _signal: AbortSignal): Promise<void> => {
        if (!this.appConfig.feishu) {
          throw new Error("Feishu config missing but FeishuPlugin was started")
        }
        const gw = createFeishuWSGateway({
          appId: this.appConfig.feishu.appId,
          appSecret: this.appConfig.feishu.appSecret,
          onMessage: async (event) => {
            this.logger.info(`Gateway received message: ${event.message_id}`)
            if (deps.onMessage) {
              await deps.onMessage(event)
            }
          },
          onCardAction: deps.onCardAction,
        })
        gw.start()
      },
    }

    // 3. Messaging adapter
    this.messaging = {
      normalizeInbound: (raw: unknown): NormalizedMessage => {
        const event = raw as FeishuMessageEvent
        let text: string
        try {
          const parsed = JSON.parse(event.message.content) as { text?: string }
          text = parsed.text ?? ""
        } catch {
          text = event.message.content
        }

        // Feishu-specific threadId logic:
        // - p2p: no threadId
        // - group with root_id: threadId = root_id
        // - group without root_id: threadId = message_id
        let threadId: string | undefined
        if (event.chat_type === "group") {
          threadId = event.root_id ?? event.message_id
        }

        return {
          messageId: event.message_id,
          senderId: event.sender.sender_id.open_id,
          text,
          chatId: event.chat_id,
          threadId,
          timestamp: Date.now(),
        }
      },

      formatOutbound: (msg: OutboundMessage): unknown => {
        return buildResponseCard(msg.text)
      },
    }

    // 4. Outbound adapter
    this.outbound = {
      sendText: async (target: OutboundTarget, text: string): Promise<void> => {
        await this.feishuClient.sendMessage(target.address, {
          msg_type: "interactive",
          content: JSON.stringify(buildResponseCard(text)),
        })
      },

      sendCard: async (target: OutboundTarget, card: unknown): Promise<void> => {
        await this.feishuClient.sendMessage(target.address, {
          msg_type: "interactive",
          content: JSON.stringify(card),
        })
      },

      sendImage: async (target: OutboundTarget, filePath: string): Promise<void> => {
        this.logger.info(`[FeishuPlugin] Sending image: ${filePath} to ${target.address}`)
        const fileData = await readFile(filePath)
        const imageKey = await this.feishuClient.uploadImage(fileData)
        await this.feishuClient.sendMessage(target.address, {
          msg_type: "image",
          content: JSON.stringify({ image_key: imageKey }),
        })
        this.logger.info(`[FeishuPlugin] Image sent: ${imageKey}`)
      },
    }

    // 5. Streaming adapter
    this.streaming = {
      createStreamingSession: (target: StreamTarget): StreamingSession => {
        const _cardSession = new StreamingCardSession({
          cardkitClient: this.cardkitClient,
          feishuClient: this.feishuClient,
          chatId: target.address,
        })

        const sessionId = `feishu_stream_${Date.now()}`
        const session: StreamingSession = {
          sessionId,
          target,
          pendingUpdates: [],
          createdAt: Date.now(),
          flush: async () => {
            // No-op: flush is handled by tool status cards
          },
        }
        return session
      },
    }

    // 6. Threading adapter (Feishu-specific override)
    // Matches feishu_key logic from index.ts:
    //   p2p → chatId
    //   group with root_id → chatId:rootId
    //   group without root_id → chatId:messageId
    // The normalizeInbound above sets threadId for group chats,
    // so resolveThread just uses the base pattern: chatId or chatId:threadId
    this.threading = {
      resolveThread: (inbound: NormalizedMessage): ThreadKey => {
        if (inbound.threadId) {
          return `${inbound.chatId}:${inbound.threadId}` as ThreadKey
        }
        return inbound.chatId as ThreadKey
      },

      mapSession: (threadKey: ThreadKey, sessionId: string): void => {
        this._feishuThreadMap.set(threadKey, sessionId)
      },

      getSession: (threadKey: ThreadKey): string | null => {
        return this._feishuThreadMap.get(threadKey) ?? null
      },
    }
  }
}