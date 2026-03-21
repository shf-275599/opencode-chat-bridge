/**
 * Slash command handler for channel -> opencode bridge.
 *
 * Intercepts messages starting with "/" and routes them to
 * the appropriate opencode API endpoint instead of sending
 * them as plain text to the AI agent.
 */

import type { SessionManager } from "../session/session-manager.js"
import type { FeishuApiClient } from "../feishu/api-client.js"
import type { Logger } from "../utils/logger.js"
import { buildProjectSelectorCard, buildHelpCard } from "../feishu/card-builder.js"
import { createTelegramInlineCard } from "../channel/telegram/telegram-interactive.js"

import type { ChannelManager } from "../channel/manager.js"
import type { CronService } from "../cron/cron-service.js"

export interface CommandHandlerDeps {
  serverUrl: string
  sessionManager: SessionManager
  feishuClient: FeishuApiClient
  logger: Logger
  channelManager?: ChannelManager
  cronService?: CronService
}

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

interface AgentInfo {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
}

interface ProviderModelInfo {
  id: string
  providerId: string
  providerName: string
  modelName: string
}

interface ReplyCardPayload {
  text: string
  card: unknown
}

function buildFeishuModelSelectorCard(models: ProviderModelInfo[], currentModelId?: string | null): Record<string, unknown> {
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "选择模型" },
      template: "blue",
    },
    body: {
      elements: models.slice(0, 12).map((model) => ({
        tag: "button",
        text: {
          tag: "plain_text",
          content: model.id === currentModelId ? `• ${model.id}` : model.id,
        },
        type: model.id === currentModelId ? "primary" : "default",
        value: {
          action: "command_execute",
          command: `/models ${model.id}`,
        },
      })),
    },
  }
}

