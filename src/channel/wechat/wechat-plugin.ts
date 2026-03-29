import crypto from "node:crypto"
import { basename } from "node:path"
import { readFile } from "node:fs/promises"
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
import { CHANNEL_VERSION } from "./types.js"
import type { WechatConfig, WechatMessage, WechatSession } from "./types.js"
import { getUpdates, sendMessage, sendFileMessage, sendImageMessage, sendVideoMessage, getUploadURL, uploadToCDN, generateAESKey, encryptAES128ECB, md5 } from "./client.js"
import { ensureSession } from "./auth.js"
import { MAX_CONSECUTIVE_FAILURES, RETRY_DELAY_MS, BACKOFF_DELAY_MS, CDNMediaTypeFile, CDNMediaTypeImage, CDNMediaTypeVideo } from "./types.js"

export interface WechatPluginDeps {
  appConfig: AppConfig
  logger: Logger
  onMessage?: (event: any) => Promise<void>
}

export class WechatPlugin extends BaseChannelPlugin {
  override id = "wechat" as ChannelId
  override meta: ChannelMeta = {
    id: "wechat" as ChannelId,
    label: "WeChat",
    description: "微信 iLink Bot API channel integration",
  }

  private readonly appConfig: AppConfig
  private readonly logger: Logger
  private readonly wechatConfig: WechatConfig
  private _session: WechatSession | null = null

  override config: ChannelConfigAdapter
  override gateway: ChannelGatewayAdapter
  override messaging: ChannelMessagingAdapter
  override outbound: ChannelOutboundAdapter
  override streaming: ChannelStreamingAdapter

  private readonly _threadMap = new Map<ThreadKey, string>()
  private readonly _contextTokenMap = new Map<string, string>()

