/**
 * TelegramPlugin - channel adapter for Telegram Bot API.
 *
 * Uses long polling (getUpdates) to receive messages and callback queries,
 * and routes them through the standard channel pipeline.
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
import type { AppConfig, TelegramConfig } from "../../utils/config.js"
import type { Logger } from "../../utils/logger.js"
import type { FeishuCardAction } from "../../types.js"
import {
  createTelegramInlineCard,
  decodeTelegramCallbackPayload,
  type TelegramInlineCard,
} from "./telegram-interactive.js"

interface TelegramChat {
  id: number
  first_name?: string
  title?: string
  username?: string
}

interface TelegramUser {
  id: number
  first_name: string
  username?: string
}

interface TelegramMessage {
  message_id: number
  chat: TelegramChat
  from?: TelegramUser
  text?: string
  date: number
}

interface TelegramCallbackQuery {
  id: string
  from: TelegramUser
  data?: string
  message?: TelegramMessage
}

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

interface TelegramApiEnvelope<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096
const TELEGRAM_API_BASE = "https://api.telegram.org"
const TELEGRAM_STREAM_THROTTLE_MS = 900

export interface TelegramPluginDeps {
  appConfig: AppConfig
  logger: Logger
  onMessage?: (event: any) => Promise<void>
  onCardAction?: (action: FeishuCardAction) => Promise<void>
}

export class TelegramPlugin extends BaseChannelPlugin {
  override id = "telegram" as ChannelId
  override meta: ChannelMeta = {
    id: "telegram" as ChannelId,
    label: "Telegram",
    description: "Telegram Bot bridge integration",
  }

  private readonly appConfig: AppConfig
  private readonly telegramConfig: TelegramConfig
  private readonly logger: Logger
  private readonly onMessage?: (event: any) => Promise<void>
  private readonly onCardAction?: (action: FeishuCardAction) => Promise<void>
  private abortController: AbortController | null = null

  override config: ChannelConfigAdapter
  override gateway: ChannelGatewayAdapter
  override messaging: ChannelMessagingAdapter
  override outbound: ChannelOutboundAdapter
  override streaming: ChannelStreamingAdapter
  override threading: ChannelThreadingAdapter

  private readonly threadMap = new Map<ThreadKey, string>()

  constructor(deps: TelegramPluginDeps) {
    super()
    this.appConfig = deps.appConfig
    this.logger = deps.logger
    this.onMessage = deps.onMessage
    this.onCardAction = deps.onCardAction

    if (!this.appConfig.telegram) {
      throw new Error("Telegram config is missing but TelegramPlugin was instantiated")
    }
    this.telegramConfig = this.appConfig.telegram

    this.config = {
      listAccountIds: () => ["default"],
      resolveAccount: () => this.telegramConfig,
    }

    this.gateway = {
      startAccount: async (_accountId: string, signal: AbortSignal): Promise<void> => {
        this.abortController = new AbortController()
        signal.addEventListener("abort", () => {
          this.abortController?.abort()
        })

        this.startPolling().catch((err) => {
          this.logger.error(`[TelegramPlugin] Poll loop crashed: ${err}`)
        })

        this.registerCommands().catch((err) => {
          this.logger.warn(`[TelegramPlugin] Failed to register commands: ${err}`)
        })

        this.logger.info("[TelegramPlugin] Gateway started (long polling)")
      },

      stopAccount: async (): Promise<void> => {
        this.abortController?.abort()
        this.abortController = null
        this.logger.info("[TelegramPlugin] Gateway stopped")
      },
    }

    this.messaging = {
      normalizeInbound: (raw: unknown): NormalizedMessage => {
        const update = raw as TelegramUpdate
        const message = update.message ?? update.callback_query?.message
        if (!message) {
          throw new Error("Telegram update does not contain a message")
        }
        const sender = update.callback_query?.from ?? message.from
        const chatId = String(message.chat.id)
        const senderId = sender ? String(sender.id) : chatId
        const senderName = sender?.username ?? sender?.first_name

        return {
          messageId: String(message.message_id),
          senderId,
          senderName,
          text: message.text ?? "",
          chatId,
          timestamp: message.date * 1000,
        }
      },

      formatOutbound: (msg: OutboundMessage): unknown => msg.text,
    }

    this.outbound = {
      sendText: async (target: OutboundTarget, text: string): Promise<void> => {
        const chunks = splitMessage(text, TELEGRAM_MAX_MESSAGE_LENGTH)
        for (const chunk of chunks) {
          await this.sendHtmlMessage(target.address, chunk)
        }
      },

      sendCard: async (target: OutboundTarget, card: unknown): Promise<void> => {
        const inlineCard = card as TelegramInlineCard
        await this.callApi("sendMessage", {
          chat_id: target.address,
          text: inlineCard.text,
          parse_mode: inlineCard.parse_mode ?? "HTML",
          reply_markup: inlineCard.reply_markup,
        })
      },

      sendImage: async (target: OutboundTarget, filePath: string): Promise<void> => {
        this.logger.info(`[TelegramPlugin] Attempting to send image to ${target.address}: ${filePath}`)
        try {
          const fileData = await readFile(filePath)
          const fileName = basename(filePath)
          await this.callApiMultipart("sendPhoto", target.address, "photo", fileData, fileName)
          this.logger.info(`[TelegramPlugin] Image sent successfully: ${filePath}`)
        } catch (err) {
          this.logger.error(`[TelegramPlugin] Failed to send image to ${target.address}: ${err}`)
          throw err
        }
      },
    }

    this.streaming = {
      createStreamingSession: (target: StreamTarget): StreamingSession => {
        const sessionId = `telegram_stream_${Date.now()}`
        let lastFlushAt = 0
        let pendingTimer: ReturnType<typeof setTimeout> | null = null
        let pendingPromise: Promise<void> | null = null
        let resolvePending: (() => void) | null = null
        const session: StreamingSession = {
          sessionId,
          target,
          pendingUpdates: [],
          createdAt: Date.now(),
          lastMessageId: typeof target.context?.messageId === "number" || typeof target.context?.messageId === "string"
            ? (target.context.messageId as string | number)
            : undefined,
          lastRenderedText: "",
          flush: async (): Promise<void> => {
            const performFlush = async (): Promise<void> => {
              pendingTimer = null
              pendingPromise = null
              resolvePending = null
              const nextText = session.pendingUpdates.at(-1)?.trim() ?? ""
              if (!nextText || nextText === session.lastRenderedText) return
              const streamingText = this.buildStreamingPreview(nextText)
              await this.upsertStreamingMessage(target.address, session, streamingText)
              session.lastRenderedText = nextText
              lastFlushAt = Date.now()
            }

            const waitMs = Math.max(0, TELEGRAM_STREAM_THROTTLE_MS - (Date.now() - lastFlushAt))
            if (pendingPromise) return pendingPromise

            pendingPromise = new Promise<void>((resolve) => {
              resolvePending = resolve
            })

            if (waitMs === 0) {
              await performFlush().finally(() => {
                resolvePending?.()
              })
              return
            }

            pendingTimer = setTimeout(() => {
              performFlush()
                .catch((err) => {
                  this.logger.warn(`[TelegramPlugin] Streaming flush failed: ${err}`)
                })
                .finally(() => {
                  resolvePending?.()
                })
            }, waitMs)
            return pendingPromise
          },
          close: async (finalText?: string): Promise<void> => {
            if (pendingTimer) {
              clearTimeout(pendingTimer)
              pendingTimer = null
            }
            pendingPromise = null
            resolvePending = null

            const content = (finalText ?? session.pendingUpdates.at(-1) ?? "").trim()
            if (!content) return

            const chunks = splitMessage(content, TELEGRAM_MAX_MESSAGE_LENGTH)
            if (chunks.length === 0) return

            await this.upsertStreamingMessage(target.address, session, chunks[0]!)
            session.lastRenderedText = content

            for (const chunk of chunks.slice(1)) {
              await this.sendHtmlMessage(target.address, chunk)
            }
          },
        }
        return session
      },
    }

    this.threading = {
      resolveThread: (inbound: NormalizedMessage): ThreadKey => inbound.chatId as ThreadKey,
      mapSession: (threadKey: ThreadKey, sessionId: string): void => {
        this.threadMap.set(threadKey, sessionId)
      },
      getSession: (threadKey: ThreadKey): string | null => {
        return this.threadMap.get(threadKey) ?? null
      },
    }
  }

  private async callApi<T = unknown>(method: string, params: Record<string, unknown>): Promise<TelegramApiEnvelope<T>> {
    const token = this.telegramConfig.botToken
    const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    })
    const data = (await res.json()) as TelegramApiEnvelope<T>

    if (!data.ok) {
      this.logger.error(`[TelegramPlugin] API Error (${method}): ${data.description}`, {
        error_code: data.error_code,
        params,
      })
      throw new Error(`Telegram API error (${method}): ${data.description ?? "unknown"}`)
    }

    return data
  }

  private async callApiMultipart(
    method: string,
    chatId: string,
    fieldName: string,
    fileData: Uint8Array,
    fileName: string,
  ): Promise<void> {
    const token = this.telegramConfig.botToken
    const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`

    const form = new FormData()
    form.append("chat_id", chatId)
    form.append(fieldName, new Blob([fileData]), fileName)

    const res = await fetch(url, { method: "POST", body: form })
    const data = (await res.json()) as TelegramApiEnvelope<unknown>

    if (!data.ok) {
      this.logger.error(`[TelegramPlugin] API Error (${method}): ${data.description}`, {
        error_code: data.error_code,
        chatId,
        fileName,
      })
      throw new Error(`Telegram API error (${method}): ${data.description ?? "unknown"}`)
    }
  }

  private async sendHtmlMessage(chatId: string, text: string): Promise<void> {
    const html = mdToHtml(text)
    try {
      await this.callApi("sendMessage", {
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
      })
    } catch (err: any) {
      this.logger.warn(`[TelegramPlugin] HTML send failed, falling back to plain text: ${err.message}`)
      await this.callApi("sendMessage", {
        chat_id: chatId,
        text,
      })
    }
  }

  private buildStreamingPreview(text: string): string {
    if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
      return text
    }

    const preview = text.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - 48).trimEnd()
    return `${preview}\n\n[Streaming preview truncated. Full reply follows.]`
  }

  private async upsertStreamingMessage(chatId: string, session: StreamingSession, text: string): Promise<void> {
    const html = mdToHtml(text)

    if (session.lastMessageId) {
      try {
        await this.callApi("editMessageText", {
          chat_id: chatId,
          message_id: session.lastMessageId,
          text: html,
          parse_mode: "HTML",
        })
        return
      } catch (err: any) {
        if (!String(err.message).includes("message is not modified")) {
          this.logger.warn(`[TelegramPlugin] editMessageText failed, falling back to sendMessage: ${err}`)
        }
      }
    }

    const response = await this.callApi<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
    })
    session.lastMessageId = response.result?.message_id
  }

  private async registerCommands(): Promise<void> {
    const commands = [
      { command: "new", description: "Create a new session" },
      { command: "sessions", description: "List or switch sessions" },
      { command: "abort", description: "Abort the current task" },
      { command: "compact", description: "Compact current session history" },
      { command: "share", description: "Share current session" },
      { command: "agent", description: "List or switch agents" },
      { command: "models", description: "List or switch models" },
      { command: "help", description: "Show available commands" },
    ]
    await this.callApi("setMyCommands", { commands })
  }

  private async startPolling(): Promise<void> {
    let offset = 0
    let connectAttempt = 0
    this.logger.info("[TelegramPlugin] Long polling started")

    while (this.abortController && !this.abortController.signal.aborted) {
      try {
        const token = this.telegramConfig.botToken
        const url = `${TELEGRAM_API_BASE}/bot${token}/getUpdates`

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offset,
            timeout: 30,
            allowed_updates: ["message", "callback_query"],
          }),
          signal: this.abortController.signal,
        })

        const data = (await res.json()) as TelegramApiEnvelope<TelegramUpdate[]>
        if (!data.ok || !Array.isArray(data.result)) {
          this.logger.warn(`[TelegramPlugin] getUpdates failed: ${data.description ?? "unknown"} (code: ${data.error_code})`)
          await sleep(2000)
          continue
        }

        for (const update of data.result) {
          if (update.update_id >= offset) {
            offset = update.update_id + 1
          }

          if (update.callback_query) {
            await this.handleCallbackQuery(update.callback_query)
            continue
          }

          if (!update.message?.text) {
            continue
          }

          const chatId = String(update.message.chat.id)
          if (!this.isAllowedChat(chatId)) {
            this.logger.warn(`[TelegramPlugin] Blocked message from unauthorized chatId: ${chatId}`)
            continue
          }

          if (this.onMessage) {
            try {
              await this.onMessage(this.createSyntheticMessageEvent(update))
            } catch (err) {
              this.logger.error(`[TelegramPlugin] onMessage handler error: ${err}`)
            }
          }
        }
      } catch (err) {
        const controller = this.abortController
        if (
          !controller ||
          controller.signal.aborted ||
          (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted")))
        ) {
          break
        }
        connectAttempt++
        const retryDelay = Math.min(1_000 * Math.pow(2, connectAttempt - 1), 30_000)
        this.logger.warn(`[TelegramPlugin] Polling error (attempt ${connectAttempt}): ${err}. Retrying in ${retryDelay}ms...`)
        await sleep(retryDelay)
      }
    }

    this.logger.info("[TelegramPlugin] Long polling stopped")
  }

  private async handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
    const chatId = String(query.message?.chat.id ?? "")
    if (!chatId || !this.isAllowedChat(chatId)) {
      await this.safeAnswerCallbackQuery(query.id, "This chat is not allowed.")
      return
    }

    const payload = query.data ? decodeTelegramCallbackPayload(query.data) : null
    if (!payload) {
      await this.safeAnswerCallbackQuery(query.id, "Unsupported action.")
      return
    }

    try {
      if (payload.action === "cmd" && payload.command && this.onMessage) {
        await this.safeAnswerCallbackQuery(query.id, "Working...")
        const messageEvent = this.createSyntheticMessageEvent({
          update_id: Date.now(),
          message: {
            message_id: query.message?.message_id ?? Date.now(),
            chat: query.message?.chat ?? { id: Number(chatId) },
            from: query.from,
            text: payload.command,
            date: query.message?.date ?? Math.floor(Date.now() / 1000),
          },
        })
        await this.onMessage(messageEvent)
        return
      }

      if ((payload.action === "qa" || payload.action === "pr") && this.onCardAction) {
        await this.safeAnswerCallbackQuery(query.id, "Submitted.")
        const value: Record<string, string> = payload.action === "qa"
          ? {
              action: "question_answer",
              requestId: payload.requestId ?? "",
              answers: JSON.stringify(payload.answers ?? []),
            }
          : {
              action: "permission_reply",
              requestId: payload.requestId ?? "",
              reply: payload.reply ?? "reject",
            }
        await this.onCardAction({
          action: {
            tag: "button",
            value,
          },
          open_message_id: String(query.message?.message_id ?? ""),
          open_chat_id: chatId,
          operator: { open_id: String(query.from.id) },
        })
        return
      }

      await this.safeAnswerCallbackQuery(query.id, "No handler available.")
    } catch (err) {
      this.logger.error(`[TelegramPlugin] callback_query handler error: ${err}`)
      await this.safeAnswerCallbackQuery(query.id, "Action failed.")
    }
  }

  private createSyntheticMessageEvent(update: TelegramUpdate): any {
    const message = update.message!
    const chatId = String(message.chat.id)
    return {
      event_id: String(update.update_id),
      event_type: "message",
      chat_id: chatId,
      chat_type: "p2p" as const,
      message_id: String(message.message_id),
      sender: {
        sender_id: { open_id: String(message.from?.id ?? chatId) },
        sender_type: "user",
        tenant_key: "telegram",
      },
      message: {
        message_type: "text",
        content: JSON.stringify({ text: message.text ?? "" }),
      },
      _channelId: "telegram",
    }
  }

  private isAllowedChat(chatId: string): boolean {
    return this.telegramConfig.allowedChatIds.length === 0 || this.telegramConfig.allowedChatIds.includes(chatId)
  }

  private async safeAnswerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
    try {
      await this.callApi("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        text: text.slice(0, 180),
      })
    } catch (err) {
      this.logger.warn(`[TelegramPlugin] answerCallbackQuery failed: ${err}`)
    }
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]

  const chunks: string[] = []
  let pos = 0
  while (pos < text.length) {
    chunks.push(text.slice(pos, pos + maxLen))
    pos += maxLen
  }
  return chunks
}

export function mdToHtml(text: string): string {
  const blocks: string[] = []
  let remaining = text.replace(/\r\n/g, "\n")

  remaining = remaining.replace(/```([a-zA-Z0-9_+-]+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
    const index = blocks.push(renderCodeBlock(code, lang)) - 1
    return `\u0000${index}\u0000`
  })

  let html = escapeHtml(remaining)
  html = html
    .replace(/^&gt;\s?(.*)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^\s*-\s+(.*)$/gm, "• $1")
    .replace(/^\s*\d+\.\s+(.*)$/gm, (_match, item) => `${item}.`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\|\|([^|]+)\|\|/g, "<tg-spoiler>$1</tg-spoiler>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/__([^_]+)__/g, "<u>$1</u>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")

  html = html.replace(/\u0000(\d+)\u0000/g, (_match, index) => blocks[Number(index)] ?? "")
  return html
}

function renderCodeBlock(code: string, language?: string): string {
  const escaped = escapeHtml(code.trimEnd())
  if (language) {
    return `<pre><code class="language-${escapeHtml(language)}">${escaped}</code></pre>`
  }
  return `<pre>${escaped}</pre>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export { createTelegramInlineCard }