export function createCommandHandler(deps: CommandHandlerDeps): CommandHandler {
  const { serverUrl, sessionManager, feishuClient, logger } = deps

  function getPlugin(channelId: string) {
    return deps.channelManager?.getChannel(channelId as any)
  }

  async function replyText(
    chatId: string,
    messageId: string,
    text: string,
    channelId: string = "feishu",
  ): Promise<void> {
    const plugin = getPlugin(channelId)
    if (plugin?.outbound) {
      await plugin.outbound.sendText({ address: chatId }, text)
      return
    }

    await feishuClient.replyMessage(messageId, {
      msg_type: "text",
      content: JSON.stringify({ text }),
    })
  }

  async function replyCard(
    chatId: string,
    messageId: string,
    payload: ReplyCardPayload,
    channelId: string,
  ): Promise<void> {
    const plugin = getPlugin(channelId)
    if (plugin?.outbound?.sendCard) {
      await plugin.outbound.sendCard({ address: chatId }, payload.card)
      return
    }

    if (channelId === "feishu") {
      await feishuClient.replyMessage(messageId, {
        msg_type: "interactive",
        content: JSON.stringify(payload.card),
      })
      return
    }

    await replyText(chatId, messageId, payload.text, channelId)
  }

  function buildTelegramSessionCard(sessions: Session[], currentSessionId?: string) {
    return createTelegramInlineCard(
      `Current session: ${currentSessionId ?? "none"}\nChoose a session to connect:`,
      [
        ...sessions.slice(0, 8).map((session) => [{
          text: session.id === currentSessionId ? `• ${session.title || session.id}` : (session.title || session.id),
          payload: { action: "cmd" as const, command: `/connect ${session.id}` },
        }]),
        [{ text: "New Session", payload: { action: "cmd" as const, command: "/new" } }],
      ],
    )
  }

  function buildTelegramAgentCard(currentAgent: string, names: string[]) {
    return createTelegramInlineCard(
      `Current agent: ${currentAgent}\nChoose the agent to use:`,
      names.slice(0, 8).map((name) => [{
        text: name === currentAgent ? `• ${name}` : name,
        payload: { action: "cmd" as const, command: `/agent ${name}` },
      }]),
    )
  }

  function buildTelegramModelCard(currentModelId: string | null | undefined, models: ProviderModelInfo[]) {
    return createTelegramInlineCard(
      `Current model: ${currentModelId ?? "unknown"}\nChoose the model to use:`,
      models.slice(0, 8).map((model) => [{
        text: model.id === currentModelId ? `• ${model.id}` : model.id,
        payload: { action: "cmd" as const, command: `/models ${model.id}` },
      }]),
    )
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

    const resp = await fetch(`${serverUrl}/session/${mapping.session_id}/abort`, { method: "POST" })
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

    const sessions = (await resp.json()) as Session[]
    if (sessions.length === 0) {
      await replyText(chatId, messageId, "暂无会话。", channelId)
      return
    }

    const currentSessionId = await sessionManager.getExisting(feishuKey)
    if (currentSessionId) {
      const existingIndex = sessions.findIndex((session) => session.id === currentSessionId)
      if (existingIndex >= 0) {
        const current = sessions.splice(existingIndex, 1)[0]
        if (current) sessions.unshift(current)
      } else {
        sessions.unshift({ id: currentSessionId, title: "当前会话" })
      }
    }

    if (channelId === "telegram") {
      const telegramCard = buildTelegramSessionCard(sessions, currentSessionId)
      if (telegramCard) {
        await replyCard(chatId, messageId, {
          text: sessions.slice(0, 10).map((session) => `- ${session.title || session.id} (${session.id})`).join("\n"),
          card: telegramCard,
        }, channelId)
        return
      }
    }

    if (channelId !== "feishu") {
      const sessionList = sessions.slice(0, 10).map((session) => `- ${session.title || session.id} (${session.id})`).join("\n")
      await replyText(chatId, messageId, `最近会话列表：\n${sessionList}\n\n使用 /connect {id} 进行连接。`, channelId)
      return
    }

    const card = buildProjectSelectorCard(sessions, currentSessionId)
    await replyCard(chatId, messageId, {
      text: sessions.slice(0, 10).map((session) => `- ${session.title || session.id} (${session.id})`).join("\n"),
      card,
    }, channelId)
  }

  async function handleConnect(
    feishuKey: string,
    chatId: string,
    messageId: string,
    targetSessionId: string,
    channelId: string,
  ): Promise<void> {
    const checkResp = await fetch(`${serverUrl}/session/${targetSessionId}`)
    if (!checkResp.ok) {
      await replyText(chatId, messageId, "会话不存在。", channelId)
      return
    }

    const success = sessionManager.setMapping(feishuKey, targetSessionId)
    if (!success) {
      throw new Error("Failed to set session mapping")
    }

    logger.info(`/connect: bound ${feishuKey} to session ${targetSessionId}`)
    await replyText(chatId, messageId, `已连接到会话: ${targetSessionId}`, channelId)
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

    const resp = await fetch(`${serverUrl}/session/${mapping.session_id}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, arguments: "" }),
    })
    if (!resp.ok) {
      throw new Error(`Command ${command} failed: HTTP ${resp.status}`)
    }

    logger.info(`/${command}: executed on session ${mapping.session_id}`)
    await replyText(chatId, messageId, `已执行 /${command} (会话: ${mapping.session_id})`, channelId)
  }

  async function handleHelp(
    chatId: string,
    messageId: string,
    channelId: string,
  ): Promise<void> {
    if (channelId !== "feishu") {
      const helpText = `命令菜单:\n- /new: 新建会话\n- /sessions: 连接会话\n- /models: 切换模型\n- /agent: 切换 Agent\n- /compact: 压缩历史\n- /share: 分享会话\n- /abort: 中止任务\n- /help: 显示此帮助`
      await replyText(chatId, messageId, helpText, channelId)
      return
    }

    const card = buildHelpCard()
    await replyCard(chatId, messageId, {
      text: "Use /new, /sessions, /agent, /models, /compact, /share, /abort, /help",
      card,
    }, channelId)
  }

  async function handleCron(
    _feishuKey: string,
    chatId: string,
    messageId: string,
    channelId: string,
    args: string[],
  ): Promise<void> {
    const cron = deps.cronService
    if (!cron) {
      await replyText(chatId, messageId, "Cron 服务未启用", channelId)
      return
    }

    const sub = args[0]?.toLowerCase()
    if (sub === "list") {
      const jobs = cron.getJobs()
      if (jobs.length === 0) {
        await replyText(chatId, messageId, "当前没有任何定时任务。", channelId)
        return
      }

      const lines = jobs.map((job) => {
        const status = job.enabled !== false ? "[启用]" : "[停用]"
        return `${status} ${job.id || job.name} | ${job.schedule}\n  text: ${job.prompt}\n  chat: ${job.chatId}`
      })
      await replyText(chatId, messageId, `🕒 运行时 Cron 任务列表：\n\n${lines.join("\n\n")}`, channelId)
      return
    }

    if (sub === "remove") {
      const jobId = args[1]
      if (!jobId) {
        await replyText(chatId, messageId, "用法：/cron remove <jobId>", channelId)
        return
      }
      const success = await cron.removeJob(jobId)
      await replyText(chatId, messageId, success ? `已成功移除任务: ${jobId}` : `找不到任务: ${jobId}`, channelId)
      return
    }

    await replyText(chatId, messageId, "目前支持的子命令：/cron list, /cron remove <id>。", channelId)
  }

  async function handleAgent(
    feishuKey: string,
    chatId: string,
    messageId: string,
    channelId: string,
    args: string[],
  ): Promise<void> {
    const mapping = sessionManager.getSession(feishuKey)
    if (!mapping) {
      await replyText(chatId, messageId, "No session bound yet. Use /sessions or /new first.", channelId)
      return
    }

    const resp = await fetch(`${serverUrl}/agent`)
    if (!resp.ok) {
      throw new Error(`List agents failed: HTTP ${resp.status}`)
    }

    const agents = (await resp.json()) as AgentInfo[]
    const available = agents.filter((agent) => agent.mode === "primary" || agent.mode === "all")
    const names = available.map((agent) => agent.name)
    const current = mapping.agent || "build"
    const targetRaw = args[0]

    if (!targetRaw || targetRaw.toLowerCase() === "list") {
      const listText = names.length
        ? names.map((name) => (name.toLowerCase() === current.toLowerCase() ? `* ${name}` : `- ${name}`)).join("\n")
        : "No agents available"

      if (channelId === "telegram") {
        const telegramCard = buildTelegramAgentCard(current, names)
        if (telegramCard) {
          await replyCard(chatId, messageId, {
            text: `Current agent: ${current}\n\nAvailable agents:\n${listText}`,
            card: telegramCard,
          }, channelId)
          return
        }
      }

      await replyText(
        chatId,
        messageId,
        `Current agent: ${current}\n\nAvailable agents:\n${listText}\n\nUsage: /agent {name}`,
        channelId,
      )
      return
    }

    const matched = names.find((name) => name.toLowerCase() === targetRaw.toLowerCase())
    if (!matched) {
      const listText = names.length ? names.join(", ") : "none"
      await replyText(chatId, messageId, `Agent not found: ${targetRaw}\nAvailable: ${listText}`, channelId)
      return
    }

    sessionManager.setMapping(feishuKey, mapping.session_id, matched)
    await replyText(chatId, messageId, `Agent switched to: ${matched}`, channelId)
  }

  async function listModels(): Promise<ProviderModelInfo[]> {
    const resp = await fetch(`${serverUrl}/models`)
    if (!resp.ok) {
      throw new Error(`List models failed: HTTP ${resp.status}`)
    }

    const data = (await resp.json()) as Array<{
      id?: string
      name?: string
      models?: Record<string, { id?: string; name?: string }>
    }>

    return data.flatMap((provider) =>
      Object.entries(provider.models ?? {}).map(([modelKey, model]) => ({
        id: model.id ?? `${provider.id}/${modelKey}`,
        providerId: provider.id ?? "unknown",
        providerName: provider.name ?? provider.id ?? "unknown",
        modelName: model.name ?? modelKey,
      })),
    )
  }

  async function handleModels(
    feishuKey: string,
    chatId: string,
    messageId: string,
    channelId: string,
    args: string[],
  ): Promise<void> {
    const mapping = sessionManager.getSession(feishuKey)
    if (!mapping) {
      await replyText(chatId, messageId, "No session bound yet. Use /sessions or /new first.", channelId)
      return
    }

    const models = await listModels()
    const currentModelId = mapping.model ?? null
    const targetRaw = args[0]

    if (!targetRaw || targetRaw.toLowerCase() === "list") {
      if (channelId === "telegram") {
        const telegramCard = buildTelegramModelCard(currentModelId, models)
        if (telegramCard) {
          const text = models.length ? models.map((model) => `- ${model.id}`).join("\n") : "No models available"
          await replyCard(chatId, messageId, {
            text: `Current model: ${currentModelId ?? "unknown"}\n\nAvailable models:\n${text}`,
            card: telegramCard,
          }, channelId)
          return
        }
      }

      if (channelId === "feishu") {
        const card = buildFeishuModelSelectorCard(models, currentModelId)
        await replyCard(chatId, messageId, {
          text: models.map((model) => model.id).join("\n"),
          card,
        }, channelId)
        return
      }

      const listText = models.length
        ? models.map((model) => (model.id === currentModelId ? `* ${model.id}` : `- ${model.id}`)).join("\n")
        : "No models available"
      await replyText(
        chatId,
        messageId,
        `Current model: ${currentModelId ?? "unknown"}\n\nAvailable models:\n${listText}\n\nUsage: /models {provider/model}`,
        channelId,
      )
      return
    }

    const matched = models.find((model) => model.id.toLowerCase() === targetRaw.toLowerCase())
    if (!matched) {
      const listText = models.length ? models.map((model) => model.id).join(", ") : "none"
      await replyText(chatId, messageId, `Model not found: ${targetRaw}\nAvailable: ${listText}`, channelId)
      return
    }

    const resp = await fetch(`${serverUrl}/session/${mapping.session_id}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "models", arguments: matched.id }),
    })
    if (!resp.ok) {
      throw new Error(`Switch model failed: HTTP ${resp.status}`)
    }

    sessionManager.setModel(feishuKey, matched.id)
    await replyText(chatId, messageId, `Model switched to: ${matched.id}`, channelId)
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
        case "/cron":
          await handleCron(feishuKey, chatId, messageId, channelId, parts.slice(1))
          return true
        case "/agent":
          await handleAgent(feishuKey, chatId, messageId, channelId, parts.slice(1))
          return true
        case "/models":
          await handleModels(feishuKey, chatId, messageId, channelId, parts.slice(1))
          return true
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
