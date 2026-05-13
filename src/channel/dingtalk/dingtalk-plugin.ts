/**
 * DingTalk channel plugin for opencode-im-bridge
 */

import crypto from "node:crypto"
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
  NormalizedMessage,
  OutboundMessage,
  OutboundTarget,
  StreamTarget,
  StreamingSession,
  ThreadKey,
} from "../types.js"
import type { AppConfig } from "../../utils/config.js"
import type { Logger } from "../../utils/logger.js"
import {
  DINGTALK_API_BASE,
  type DingTalkCallbackEvent,
} from "./types.js"
import { createDingTalkApiClient, type DingTalkApiClient } from "./api-client.js"

interface DingTalkPluginDeps {
  appConfig: AppConfig
  logger: Logger
  onMessage?: (event: any) => Promise<void>
  onCardAction?: (action: any) => Promise<void>
}

const DINGTALK_POLL_TIMEOUT_MS = 25_000
const MAX_CONSECUTIVE_FAILURES = 5
const RETRY_DELAY_MS = 3_000
const BACKOFF_DELAY_MS = 30_000

export class DingTalkPlugin extends BaseChannelPlugin {
  override id = "dingtalk" as ChannelId
  override meta: ChannelMeta = {
    id: "dingtalk" as ChannelId,
    label: "DingTalk",
    description: "钉钉 channel integration",
  }

  private readonly appConfig: AppConfig
  private readonly logger: Logger
  private readonly dingtalkConfig: {
    appKey: string
    appSecret: string
    agentId?: string
    botName?: string
  }
  private client: DingTalkApiClient | null = null

  override config: ChannelConfigAdapter
  override gateway: ChannelGatewayAdapter
  override messaging: ChannelMessagingAdapter
  override outbound: ChannelOutboundAdapter
  override streaming: ChannelStreamingAdapter

  private readonly _threadMap = new Map<ThreadKey, string>()
  private readonly _streamSessionMap = new Map<string, StreamingSession>()
  private readonly _onMessage?: (event: unknown) => Promise<void>

  constructor(deps: DingTalkPluginDeps) {
    super()
    this.appConfig = deps.appConfig
    this.logger = deps.logger
    this._onMessage = deps.onMessage
    this.dingtalkConfig = deps.appConfig.dingtalk ?? {
      appKey: "",
      appSecret: "",
    }

    if (!this.dingtalkConfig.appKey || !this.dingtalkConfig.appSecret) {
      throw new Error("DingTalk config is missing or disabled but DingTalkPlugin was instantiated")
    }

    this.client = createDingTalkApiClient(this.dingtalkConfig)

    this.config = {
      listAccountIds: () => ["default"],
      resolveAccount: (_id: string) => this.appConfig,
    }

    this.gateway = {
      startAccount: async (_accountId: string, signal: AbortSignal): Promise<void> => {
        await this.startPolling(signal)
      },
      stopAccount: async (_accountId: string): Promise<void> => {
        this.stopPolling()
      },
    }

    this.messaging = {
      normalizeInbound: (raw: unknown): NormalizedMessage => {
        const ev = raw as DingTalkCallbackEvent

        let text = ""
        if (ev.text?.content) {
          text = ev.text.content
        }

        const messageType = this.getMessageType(ev.msgtype)

        const senderId = ev.senderStaffId || ev.senderId || ""
        const chatId = ev.conversationId || ""
        const threadId = ev.conversationType === "2" ? chatId : undefined

        return {
          messageId: ev.msgId || crypto.randomUUID(),
          senderId,
          senderName: ev.senderNick,
          text,
          chatId,
          threadId,
          timestamp: ev.createAt ? ev.createAt * 1000 : Date.now(),
          messageType,
        }
      },

      formatOutbound: (msg: OutboundMessage): unknown => {
        return { text: msg.text }
      },
    }

    this.outbound = {
      sendText: async (target: OutboundTarget, text: string): Promise<void> => {
        if (!this.client) {
          this.logger.error("[DingTalkPlugin] Client not initialized - cannot send message")
          return
        }

        await this.client.sendMessage({
          agent_id: this.dingtalkConfig.agentId,
          userid_list: target.address,
          msg: {
            msgtype: "text",
            text: { content: text },
          },
        })
      },

      sendCard: async (target: OutboundTarget, card: unknown): Promise<void> => {
        if (!this.client) {
          this.logger.error("[DingTalkPlugin] Client not initialized - cannot send card")
          return
        }

        const cardObj = card as { card?: Record<string, unknown> }
        const cardContent = cardObj.card || cardObj

        await this.client.sendMessage({
          agent_id: this.dingtalkConfig.agentId,
          userid_list: target.address,
          msg: {
            msgtype: "interactive",
            interactive: { card: cardContent as any },
          },
        })
      },

      sendImage: async (target: OutboundTarget, filePath: string): Promise<void> => {
        if (!this.client) {
          this.logger.error("[DingTalkPlugin] Client not initialized - cannot send image")
          return
        }

        const fileData = await readFile(filePath)
        const mediaId = await this.client.uploadImage(fileData, basename(filePath))

        await this.client.sendMessage({
          agent_id: this.dingtalkConfig.agentId,
          userid_list: target.address,
          msg: {
            msgtype: "image",
            image: { mediaId },
          },
        })
      },

      sendFile: async (target: OutboundTarget, filePath: string): Promise<void> => {
        if (!this.client) {
          this.logger.error("[DingTalkPlugin] Client not initialized - cannot send file")
          return
        }

        const fileData = await readFile(filePath)
        const fileName = basename(filePath)
        const mediaId = await this.client.uploadFile(fileData, fileName)

        await this.client.sendMessage({
          agent_id: this.dingtalkConfig.agentId,
          userid_list: target.address,
          msg: {
            msgtype: "file",
            file: { mediaId },
          },
        })
      },

      sendAudio: async (target: OutboundTarget, filePath: string): Promise<void> => {
        if (!this.client) {
          this.logger.error("[DingTalkPlugin] Client not initialized - cannot send audio")
          return
        }

        const fileData = await readFile(filePath)
        const fileName = basename(filePath)
        const mediaId = await this.client.uploadAudio(fileData, fileName)

        await this.client.sendMessage({
          agent_id: this.dingtalkConfig.agentId,
          userid_list: target.address,
          msg: {
            msgtype: "audio",
            audio: { mediaId },
          },
        })
      },

      sendVideo: async (target: OutboundTarget, filePath: string): Promise<void> => {
        if (!this.client) {
          this.logger.error("[DingTalkPlugin] Client not initialized - cannot send video")
          return
        }

        const fileData = await readFile(filePath)
        const fileName = basename(filePath)
        const mediaId = await this.client.uploadVideo(fileData, fileName)

        await this.client.sendMessage({
          agent_id: this.dingtalkConfig.agentId,
          userid_list: target.address,
          msg: {
            msgtype: "video",
            video: { mediaId, title: fileName, duration: 0 },
          },
        })
      },
    }

    this.streaming = {
      createStreamingSession: (target: StreamTarget): StreamingSession => {
        const sessionId = `dingtalk_stream_${Date.now()}_${Math.random().toString(36).slice(2)}`

        const session: StreamingSession = {
          sessionId,
          target,
          pendingUpdates: [],
          createdAt: Date.now(),
          flush: async () => {
            this.logger.debug(`[DingTalkPlugin] Streaming flush called for session ${sessionId}`)
          },
          close: async (finalText?: string): Promise<void> => {
            this.logger.debug(`[DingTalkPlugin] Streaming close called for session ${sessionId}, finalText length: ${finalText?.length ?? 0}`)
            if (finalText && finalText.length > 0) {
              await this.outbound.sendText({ address: target.address }, finalText)
            }
            this._streamSessionMap.delete(sessionId)
          },
        }

        this._streamSessionMap.set(sessionId, session)
        return session
      },
    }
  }

