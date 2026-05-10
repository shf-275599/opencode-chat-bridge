import { describe, it, expect, vi, beforeEach } from "vitest"
import { extractJsonBlock, tryParseSchedule, llmParseSchedule } from "../llm-schedule-parser.js"

// ── extractJsonBlock ──────────────────────────────────────────────────────────

describe("extractJsonBlock", () => {
  it("extracts JSON from fenced ```json block", () => {
    const text = `Here is the result:\n\`\`\`json\n{"cronExpression":"0 10 19 * * *","summary":"每天 19:10","kind":"cron"}\n\`\`\``
    expect(extractJsonBlock(text)).toEqual({
      cronExpression: "0 10 19 * * *",
      summary: "每天 19:10",
      kind: "cron",
    })
  })

  it("extracts JSON from plain ``` block", () => {
    const text = "```\n{\"cronExpression\":\"0 0 9 * * *\",\"summary\":\"每天 09:00\",\"kind\":\"cron\"}\n```"
    expect(extractJsonBlock(text)).toMatchObject({ cronExpression: "0 0 9 * * *" })
  })

  it("extracts raw JSON without code fences", () => {
    const text = `{"cronExpression":"0 30 8 * * 1-5","summary":"工作日 08:30","kind":"cron","taskPrompt":"开会提醒"}`
    expect(extractJsonBlock(text)).toMatchObject({ cronExpression: "0 30 8 * * 1-5", taskPrompt: "开会提醒" })
  })

  it("returns null for text with no JSON", () => {
    expect(extractJsonBlock("no json here")).toBeNull()
  })

  it("returns null for malformed JSON", () => {
    expect(extractJsonBlock("```json\n{ broken json \n```")).toBeNull()
  })

  it("extracts JSON with taskPrompt field", () => {
    const text = `\`\`\`json\n{"cronExpression":"0 10 19 * * *","summary":"每天 19:10","kind":"cron","taskPrompt":"提醒我吃饭"}\n\`\`\``
    const result = extractJsonBlock(text)
    expect(result?.["taskPrompt"]).toBe("提醒我吃饭")
  })
})

// ── tryParseSchedule ──────────────────────────────────────────────────────────

describe("tryParseSchedule", () => {
  it("parses strict format without throwing", () => {
    const result = tryParseSchedule("每天19:00")
    expect(result).not.toBeNull()
    expect(result?.cronExpression).toContain("19")
  })

  it("returns null for natural language with extra text", () => {
    // "每天19:10提醒我吃饭" currently fails regex
    const result = tryParseSchedule("我希望每天提醒我")
    expect(result).toBeNull()
  })

  it("returns null for completely unrelated text", () => {
    expect(tryParseSchedule("hello world")).toBeNull()
  })

  it("parses 'every 2h' format", () => {
    const result = tryParseSchedule("every 2h")
    expect(result).not.toBeNull()
    expect(result?.kind).toBe("cron")
  })
})

// ── llmParseSchedule ─────────────────────────────────────────────────────────

describe("llmParseSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function mockFetch(sessionId: string, llmReply: string) {
    const fetchMock = vi.fn()
    // POST /session → create temp session
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: sessionId }),
    })
    // POST /session/{id}/message → LLM response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(llmReply),
    })
    // DELETE /session/{id} → cleanup
    fetchMock.mockResolvedValueOnce({ ok: true })
    return fetchMock
  }

  it("parses valid LLM JSON response with taskPrompt", async () => {
    const reply = "```json\n{\"cronExpression\":\"0 10 19 * * *\",\"summary\":\"每天 19:10\",\"kind\":\"cron\",\"taskPrompt\":\"提醒我吃饭\"}\n```"
    globalThis.fetch = mockFetch("tmp-001", reply)

    const result = await llmParseSchedule("http://localhost:4096", "每天19:10提醒我吃饭", "2026-03-26T19:10:00+08:00")

    expect(result.cronExpression).toBe("0 10 19 * * *")
    expect(result.summary).toBe("每天 19:10")
    expect(result.kind).toBe("cron")
    expect(result.taskPrompt).toBe("提醒我吃饭")
  })

  it("parses weekday schedule", async () => {
    const reply = "```json\n{\"cronExpression\":\"0 0 9 * * 1-5\",\"summary\":\"工作日 09:00\",\"kind\":\"cron\",\"taskPrompt\":\"开会提醒\"}\n```"
    globalThis.fetch = mockFetch("tmp-002", reply)

    const result = await llmParseSchedule("http://localhost:4096", "工作日早9点提醒我开会", "2026-03-26T19:10:00+08:00")

    expect(result.cronExpression).toBe("0 0 9 * * 1-5")
    expect(result.taskPrompt).toBe("开会提醒")
  })

  it("throws when LLM returns no JSON", async () => {
    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "tmp-003" }),
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("I cannot understand this request."),
    })
    // messages fallback
    fetchMock.mockResolvedValueOnce({ ok: false })
    // cleanup
    fetchMock.mockResolvedValueOnce({ ok: true })
    globalThis.fetch = fetchMock

    await expect(
      llmParseSchedule("http://localhost:4096", "???", "2026-03-26T19:00:00+08:00")
    ).rejects.toThrow("valid JSON block")
  })

  it("throws when session creation fails", async () => {
    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    globalThis.fetch = fetchMock

    await expect(
      llmParseSchedule("http://localhost:4096", "每天19:00", "2026-03-26T19:00:00+08:00")
    ).rejects.toThrow("Failed to create LLM session")
  })

  it("cleans up temp session even when parsing fails", async () => {
    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "tmp-004" }),
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("no json"),
    })
    fetchMock.mockResolvedValueOnce({ ok: false }) // messages fallback
    const deleteMock = fetchMock.mockResolvedValueOnce({ ok: true }) // DELETE
    globalThis.fetch = fetchMock

    await expect(
      llmParseSchedule("http://localhost:4096", "random", "2026-03-26T19:00:00+08:00")
    ).rejects.toThrow()

    // Verify DELETE was called (cleanup happened)
    const calls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls
    const deleteCall = calls.find((c: unknown[]) => {
      const opts = c[1] as { method?: string } | undefined
      return opts?.method === "DELETE"
    })
    expect(deleteCall).toBeDefined()
  })

  it("throws when cron expression has wrong field count", async () => {
    const reply = "```json\n{\"cronExpression\":\"10 19 * * *\",\"summary\":\"every day\",\"kind\":\"cron\"}\n```"
    globalThis.fetch = mockFetch("tmp-005", reply)

    await expect(
      llmParseSchedule("http://localhost:4096", "每天19:10", "2026-03-26T19:00:00+08:00")
    ).rejects.toThrow("6 fields")
  })
})
