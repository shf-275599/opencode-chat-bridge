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
import type { SessionMapping } from "../types.js"
import { buildResponseCard, buildProjectSelectorCard, buildHelpCard, buildModelSelectorCard, buildAgentSelectorCard } from "../feishu/card-builder.js"
import { createTelegramInlineCard } from "../channel/telegram/telegram-interactive.js"
import { t, getLocale } from "../i18n/index.js"

import type { ChannelManager } from "../channel/manager.js"
import type { CronService } from "../cron/cron-service.js"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"

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

// Card builders removed - used centralized card-builder.ts instead



export function createCommandHandler(deps: CommandHandlerDeps): CommandHandler {
  const { serverUrl, sessionManager, feishuClient, logger } = deps

  const recentProviders = new Map<string, string[]>()

  function recordProviderUsage(feishuKey: string, providerId: string): void {
    const recent = recentProviders.get(feishuKey) ?? []
    const filtered = recent.filter((p) => p !== providerId)
    recentProviders.set(feishuKey, [providerId, ...filtered].slice(0, 5))
  }

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
    if (channelId === "telegram" && plugin?.outbound?.sendPlainText) {
      await plugin.outbound.sendPlainText({ address: chatId }, text)
      return
    }
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

  function buildDiscordSessionCard(sessions: Session[], currentSessionId?: string) {
    const rows: Array<Array<{ text: string; command: string }>> = []
    const sessionRows = sessions.slice(0, 8).map((session) => ({
      text: session.id === currentSessionId ? `• ${session.title || session.id}` : (session.title || session.id),
      command: `/connect ${session.id}`,
    }))
    if (sessionRows.length > 0) rows.push(sessionRows)
    rows.push([{ text: "New Session", command: "/new" }])
    return { text: `Current session: ${currentSessionId ?? "none"}\nChoose a session to connect:`, rows }
  }

  function buildDiscordAgentCard(currentAgent: string, names: string[]) {
    return {
      text: `Current agent: ${currentAgent}\nChoose the agent to use:`,
      rows: names.slice(0, 8).map((name) => [{ text: name === currentAgent ? `• ${name}` : name, command: `/agent ${name}` }]),
    }
  }

  function buildDiscordModelCard(currentModelId: string | null | undefined, models: ProviderModelInfo[]) {
    return {
      text: `Current model: ${currentModelId ?? "unknown"}\nChoose the model to use:`,
      rows: models.slice(0, 8).map((model) => ({ text: model.id === currentModelId ? `• ${model.id}` : model.id, command: `/models ${model.id}` })),
    }
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
      body: JSON.stringify({}),
    })

    if (!resp.ok) {
      throw new Error(`Failed to create session: HTTP ${resp.status}`)
    }

    const data = (await resp.json()) as { id: string }
    sessionManager.setMapping(feishuKey, data.id)
    logger.info(`/new: created session ${data.id}, bound to ${feishuKey}`)
    await replyText(chatId, messageId, t(getLocale(channelId), "command.newSession", { sessionId: data.id }), channelId)
  }

  async function handleCompact(
    feishuKey: string,
    chatId: string,
    messageId: string,
    channelId: string,
  ): Promise<void> {
    const locale = getLocale(channelId)
    const mapping = sessionManager.getSession(feishuKey)
    if (!mapping) {
      await replyText(chatId, messageId, t(locale, "command.noSessionBound"), channelId)
      return
    }

    await replyText(chatId, messageId, t(locale, "command.compacting"), channelId)

    const resp = await fetch(`${serverUrl}/session/${mapping.session_id}/prompt_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parts: [{ type: "text", text: "/compact", role: "user" }] }),
    })
    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`Command compact failed: HTTP ${resp.status}, ${errText}`)
    }

    logger.info(`/compact: summarized session ${mapping.session_id}`)
    await replyText(chatId, messageId, t(locale, "command.compacted", { sessionId: mapping.session_id }), channelId)
  }

  async function handleShare(
    feishuKey: string,
    chatId: string,
    messageId: string,
    channelId: string,
  ): Promise<void> {
    const locale = getLocale(channelId)
    const mapping = sessionManager.getSession(feishuKey)
    if (!mapping) {
      await replyText(chatId, messageId, t(locale, "command.noSessionBound"), channelId)
      return
    }

    const resp = await fetch(`${serverUrl}/session/${mapping.session_id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    if (!resp.ok) {
      throw new Error(`Share failed: HTTP ${resp.status}`)
    }

    const data = (await resp.json()) as { share?: { url?: string } }
    const shareUrl = data.share?.url
    logger.info(`/share: shared session ${mapping.session_id}, url: ${shareUrl}`)
    if (shareUrl) {
      await replyText(chatId, messageId, t(locale, "command.sessionShared", { url: shareUrl }), channelId)
    } else {
      await replyText(chatId, messageId, t(locale, "command.sessionSharedWithId", { sessionId: mapping.session_id }), channelId)
    }
  }

  async function handleUnshare(
    feishuKey: string,
    chatId: string,
    messageId: string,
    channelId: string,
  ): Promise<void> {
    const locale = getLocale(channelId)
    const mapping = sessionManager.getSession(feishuKey)
    if (!mapping) {
      await replyText(chatId, messageId, t(locale, "command.noSessionBound"), channelId)
      return
    }

    const resp = await fetch(`${serverUrl}/session/${mapping.session_id}/share`, {
      method: "DELETE",
    })
    if (!resp.ok) {
      throw new Error(`Unshare failed: HTTP ${resp.status}`)
    }

    logger.info(`/unshare: unshared session ${mapping.session_id}`)
    await replyText(chatId, messageId, t(locale, "command.shareCanceled", { sessionId: mapping.session_id }), channelId)
  }

  async function handleAbort(
    feishuKey: string,
    chatId: string,
    messageId: string,
    channelId: string,
  ): Promise<void> {
    const locale = getLocale(channelId)
    const mapping = sessionManager.getSession(feishuKey)
    if (!mapping) {
      await replyText(chatId, messageId, t(locale, "command.noSessionBound"), channelId)
      return
    }

    const resp = await fetch(`${serverUrl}/session/${mapping.session_id}/abort`, { method: "POST" })
    if (!resp.ok) {
      throw new Error(`Abort failed: HTTP ${resp.status}`)
    }

    logger.info(`/abort: aborted session ${mapping.session_id}`)
    await replyText(chatId, messageId, t(locale, "command.sessionAborted", { sessionId: mapping.session_id }), channelId)
  }

  async function handleSessions(
    feishuKey: string,
    chatId: string,
    messageId: string,
    channelId: string,
  ): Promise<void> {
    const locale = getLocale(channelId)
    const resp = await fetch(`${serverUrl}/session`)
    if (!resp.ok) {
      throw new Error(`List sessions failed: HTTP ${resp.status}`)
    }

    const sessions = (await resp.json()) as Session[]
    if (sessions.length === 0) {
      await replyText(chatId, messageId, t(locale, "command.noSessions"), channelId)
      return
    }

    const currentSessionId = await sessionManager.getExisting(feishuKey)
    if (currentSessionId) {
      const existingIndex = sessions.findIndex((session) => session.id === currentSessionId)
      if (existingIndex >= 0) {
        const current = sessions.splice(existingIndex, 1)[0]
        if (current) sessions.unshift(current)
      } else {
        sessions.unshift({ id: currentSessionId, title: t(locale, "status.session") })
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

    if (channelId === "discord") {
      const discordCard = buildDiscordSessionCard(sessions, currentSessionId)
      await replyCard(chatId, messageId, {
        text: sessions.slice(0, 10).map((session) => `- ${session.title || session.id} (${session.id})`).join("\n"),
        card: discordCard,
      }, channelId)
      return
    }

    if (channelId !== "feishu") {
      const sessionList = sessions.slice(0, 10).map((session) => `- ${session.title || session.id} (\`${session.id}\`)`).join("\n")
      await replyText(chatId, messageId, t(locale, "command.recentSessions", { sessions: sessionList }), channelId)
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
    const locale = getLocale(channelId)
    const checkResp = await fetch(`${serverUrl}/session/${targetSessionId}`)
    if (!checkResp.ok) {
      await replyText(chatId, messageId, t(locale, "command.sessionNotFound"), channelId)
      return
    }

    const success = sessionManager.setMapping(feishuKey, targetSessionId)
    if (!success) {
      throw new Error("Failed to set session mapping")
    }

    logger.info(`/connect: bound ${feishuKey} to session ${targetSessionId}`)
    await replyText(chatId, messageId, t(locale, "command.connectedToSession", { sessionId: targetSessionId }), channelId)
  }

  async function handleSessionCommand(
    feishuKey: string,
    chatId: string,
    messageId: string,
    command: string,
    channelId: string,
  ): Promise<void> {
    const locale = getLocale(channelId)
    const mapping = sessionManager.getSession(feishuKey)
    if (!mapping) {
      await replyText(chatId, messageId, t(locale, "command.noSessionBound"), channelId)
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
    await replyText(chatId, messageId, t(locale, "command.executing", { command, sessionId: mapping.session_id }), channelId)
  }

  async function handleHelp(
    chatId: string,
    messageId: string,
    channelId: string,
  ): Promise<void> {
    const locale = getLocale(channelId)
    if (channelId !== "feishu") {
      const helpText = `**${t(locale, "help.title")}**

\`/new\` - ${t(locale, "help.new")}
\`/sessions\` - ${t(locale, "help.sessions")}
\`/status\` - ${t(locale, "help.status")}
\`/compact\` - ${t(locale, "help.compact")}
\`/share\` - ${t(locale, "help.share")}
\`/unshare\` - ${t(locale, "help.unshare")}
\`/abort\` - ${t(locale, "help.abort")}
\`/agent\` - ${t(locale, "help.agent")}
\`/models\` - ${t(locale, "help.models")}
\`/cron\` - ${t(locale, "help.cron")}
\`/help\` - ${t(locale, "help.help")}`
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
    const locale = getLocale(channelId)
    const cron = deps.cronService
    if (!cron) {
      await replyText(chatId, messageId, t(locale, "command.cronNotEnabled"), channelId)
      return
    }

    const sub = args[0]?.toLowerCase()
    if (sub === "list") {
      const jobs = cron.getJobs()
      if (jobs.length === 0) {
        await replyText(chatId, messageId, t(locale, "command.noCronJobs"), channelId)
        return
      }

      const lines = jobs.map((job) => {
        const status = job.enabled !== false ? "[启用]" : "[停用]"
        return `${status} ${job.id || job.name} | ${job.schedule}\n  text: ${job.prompt}\n  chat: ${job.chatId}`
      })
      await replyText(chatId, messageId, t(locale, "command.cronJobList", { jobs: lines.join("\n\n") }), channelId)
      return
    }

    if (sub === "remove") {
      const jobId = args[1]
      if (!jobId) {
        await replyText(chatId, messageId, t(locale, "command.cronUsage"), channelId)
        return
      }
      const success = await cron.removeJob(jobId)
      await replyText(chatId, messageId, t(locale, success ? "command.cronJobRemoved" : "command.cronJobNotFound", { jobId }), channelId)
      return
    }

    await replyText(chatId, messageId, t(locale, "command.cronSubcommands"), channelId)
  }

  async function handleAgent(
    feishuKey: string,
    chatId: string,
    messageId: string,
    channelId: string,
    args: string[],
  ): Promise<void> {
    const locale = getLocale(channelId)
    const mapping = sessionManager.getSession(feishuKey)
    if (!mapping) {
      await replyText(chatId, messageId, t(locale, "command.noSessionBound"), channelId)
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
      ? names.map((name) => (name.toLowerCase() === current.toLowerCase() ? `✓ ${name}` : `- ${name}`)).join("\n")
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

      if (channelId === "discord") {
        const discordCard = buildDiscordAgentCard(current, names)
        await replyCard(chatId, messageId, {
          text: `Current agent: ${current}\n\nAvailable agents:\n${listText}`,
          card: discordCard,
        }, channelId)
        return
      }

      if (channelId === "feishu") {
        const card = buildAgentSelectorCard(names, current)
        await replyCard(chatId, messageId, {
          text: listText,
          card,
        }, channelId)
        return
      }

      await replyText(
        chatId,
        messageId,
        `**Current agent:** ${current}\n\n**Available agents:**\n${listText}\n\n💡 Usage: \`/agent {name}\``,
        channelId,
      )
      return
    }

    const normalize = (n: string) => n.replace(/\s*\([^)]*\)/, "").replace(/\s+/g, " ").trim().toLowerCase()
    const normalizedTarget = normalize(targetRaw)

    const matched = names.find((name) => name.toLowerCase() === targetRaw.toLowerCase() || normalize(name) === normalizedTarget)

    if (!matched) {
      const listText = names.length ? names.join(", ") : "none"
      await replyText(chatId, messageId, t(locale, "command.agentNotFound", { agent: targetRaw, list: listText }), channelId)
      return
    }

    sessionManager.setMapping(feishuKey, mapping.session_id, matched)
    await replyText(chatId, messageId, t(locale, "command.agentSwitched", { agent: matched }), channelId)
  }

  async function listModels(feishuKey: string): Promise<ProviderModelInfo[]> {
    const resp = await fetch(`${serverUrl}/provider`)
    if (!resp.ok) {
      throw new Error(`List models failed: HTTP ${resp.status}`)
    }

    const data = (await resp.json()) as {
      all?: Array<{
        id: string
        name: string
        models?: Record<string, { id?: string; name?: string }>
      }>
      connected?: string[]
    }

    const allProviders = data.all ?? []
    const connectedIds = new Set(data.connected ?? [])

    let availableProviders =
      connectedIds.size > 0
        ? allProviders.filter((provider) => connectedIds.has(provider.id))
        : allProviders

    const junkProviders = ["test", "mock", "fake", "dummy", "placeholder"]
    availableProviders = availableProviders.filter(
      (p) => !junkProviders.some((j) => p.id.toLowerCase().includes(j)),
    )

    const recent = recentProviders.get(feishuKey) ?? []

    return availableProviders
      .flatMap((provider) =>
        Object.entries(provider.models ?? {}).map(([modelKey, model]) => ({
          id: `${provider.id}/${model.id ?? modelKey}`,
          providerId: provider.id,
          providerName: provider.name,
          modelName: model.name ?? model.id ?? modelKey,
        })),
      )
      .sort((a, b) => {
        const aRecent = recent.indexOf(a.providerId)
        const bRecent = recent.indexOf(b.providerId)
        if (aRecent !== -1 && bRecent !== -1) return aRecent - bRecent
        if (aRecent !== -1) return -1
        if (bRecent !== -1) return 1
        return a.providerName.localeCompare(b.providerName)
      })
  }

  function detectCurrentModel(mapping: SessionMapping | null): string | undefined {
    return mapping?.model ?? undefined
  }

  async function getCurrentModelFromFile(): Promise<string | undefined> {
    try {
      const home = homedir()
      const statePath = join(home, ".local", "state", "opencode", "model.json")

      const content = await readFile(statePath, "utf-8")
      const state = JSON.parse(content) as {
        favorite?: Array<{ providerID?: string; modelID?: string }>
        recent?: Array<{ providerID?: string; modelID?: string }>
      }

      const favorites = state?.favorite
      if (favorites && favorites.length > 0 && favorites[0]?.providerID && favorites[0]?.modelID) {
        return `${favorites[0].providerID}/${favorites[0].modelID}`
      }
      const recent = state?.recent
      if (recent && recent.length > 0 && recent[0]?.providerID && recent[0]?.modelID) {
        return `${recent[0].providerID}/${recent[0].modelID}`
      }
      return undefined
    } catch {
      return undefined
    }
  }

  async function handleModels(
    feishuKey: string,
    chatId: string,
    messageId: string,
    channelId: string,
    args: string[],
  ): Promise<void> {
    const locale = getLocale(channelId)
    const mapping = sessionManager.getSession(feishuKey)
    if (!mapping) {
      await replyText(chatId, messageId, t(locale, "command.noSessionBound"), channelId)
      return
    }

    const models = await listModels(feishuKey)
    const targetRaw = args[0]

    if (!targetRaw || targetRaw.toLowerCase() === "list") {
      const fileModelId = await getCurrentModelFromFile()
      const localModelId = detectCurrentModel(mapping)
      const currentModelId = fileModelId ?? localModelId

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

      if (channelId === "discord") {
        const discordCard = buildDiscordModelCard(currentModelId, models)
        const text = models.length ? models.map((model) => `- ${model.id}`).join("\n") : "No models available"
        await replyCard(chatId, messageId, {
          text: `Current model: ${currentModelId ?? "unknown"}\n\nAvailable models:\n${text}`,
          card: discordCard,
        }, channelId)
        return
      }

      if (channelId === "feishu") {
        const card = buildModelSelectorCard(models, currentModelId)
        await replyCard(chatId, messageId, {
          text: models.map((model) => model.id).join("\n"),
          card,
        }, channelId)
        return
      }

      const listText = models.length
        ? models
            .map((model) => (model.id === currentModelId ? `* ${model.id}` : `- ${model.id}`))
            .join("\n")
        : "No models available"
      await replyText(
        chatId,
        messageId,
        `**Current model:** ${currentModelId ?? "unknown"}\n\n**Available models:**\n${listText}\n\n💡 Usage: \`/models {provider/model}\``,
        channelId,
      )
      return
    }

    const matched = models.find((model) => model.id.toLowerCase() === targetRaw.toLowerCase())
    if (!matched) {
      const listText = models.length ? models.map((model) => model.id).join(", ") : "none"
      await replyText(chatId, messageId, t(locale, "command.modelNotFound", { model: targetRaw, list: listText }), channelId)
      return
    }

    try {
      const home = homedir()
      const statePath = join(home, ".local", "state", "opencode", "model.json")
      const stateContent = await readFile(statePath, "utf-8").catch(() => '{"favorite":[],"recent":[]}')
      const state = JSON.parse(stateContent) as {
        favorite?: Array<{ providerID: string; modelID: string }>
        recent?: Array<{ providerID: string; modelID: string }>
      }

      const [providerID, modelID] = matched.id.split("/")
      if (providerID && modelID) {
        state.favorite = [{ providerID, modelID }]
        state.recent = state.recent?.filter(
          (m) => !(m.providerID === providerID && m.modelID === modelID),
        ) ?? []
        state.recent.unshift({ providerID, modelID })
        state.recent = state.recent.slice(0, 10)

        await writeFile(statePath, JSON.stringify(state, null, 2))
      }
    } catch (err) {
      logger.warn(`Failed to write model.json: ${err}`)
    }

    sessionManager.setModel(feishuKey, matched.id)
    recordProviderUsage(feishuKey, matched.providerId)
    await replyText(chatId, messageId, t(locale, "command.modelSwitched", { model: matched.id }), channelId)
  }

  async function handleStatus(
    feishuKey: string,
    chatId: string,
    messageId: string,
    channelId: string,
  ): Promise<void> {
    const locale = getLocale(channelId)
    const lines: string[] = []

    let serverHealthy = false
    try {
      const healthResp = await fetch(`${serverUrl}/global/health`)
      if (healthResp.ok) {
        const data = (await healthResp.json()) as { healthy?: boolean; version?: string }
        serverHealthy = data.healthy === true
        lines.push(serverHealthy ? t(locale, "status.serverOnline") : t(locale, "status.serverOffline"))
        if (data.version) lines.push(t(locale, "status.serverVersion", { version: data.version }))
      } else {
        lines.push(t(locale, "status.cannotConnect"))
      }
    } catch {
      lines.push(t(locale, "status.cannotConnect"))
    }

    const modelStr = await getCurrentModelFromFile()
    if (modelStr) {
      lines.push(t(locale, "status.model", { model: modelStr }))
    } else {
      lines.push(t(locale, "status.modelUnconfigured"))
    }

    const mapping = sessionManager.getSession(feishuKey)
    if (mapping) {
      lines.push(t(locale, "status.sessionBound", { sessionId: mapping.session_id }))
      lines.push(t(locale, "status.agent", { agent: mapping.agent }))

      try {
        const sessionResp = await fetch(`${serverUrl}/session/${mapping.session_id}`)
        if (sessionResp.ok) {
          const sessionData = (await sessionResp.json()) as {
            title?: string
          }
          if (sessionData.title) lines.push(t(locale, "status.title", { title: sessionData.title }))
        }
      } catch {
        // Session info fetch failed — not critical
      }

      let contextUsed = 0
      let contextLimit = 0

      try {
        const cwd = process.env.OPENCODE_CWD || process.cwd()
        const msgsResp = await fetch(`${serverUrl}/session/${mapping.session_id}/message?limit=1000`, {
          headers: { "x-opencode-directory": cwd },
        })
        if (msgsResp.ok) {
          const messages = JSON.parse(await msgsResp.text()) as Array<{
            info?: {
              role?: string
              summary?: boolean
              tokens?: {
                input?: number
                cache?: { read?: number }
              }
            }
          }>
          for (const msg of messages) {
            if (msg.info?.role === "assistant" && !msg.info?.summary) {
              const tokens = msg.info?.tokens
              if (tokens) {
                const input = tokens.input ?? 0
                const cacheRead = tokens.cache?.read ?? 0
                const total = input + cacheRead
                if (total > contextUsed) contextUsed = total
              }
            }
          }
        }
      } catch {
        // Not critical
      }

      try {
        const providerResp = await fetch(`${serverUrl}/provider`)
        if (providerResp.ok) {
          const providerData = (await providerResp.json()) as {
            all?: Array<{
              id?: string
              models?: Record<string, { name?: string; limit?: { context?: number } }>
            }>
          }
          const modelStr = await getCurrentModelFromFile()
          if (modelStr) {
            const parts = modelStr.split("/")
            const provId = parts[0]
            const modelId = parts[1]
            if (provId && modelId) {
              for (const prov of providerData.all ?? []) {
                if (prov.id === provId) {
                  const modelInfo = prov.models?.[modelId]
                  if (modelInfo?.limit?.context) {
                    contextLimit = modelInfo.limit.context
                  }
                  break
                }
              }
            }
          }
        }
      } catch {
        // Not critical
      }

      if (contextUsed > 0 || contextLimit > 0) {
        if (contextLimit > 0) {
          const pct = Math.round((contextUsed / contextLimit) * 100)
          lines.push(t(locale, "status.contextWithLimit", {
            used: contextUsed.toLocaleString(),
            limit: contextLimit.toLocaleString(),
            pct: pct.toString(),
          }))
        } else {
          lines.push(t(locale, "status.context", { used: contextUsed.toLocaleString() }))
        }
      }
    } else {
      lines.push(t(locale, "status.sessionUnbound"))
      lines.push(t(locale, "status.hintStart"))
    }

    lines.push(t(locale, "status.directory", { dir: process.env.OPENCODE_CWD || process.cwd() }))

    const statusText = lines.join("\n")
    await replyText(chatId, messageId, statusText, channelId)
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
            await replyText(chatId, messageId, t(getLocale(channelId), "command.connectUsage"), channelId)
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
        case "/model":
          await handleModels(feishuKey, chatId, messageId, channelId, parts.slice(1))
          return true

        case "/compact":
          await handleCompact(feishuKey, chatId, messageId, channelId)
          return true
        case "/share":
          await handleShare(feishuKey, chatId, messageId, channelId)
          return true
        case "/unshare":
          await handleUnshare(feishuKey, chatId, messageId, channelId)
          return true
        case "/status":
          await handleStatus(feishuKey, chatId, messageId, channelId)
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
        await replyText(chatId, messageId, t(getLocale(channelId), "command.commandFailed", { error: String(err) }), channelId)
      } catch (replyErr) {
        logger.error(`Failed to send error reply: ${replyErr}`)
      }
      return true
    }
  }
}