  constructor(deps: WechatPluginDeps) {
    super()
    this.appConfig = deps.appConfig
    this.logger = deps.logger
    this.wechatConfig = deps.appConfig.wechat ?? { enabled: true }

    if (!this.wechatConfig.enabled) {
      throw new Error("WeChat config is missing or disabled but WechatPlugin was instantiated")
    }

    this.config = {
      listAccountIds: () => ["default"],
      resolveAccount: (_id: string) => this.appConfig,
    }

    this.gateway = {
      startAccount: async (_accountId: string, signal: AbortSignal): Promise<void> => {
        const sessionFile = this.wechatConfig.sessionFile
        const session = await ensureSession(sessionFile)
        this._session = session

        this.logger.info(`[WechatPlugin] Connected as Bot: ${session.accountId}`)

        let buf = ""
        let consecutiveFailures = 0

        const poll = async () => {
          while (!signal.aborted) {
            try {
              const resp = await getUpdates(session.baseUrl, session.token, buf)

              const isError =
                (resp.ret !== undefined && resp.ret !== 0) ||
                (resp.errcode !== undefined && resp.errcode !== 0)

              if (isError) {
                consecutiveFailures++
                this.logger.warn(`[WechatPlugin] getUpdates error: ret=${resp.ret}, errcode=${resp.errcode}, errmsg=${resp.errmsg}`)

                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                  this.logger.warn(`[WechatPlugin] ${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off...`)
                  await new Promise((r) => setTimeout(r, BACKOFF_DELAY_MS))
                  consecutiveFailures = 0
                } else {
                  await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
                }
                continue
              }

              consecutiveFailures = 0

              if (resp.get_updates_buf) {
                buf = resp.get_updates_buf
              }

              for (const msg of resp.msgs ?? []) {
                if (msg.message_type !== 1) continue

                this.logger.info(`[WechatPlugin] Received message from ${msg.from_user_id}`)

                if (msg.context_token) {
                  this._contextTokenMap.set(msg.from_user_id, msg.context_token)
                }

                if (deps.onMessage) {
                  const syntheticEvent = {
                    event_id: msg.client_id || crypto.randomUUID(),
                    event_type: "message",
                    chat_id: msg.from_user_id,
                    chat_type: "p2p",
                    message_id: msg.client_id || crypto.randomUUID(),
                    sender: {
                      sender_id: { open_id: msg.from_user_id },
                      sender_type: "user",
                      tenant_key: "wechat",
                    },
                    message: {
                      message_type: "text",
                      content: JSON.stringify({
                        text: this.extractText(msg),
                        context_token: msg.context_token,
                      }),
                    },
                    _channelId: "wechat",
                    _rawMessage: msg,
                  }
                  await deps.onMessage(syntheticEvent)
                }
              }
            } catch (err) {
              consecutiveFailures++
              this.logger.error(`[WechatPlugin] Poll error: ${err}`)

              if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                this.logger.warn(`[WechatPlugin] ${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off...`)
                await new Promise((r) => setTimeout(r, BACKOFF_DELAY_MS))
                consecutiveFailures = 0
              } else {
                await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
              }
            }
          }
          this.logger.info("[WechatPlugin] Gateway polling stopped")
        }

        poll()
      },
    }

    this.messaging = {
      normalizeInbound: (raw: any): NormalizedMessage => {
        const ev = raw
        const content = ev.message?.content ? JSON.parse(ev.message.content) : {}

        // Determine message type from raw message items
        const itemType = raw._rawMessage?.item_list?.[0]?.type ?? 1
        const messageType: "text" | "image" | "voice" | "file" | "video" =
          itemType === 2 ? "image" :
          itemType === 3 ? "voice" :
          itemType === 4 ? "file" :
          itemType === 5 ? "video" :
          "text"

        return {
          messageId: ev.message_id,
          senderId: ev.sender?.sender_id?.open_id || ev.chat_id,
          text: content.text || "",
          chatId: ev.chat_id,
          threadId: ev.chat_id,
          timestamp: Date.now(),
          messageType,
        }
      },

      formatOutbound: (msg: OutboundMessage): unknown => {
        return msg.text
      },
    }

    this.outbound = {
      sendText: async (target: OutboundTarget, text: string): Promise<void> => {
        if (!this._session) {
          this.logger.error("[WechatPlugin] Session not initialized - cannot send message")
          return
        }

        const address = target.address
        const contextToken = this._contextTokenMap.get(address)

        if (!contextToken) {
          this.logger.warn(`[WechatPlugin] No context_token found for user ${address}, message may not be delivered correctly`)
        }

        await sendMessage(
          this._session.baseUrl,
          this._session.token,
          address,
          text,
          contextToken || "",
        )
      },

      sendImage: async (target: OutboundTarget, filePath: string): Promise<void> => {
        if (!this._session) {
          this.logger.error("[WechatPlugin] Session not initialized - cannot send image")
          return
        }

        this.logger.info(`[WechatPlugin] Sending image: ${filePath}`)

        const fileData = await readFile(filePath)
        const fileKey = crypto.randomBytes(16).toString("hex")
        const aesKey = generateAESKey()
        const encrypted = encryptAES128ECB(fileData, aesKey)
        const fileMd5 = md5(fileData)

        const uploadResp = await getUploadURL(this._session.baseUrl, this._session.token, {
          filekey: fileKey,
          media_type: CDNMediaTypeImage,
          to_user_id: target.address,
          rawsize: fileData.length,
          rawfilemd5: fileMd5,
          filesize: encrypted.length,
          no_need_thumb: true,
          aeskey: aesKey,
          base_info: { channel_version: CHANNEL_VERSION },
        })

        const uploadFullUrl = (uploadResp as any).upload_full_url
        let uploadUrl: string
        if (uploadFullUrl) {
          uploadUrl = uploadFullUrl
        } else if (uploadResp.upload_param) {
          uploadUrl = `https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=${uploadResp.upload_param}&filekey=${fileKey}`
        } else {
          throw new Error("Failed to get upload URL: no upload_param or upload_full_url")
        }

        const downloadParam = await uploadToCDN(uploadUrl, encrypted)

        const contextToken = this._contextTokenMap.get(target.address) || ""
        const aesKeyBase64 = Buffer.from(aesKey, "hex").toString("base64")
        await sendImageMessage(
          this._session.baseUrl,
          this._session.token,
          target.address,
          `wcb-${crypto.randomUUID()}`,
          contextToken,
          aesKeyBase64,
          downloadParam,
          fileData.length,
        )

        this.logger.info(`[WechatPlugin] Image sent: ${filePath}`)
      },

      sendFile: async (target: OutboundTarget, filePath: string): Promise<void> => {
        if (!this._session) {
          this.logger.error("[WechatPlugin] Session not initialized - cannot send file")
          return
        }

        this.logger.info(`[WechatPlugin] Sending file: ${filePath}`)

        const fileData = await readFile(filePath)
        const fileName = basename(filePath)

        const aesKey = generateAESKey()
        const encrypted = encryptAES128ECB(fileData, aesKey)
        const fileMd5 = md5(fileData)

        const uploadResp = await getUploadURL(this._session.baseUrl, this._session.token, {
          filekey: fileMd5,
          media_type: CDNMediaTypeFile,
          to_user_id: target.address,
          rawsize: fileData.length,
          rawfilemd5: fileMd5,
          filesize: encrypted.length,
          no_need_thumb: true,
          aeskey: aesKey,
          base_info: { channel_version: CHANNEL_VERSION },
        })

        if (!uploadResp.upload_param) {
          throw new Error("Failed to get upload URL")
        }

        await uploadToCDN(uploadResp.upload_param, encrypted)

        const contextToken = this._contextTokenMap.get(target.address) || ""
        await sendFileMessage(
          this._session.baseUrl,
          this._session.token,
          target.address,
          `wcb-${crypto.randomUUID()}`,
          contextToken,
          aesKey,
          fileMd5,
          encrypted,
          fileData.length,
          fileName,
        )

        this.logger.info(`[WechatPlugin] File sent: ${filePath}`)
      },

      sendAudio: async (target: OutboundTarget, filePath: string): Promise<void> => {
        if (!this._session) {
          this.logger.error("[WechatPlugin] Session not initialized - cannot send audio")
          return
        }

        this.logger.info(`[WechatPlugin] Sending audio: ${filePath}`)

        const fileData = await readFile(filePath)
        const aesKey = generateAESKey()
        const encrypted = encryptAES128ECB(fileData, aesKey)
        const fileMd5 = md5(fileData)

        const uploadResp = await getUploadURL(this._session.baseUrl, this._session.token, {
          filekey: fileMd5,
          media_type: CDNMediaTypeFile,
          to_user_id: target.address,
          rawsize: fileData.length,
          rawfilemd5: fileMd5,
          filesize: encrypted.length,
          no_need_thumb: true,
          aeskey: aesKey,
          base_info: { channel_version: CHANNEL_VERSION },
        })

        if (!uploadResp.upload_param) {
          throw new Error("Failed to get upload URL")
        }

        await uploadToCDN(uploadResp.upload_param, encrypted)

        const contextToken = this._contextTokenMap.get(target.address) || ""
        await sendFileMessage(
          this._session!.baseUrl,
          this._session!.token,
          target.address,
          `wcb-${crypto.randomUUID()}`,
          contextToken,
          aesKey,
          fileMd5,
          encrypted,
          fileData.length,
          basename(filePath),
        )

        this.logger.info(`[WechatPlugin] Audio sent: ${filePath}`)
      },

      sendVideo: async (target: OutboundTarget, filePath: string): Promise<void> => {
        if (!this._session) {
          this.logger.error("[WechatPlugin] Session not initialized - cannot send video")
          return
        }

        this.logger.info(`[WechatPlugin] Sending video: ${filePath}`)

        const fileData = await readFile(filePath)
        const aesKey = generateAESKey()
        const encrypted = encryptAES128ECB(fileData, aesKey)
        const fileMd5 = md5(fileData)

        const uploadResp = await getUploadURL(this._session.baseUrl, this._session.token, {
          filekey: fileMd5,
          media_type: CDNMediaTypeVideo,
          to_user_id: target.address,
          rawsize: fileData.length,
          rawfilemd5: fileMd5,
          filesize: encrypted.length,
          no_need_thumb: true,
          aeskey: aesKey,
          base_info: { channel_version: CHANNEL_VERSION },
        })

        if (!uploadResp.upload_param) {
          throw new Error("Failed to get upload URL")
        }

        await uploadToCDN(uploadResp.upload_param, encrypted)

        const contextToken = this._contextTokenMap.get(target.address) || ""
        await sendVideoMessage(
          this._session!.baseUrl,
          this._session!.token,
          target.address,
          `wcb-${crypto.randomUUID()}`,
          contextToken,
          aesKey,
          fileMd5,
          encrypted,
          fileData.length,
        )

        this.logger.info(`[WechatPlugin] Video sent: ${filePath}`)
      },
    }

    this.streaming = {
      createStreamingSession: (target: StreamTarget): StreamingSession => {
        const sessionId = `wechat_stream_${Date.now()}`

        const session: StreamingSession = {
          sessionId,
          target,
          pendingUpdates: [],
          createdAt: Date.now(),
          flush: async () => {},
        }
        return session
      },
    }

    this.threading = {
      resolveThread: (inbound: NormalizedMessage): ThreadKey => {
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

  private extractText(msg: WechatMessage): string {
    for (const item of msg.item_list ?? []) {
      if (item.type === 1 && item.text_item?.text) {
        return item.text_item.text
      }
      if (item.type === 3 && item.voice_item?.text) {
        return `[语音] ${item.voice_item.text}`
      }
      if (item.type === 2) {
        return "[图片]"
      }
      if (item.type === 4) {
        return `[文件] ${item.file_item?.file_name ?? ""}`
      }
      if (item.type === 5) {
        return "[视频]"
      }
    }
    return "[空消息]"
  }
}
