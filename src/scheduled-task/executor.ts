import type { ScheduledTask } from "./types.js"
import { getAttachmentsDir } from "../utils/paths.js"

interface ExecutorOptions {
  serverUrl: string
  logger: {
    debug: (msg: string, ...args: any[]) => void
    info: (msg: string, ...args: any[]) => void
    error: (msg: string, ...args: any[]) => void
  }
  timeoutMs?: number
}

export async function executeScheduledTask(
  task: ScheduledTask,
  options: ExecutorOptions
): Promise<{ status: "success" | "error"; resultText?: string; errorMessage?: string; finishedAt: string; sessionId?: string }> {
  const { serverUrl, logger, timeoutMs = 5 * 60 * 1000 } = options
  const maxWaitMs = timeoutMs
  const pollInterval = 2_000

  let sessionId: string | undefined

  try {
    logger.info(`[executor] Starting scheduled task "${task.name}" (id=${task.id})`)

    // 任务始终使用独立 session，不复用用户互动会话，避免污染用户上下文
    logger.debug(`[executor] Creating dedicated session for task`)
    const createResp = await fetch(`${serverUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: task.projectId,
        worktree: task.projectWorktree,
      }),
    })

    if (!createResp.ok) {
      const errorText = await createResp.text()
      const error = `Failed to create session: HTTP ${createResp.status} - ${errorText}`
      logger.error(`[executor] ${error}`)
      return { status: "error", errorMessage: error, finishedAt: new Date().toISOString() }
    }

    const createData = (await createResp.json()) as { id?: string }
    sessionId = createData.id

    if (!sessionId) {
      const error = "No sessionId returned from opencode API"
      logger.error(`[executor] ${error}`)
      return { status: "error", errorMessage: error, finishedAt: new Date().toISOString() }
    }

    logger.info(`[executor] Dedicated session created: ${sessionId}`)

    const attachmentsDir = getAttachmentsDir()
    const imContext = `【任务执行上下文】
你正在通过 ${task.channelId} 平台 (chatId: ${task.chatId}) 与用户交互。任务完成后，你的回复将通过该平台发送给用户。

【文件发送说明】
如果你需要向用户发送文件（如图片、文档、代码等），请将文件保存到以下目录：
${attachmentsDir}
系统会自动检测该目录中的新文件并发送给用户。支持的文件类型：图片(png/jpg/gif/webp)、音频、视频、PDF、文档、代码文件等。

---任务内容---
${task.prompt}`

    const resp = await fetch(`${serverUrl}/session/${sessionId}/prompt_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parts: [{ type: "text", text: imContext }],
        modelId: task.model?.modelID || undefined,
        providerId: task.model?.providerID || undefined,
        agent: task.agent || undefined,
      }),
    })

    if (!resp.ok) {
      let errorMessage = `Failed to execute task: HTTP ${resp.status}`
      try {
        const errorData = await resp.json() as { data?: { providerID?: string; modelID?: string }; message?: string }
        if (errorData.data?.providerID && errorData.data?.modelID) {
          errorMessage = `Model not found: ${errorData.data.providerID}/${errorData.data.modelID}`
        } else if (errorData.message) {
          errorMessage = `Failed to execute task: ${errorData.message}`
        }
      } catch {
        const errorText = await resp.text()
        if (errorText) errorMessage += ` - ${errorText.slice(0, 200)}`
      }
      logger.error(`[executor] ${errorMessage}`)
      return { status: "error", errorMessage, finishedAt: new Date().toISOString() }
    }

    logger.debug(`[executor] Task posted to session: ${sessionId}`)

    const resultText = await waitForResponse(sessionId, serverUrl, maxWaitMs, pollInterval, logger)

    logger.info(`[executor] Scheduled task "${task.name}" completed`)

    return {
      status: "success",
      resultText,
      sessionId,
      finishedAt: new Date().toISOString(),
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error(`[executor] Scheduled task "${task.name}" failed:`, err)
    return {
      status: "error",
      errorMessage,
      finishedAt: new Date().toISOString(),
    }
  }
}

async function waitForResponse(
  sessionId: string,
  serverUrl: string,
  maxWaitMs: number,
  pollInterval: number,
  logger: ExecutorOptions["logger"]
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollInterval))

    const statusResp = await fetch(`${serverUrl}/session/${sessionId}`)
    if (!statusResp.ok) {
      logger.debug(`[executor] Poll /session/${sessionId} returned HTTP ${statusResp.status}, retrying...`)
      continue
    }

    const session = (await statusResp.json()) as { status?: { type?: string } }
    if (session.status?.type === "idle") {
      const msgResp = await fetch(`${serverUrl}/session/${sessionId}/message?limit=50`)
      if (msgResp.ok) {
        type MsgPart = { type?: string; text?: string }
        type Message = { role?: string; parts?: MsgPart[] }
        const messages = (await msgResp.json()) as Message[]
        // 取最后一个 assistant 消息的所有 text parts 并拼接
        const assistantMsgs = messages.filter((m) => m.role === "assistant")
        const last = assistantMsgs[assistantMsgs.length - 1]
        if (last?.parts) {
          const text = last.parts
            .filter((p) => p.type === "text" && p.text)
            .map((p) => p.text!)
            .join("")
          return text || "(no response)"
        }
      }
      return "(failed to retrieve response)"
    }
  }

  return "(timed out waiting for response)"
}