  private getMessageType(msgType?: string): "text" | "image" | "voice" | "file" | "video" | undefined {
    switch (msgType) {
      case "text":
        return "text"
      case "image":
        return "image"
      case "voice":
        return "voice"
      case "file":
        return "file"
      case "video":
        return "video"
      default:
        return "text"
    }
  }

  private async startPolling(signal: AbortSignal): Promise<void> {
    this.logger.info("[DingTalkPlugin] Starting DingTalk long polling...")

    let buf = ""
    let consecutiveFailures = 0

    const poll = async (): Promise<void> => {
      while (!signal.aborted) {
        try {
          if (!this.client) {
            throw new Error("Client not initialized")
          }

          const token = await this.client.getToken()

          const response = await fetch(
            `${DINGTALK_API_BASE}/v1.0/im/topics/poll`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ topics: [{ topicName: "/cloud板上机器人", offset: buf }] }),
            },
          )

          if (!response.ok) {
            throw new Error(`DingTalk poll failed: ${response.status}`)
          }

          const data = await response.json() as {
            errcode?: number
            errmsg?: string
            results?: Array<{
              topicName?: string
              offset?: string
              data?: string
            }>
          }

          if (data.errcode && data.errcode !== 0) {
            throw new Error(`DingTalk poll error: ${data.errcode} - ${data.errmsg}`)
          }

          consecutiveFailures = 0

          if (data.results && data.results.length > 0) {
            for (const result of data.results) {
              if (result.offset) {
                buf = result.offset
              }

              if (result.data) {
                try {
                  const eventData = JSON.parse(result.data) as DingTalkCallbackEvent
                  this.logger.info(`[DingTalkPlugin] Received event: ${eventData.msgtype} from ${eventData.senderNick || eventData.senderStaffId}`)

                  if (eventData.msgtype) {
                    const syntheticEvent = {
                      ...eventData,
                      _channelId: "dingtalk",
                    }

                    if (this.messaging) {
                      const normalized = this.messaging.normalizeInbound(syntheticEvent)
                      this.logger.info(`[DingTalkPlugin] Normalized message: ${normalized.text.slice(0, 50)}...`)
                    }

                    if (this._onMessage) {
                      await this._onMessage(syntheticEvent)
                    }
                  }
                } catch (parseErr) {
                  this.logger.warn(`[DingTalkPlugin] Failed to parse event data: ${parseErr}`)
                }
              }
            }
          }
        } catch (err) {
          consecutiveFailures++
          this.logger.error(`[DingTalkPlugin] Poll error: ${err}`)

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            this.logger.warn(`[DingTalkPlugin] ${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off...`)
            await new Promise((r) => setTimeout(r, BACKOFF_DELAY_MS))
            consecutiveFailures = 0
          } else {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
          }
        }
      }

      this.logger.info("[DingTalkPlugin] Gateway polling stopped")
    }

    poll().catch((err) => {
      this.logger.error(`[DingTalkPlugin] Polling loop crashed: ${err}`)
    })
  }

  private stopPolling(): void {
    this.logger.info("[DingTalkPlugin] Stopping polling...")
  }
}
