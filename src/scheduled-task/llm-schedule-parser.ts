/**
 * LLM-based schedule parser for natural language schedule expressions.
 * Falls back gracefully when LLM is unavailable or parsing fails.
 */

import type { ParsedTaskSchedule } from "./types.js"
import { parseSchedule } from "./schedule-parser.js"
import { createLogger } from "../utils/logger.js"

const logger = createLogger("llm-schedule-parser")

export interface LLMParsedSchedule extends ParsedTaskSchedule {
  /** Extracted task action text, e.g. "提醒我吃饭" from "每天19:10提醒我吃饭" */
  taskPrompt?: string
}

/**
 * Try to parse a schedule expression using regex first (fast path),
 * returns null instead of throwing on failure.
 */
export function tryParseSchedule(text: string): ParsedTaskSchedule | null {
  try {
    return parseSchedule(text)
  } catch {
    return null
  }
}

/**
 * Extract a JSON block from LLM response text.
 * Handles both ```json ... ``` fenced blocks and raw JSON objects.
 */
export function extractJsonBlock(text: string): Record<string, unknown> | null {
  // Try fenced code block first: ```json { ... } ```
  const fencedMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i)
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1]) as Record<string, unknown>
    } catch {
      // fall through
    }
  }

  // Try raw JSON object (first { ... } pair)
  const rawMatch = text.match(/\{[\s\S]*?\}/)
  if (rawMatch) {
    try {
      return JSON.parse(rawMatch[0]) as Record<string, unknown>
    } catch {
      // fall through
    }
  }

  return null
}

/**
 * Build the one-shot prompt for LLM schedule parsing.
 */
function buildParsePrompt(input: string, nowIso: string): string {
  return `You are a cron schedule parser. Given a user request (in Chinese or English), extract the schedule and task content.

Current time: ${nowIso}

User request: "${input}"

Respond with ONLY a JSON block (no other text):
\`\`\`json
{"cronExpression":"0 */5 * * * *","summary":"每 5 分钟","kind":"cron","taskPrompt":"发送新闻摘要"}
\`\`\`

Rules:
- cronExpression: 6-field format (second minute hour dayOfMonth month dayOfWeek), e.g. "0 */5 * * * *" for every 5 minutes
- summary: human-readable Chinese summary of the schedule
- kind: "cron" for repeating, "once" for one-time
- taskPrompt: ALWAYS extract the task/action content from the input, e.g. "发送新闻摘要", "提醒我开会", "检查代码". If the input contains any action/verb after the schedule, that IS the taskPrompt. Never omit it.
- For "once" tasks, also include "runAt": "YYYY-MM-DDTHH:MM:00" (must be in the future relative to current time)
- Weekdays: 0=Sunday, 1=Monday, ..., 5=Friday, 6=Saturday
- "工作日" means weekdays: use "1-5" for dayOfWeek field
- "每N分钟" = every N minutes: cronExpression = "0 */N * * * *"
- "每N小时" = every N hours: cronExpression = "0 0 */N * * *"
- When user says "每五分钟发送新闻摘要", taskPrompt should be "发送新闻摘要"
- When user says "每天19点提醒我吃饭", taskPrompt should be "提醒我吃饭"`
}

/**
 * Use the opencode LLM to parse a natural language schedule expression.
 * Creates a temporary isolated session, sends a one-shot prompt, then cleans up.
 *
 * @param serverUrl - opencode server base URL (e.g. "http://localhost:4096")
 * @param input - natural language schedule description
 * @param nowIso - current time as ISO string (for LLM context)
 * @returns Parsed schedule with optional taskPrompt
 * @throws Error if LLM parsing fails or returns invalid data
 */
export async function llmParseSchedule(
  serverUrl: string,
  input: string,
  nowIso: string,
): Promise<LLMParsedSchedule> {
  let sessionId: string | null = null

  try {
    // 1. Create isolated temporary session
    const createResp = await fetch(`${serverUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })

    if (!createResp.ok) {
      throw new Error(`Failed to create LLM session: HTTP ${createResp.status}`)
    }

    const sessionData = await createResp.json() as { id: string }
    sessionId = sessionData.id
    logger.info(`[llm-schedule-parser] Created temp session ${sessionId}`)

    // 2. Send one-shot prompt
    const prompt = buildParsePrompt(input, nowIso)
    const msgResp = await fetch(`${serverUrl}/session/${sessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parts: [{ type: "text", text: prompt }],
      }),
    })

    if (!msgResp.ok) {
      throw new Error(`LLM message POST failed: HTTP ${msgResp.status}`)
    }

    // 3. Wait for LLM to finish and collect the response text
    // The /message endpoint may return partial SSE or the full text body
    const responseText = await msgResp.text()
    logger.info(`[llm-schedule-parser] LLM raw response (${responseText.length} bytes): ${responseText.slice(0, 300)}`)

    // 4. Extract JSON from response
    const parsed = extractJsonBlock(responseText)
    if (!parsed) {
      // Try polling the session messages if the response body was empty
      const messagesResp = await fetch(`${serverUrl}/session/${sessionId}/message`)
      if (messagesResp.ok) {
        const messages = await messagesResp.text()
        const extractedFromMessages = findJsonInMessages(messages)
        if (extractedFromMessages) {
          return buildResult(extractedFromMessages, input)
        }
      }
      throw new Error(`LLM did not return a valid JSON block in response`)
    }

    return buildResult(parsed, input)
  } finally {
    // 5. Always clean up the temporary session
    if (sessionId) {
      try {
        await fetch(`${serverUrl}/session/${sessionId}`, { method: "DELETE" })
        logger.info(`[llm-schedule-parser] Cleaned up temp session ${sessionId}`)
      } catch (cleanupErr) {
        logger.warn(`[llm-schedule-parser] Failed to cleanup session ${sessionId}: ${cleanupErr}`)
      }
    }
  }
}

/**
 * Try to find a JSON block embedded in messages API response text.
 */
function findJsonInMessages(text: string): Record<string, unknown> | null {
  // Look for text/content parts that might contain the JSON
  const parts = text.split(/\n+/)
  for (const part of parts) {
    if (part.includes("{") && part.includes("cronExpression")) {
      const extracted = extractJsonBlock(part)
      if (extracted) return extracted
    }
  }
  // Try extracting from full text
  return extractJsonBlock(text)
}

/**
 * Validate and build LLMParsedSchedule from raw JSON object.
 */
function buildResult(raw: Record<string, unknown>, originalInput: string): LLMParsedSchedule {
  const cronExpression = typeof raw["cronExpression"] === "string" ? raw["cronExpression"] : null
  const summary = typeof raw["summary"] === "string" ? raw["summary"] : null
  const kind = raw["kind"] === "once" ? "once" as const : "cron" as const
  const taskPrompt = typeof raw["taskPrompt"] === "string" ? raw["taskPrompt"].trim() : undefined
  const runAt = typeof raw["runAt"] === "string" ? raw["runAt"] : undefined

  if (!cronExpression) {
    throw new Error(`LLM response missing cronExpression field (input: "${originalInput}")`)
  }

  if (!summary) {
    throw new Error(`LLM response missing summary field (input: "${originalInput}")`)
  }

  // Validate the cron expression by trying to use it
  // Basic format check: 6 whitespace-separated fields
  const fields = cronExpression.trim().split(/\s+/)
  if (fields.length !== 6) {
    throw new Error(`LLM returned invalid cronExpression "${cronExpression}": expected 6 fields, got ${fields.length}`)
  }

  return {
    cronExpression,
    summary,
    kind,
    runAt,
    taskPrompt: taskPrompt || undefined,
  }
}
