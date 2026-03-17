/**
 * Slash command handler for Feishu → opencode bridge.
 *
 * Intercepts messages starting with "/" and routes them to
 * the appropriate opencode API endpoint instead of sending
 * them as plain text to the AI agent.
 */

import type { SessionManager } from "../session/session-manager.js"
import type { FeishuApiClient } from "../feishu/api-client.js"
import type { Logger } from "../utils/logger.js"
import { buildResponseCard, buildProjectSelectorCard, buildHelpCard } from "../feishu/card-builder.js"

import type { ChannelManager } from "../channel/manager.js"

// ── Dependency injection interface ──

export interface CommandHandlerDeps {
  serverUrl: string
  sessionManager: SessionManager
  feishuClient: FeishuApiClient
  logger: Logger
  channelManager?: ChannelManager
}

// ── Types ──

export type CommandHandler = (
  feishuKey: string,
  chatId: string,
  messageId: string,
  commandText: string,
  channelId?: string,
) => Promise<boolean>

interface Session {
  id: string
  title?: string
}

// Card builders removed - used centralized card-builder.ts instead

// ── Factory ──

export function createCommandHandler(deps: CommandHandlerDeps): CommandHandler {
  const { serverUrl, sessionManager, feishuClient, logger } = deps

  async function replyText(
    chatId: string,
    messageId: string,
    text: string,
    channelId: string = "feishu",
  ): Promise<void> {
    const plugin = deps.channelManager?.getChannel(channelId as any)
    if (plugin?.outbound) {
      await plugin.outbound.sendText({ address: chatId }, text)
    } else {
      await feishuClient.replyMessage(messageId, {
        msg_type: "text",
        content: JSON.stringify({ text }),
      })
    }
  }

  async function handleNew(
    feishuKey: string,
    chatId: string,
    messageId: string,
    channelId: string,
  ): Promise<void> {
    const resp = await fetch(`${serverUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `Feishu chat ${feishuKey}` }),
    })

    if (!resp.ok) {
      throw new Error(`Failed to create session: HTTP ${resp.status}`)
    }

    const data = (await resp.json()) as { id: string }
    sessionManager.deleteMapping(feishuKey)
    logger.info(`/new: created session ${data.id}, unbound ${feishuKey}`)
    await replyText(chatId, messageId, `已创建新会话: ${data.id}`, channelId)
  }

  async function handleAbort(
    feishuKey: string,
    chatId: string,
    messageId: string,
    channelId: string,
  ): Promise<void> {
    const mapping = sessionManager.getSession(feishuKey)
    if (!mapping) {
      await replyText(chatId, messageId, "当前没有绑定的会话。", channelId)
      return
    }

    const resp = await fetch(
      `${serverUrl}/session/${mapping.session_id}/abort`,
      { method: "POST" },
    )

    if (!resp.ok) {
      throw new Error(`Abort failed: HTTP ${resp.status}`)
    }

    logger.info(`/abort: aborted session ${mapping.session_id}`)
    await replyText(chatId, messageId, `已中止会话: ${mapping.session_id}`, channelId)
  }

  async function handleSessions(
    feishuKey: string,
    chatId: string,
    messageId: string,
    channelId: string,
  ): Promise<void> {
    const resp = await fetch(`${serverUrl}/session`)
    if (!resp.ok) {
      throw new Error(`List sessions failed: HTTP ${resp.status}`)
    }

    let sessions = (await resp.json()) as Session[]
    if (sessions.length === 0) {
      await replyText(chatId, messageId, "暂无会话。", channelId)
      return
    }

    // Get current bound session for this chat
    const currentSessionId = await sessionManager.getExisting(feishuKey)

    if (currentSessionId) {
      // Check if it's already in the list
      const existingIndex = sessions.findIndex((s) => s.id === currentSessionId)
      if (existingIndex >= 0) {
        // Move it to top
        const current = sessions.splice(existingIndex, 1)[0]
        if (current) {
          sessions.unshift(current)
        }
      } else {
        // Not in API response at all — add it manually at top
        sessions.unshift({ id: currentSessionId, title: "当前会话" })
      }
    }

    if (channelId !== "feishu") {
      // Text fallback for non-feishu channels
      const sessionList = sessions.slice(0, 10).map(s => `- ${s.title || s.id} (${s.id})`).join("\n")
      await replyText(chatId, messageId, `最近会话列表：\n${sessionList}\n\n使用 /connect {id} 进行连接。`, channelId)
      return
    }

    const card = buildProjectSelectorCard(sessions, currentSessionId)
    await feishuClient.replyMessage(messageId, {
      msg_type: "interactive",
      content: JSON.stringify(card),
    })
  }

  async function handleConnect(
    feishuKey: string,
    chatId: string,
    messageId: string,
    targetSessionId: string,
    channelId: string,
  ): Promise<void> {
    // Validate session exists
    const checkResp = await fetch(`${serverUrl}/session/${targetSessionId}`)
    if (!checkResp.ok) {
      await replyText(chatId, messageId, "会话不存在。", channelId)
      return
    }

    // Unbind current mapping if exists
    sessionManager.deleteMapping(feishuKey)

    // Set new mapping
    const success = sessionManager.setMapping(feishuKey, targetSessionId)
    if (success) {
      logger.info(`/connect: bound ${feishuKey} to session ${targetSessionId}`)
      await replyText(chatId, messageId, `已连接到会话: ${targetSessionId}`, channelId)
    } else {
      throw new Error("Failed to set session mapping")
    }
  }

  async function handleSessionCommand(
    feishuKey: string,
    chatId: string,
    messageId: string,
    command: string,
    channelId: string,
  ): Promise<void> {
    const mapping = sessionManager.getSession(feishuKey)
    if (!mapping) {
      await replyText(chatId, messageId, "当前没有绑定的会话。", channelId)
      return
    }

    const resp = await fetch(
      `${serverUrl}/session/${mapping.session_id}/command`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, arguments: "" }),
      },
    )

    if (!resp.ok) {
      throw new Error(`Command ${command} failed: HTTP ${resp.status}`)
    }

    logger.info(`/${command}: executed on session ${mapping.session_id}`)
    await replyText(
      chatId,
      messageId,
      `已执行 /${command} (会话: ${mapping.session_id})`,
      channelId,
    )
  }

  async function handleHelp(
    chatId: string,
    messageId: string,
    channelId: string,
  ): Promise<void> {
    if (channelId !== "feishu") {
      const helpText = `⚡ 命令菜单：
- /new: 新建会话
- /sessions: 连接会话
- /compact: 压缩历史
- /share: 分享会话
- /abort: 中止任务
- /help: 显示此帮助`
      await replyText(chatId, messageId, helpText, channelId)
      return
    }

    const card = buildHelpCard()
    await feishuClient.replyMessage(messageId, {
      msg_type: "interactive",
      content: JSON.stringify(card),
    })
  }

  return async function handleCommand(
    feishuKey: string,
    chatId: string,
    messageId: string,
    commandText: string,
    channelId: string = "feishu",
  ): Promise<boolean> {
    const trimmed = commandText.trim()
    const parts = trimmed.split(/\s+/)
    const cmd = parts[0]?.toLowerCase()

    if (!cmd || !cmd.startsWith("/")) return false

    logger.info(`Slash command: ${cmd} from ${feishuKey} (channel: ${channelId})`)

    try {
      switch (cmd) {
        case "/new":
          await handleNew(feishuKey, chatId, messageId, channelId)
          return true

        case "/abort":
          await handleAbort(feishuKey, chatId, messageId, channelId)
          return true

        case "/sessions":
          await handleSessions(feishuKey, chatId, messageId, channelId)
          return true

        case "/connect": {
          const targetSessionId = parts[1]
          if (!targetSessionId) {
            await replyText(chatId, messageId, "用法: /connect {session_id}", channelId)
            return true
          }
          await handleConnect(feishuKey, chatId, messageId, targetSessionId, channelId)
          return true
        }

        case "/compact":
          await handleSessionCommand(feishuKey, chatId, messageId, "session.compact", channelId)
          return true

        case "/share":
          await handleSessionCommand(feishuKey, chatId, messageId, "session.share", channelId)
          return true

        case "/":
        case "/help":
          await handleHelp(chatId, messageId, channelId)
          return true

        default:
          return false
      }
    } catch (err) {
      logger.error(`Command ${cmd} failed: ${err}`)
      try {
        await replyText(chatId, messageId, `命令执行失败: ${err}`, channelId)
      } catch (replyErr) {
        logger.error(`Failed to send error reply: ${replyErr}`)
      }
      return true
    }
  }
}
