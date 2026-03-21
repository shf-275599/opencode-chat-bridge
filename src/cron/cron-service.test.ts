import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { CronService } from "../cron/cron-service.js"
import type { CronServiceOptions } from "../cron/cron-service.js"
import { createMockLogger, createMockFeishuClient } from "../__tests__/setup.js"
import type { SessionManager } from "../session/session-manager.js"
import type { CronConfig } from "../utils/config.js"

vi.mock("cron", () => {
  const instances: any[] = []
  class CronJob {
    expr: string
    fn: () => void | Promise<void>
    started = false
    stopped = false
    constructor(expr: string, fn: () => void | Promise<void>) {
      if (expr.includes("invalid")) {
        throw new Error("Invalid schedule")
      }
      this.expr = expr
      this.fn = fn
      instances.push(this)
    }
    start() {
      this.started = true
    }
    stop() {
      this.stopped = true
    }
  }
  return { CronJob, __instances: instances }
})

import { __instances } from "cron"

const advanceTimers = async (ms: number) => {
  if (typeof vi.advanceTimersByTimeAsync === "function") {
    await vi.advanceTimersByTimeAsync(ms)
  } else {
    vi.advanceTimersByTime(ms)
    await new Promise(r => setImmediate(r))
  }
}


function createMockSessionManager(): SessionManager {
  return {
    getOrCreate: vi.fn().mockResolvedValue("session-123"),
    getExisting: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockReturnValue(null),
    deleteMapping: vi.fn().mockReturnValue(true),
    setMapping: vi.fn().mockReturnValue(true),
    setModel: vi.fn().mockReturnValue(true),
    cleanup: vi.fn().mockReturnValue(0),
    validateAndCleanupStale: vi.fn().mockResolvedValue(0),
  }
}

function makeOptions(overrides: Partial<CronServiceOptions> = {}): CronServiceOptions {
  const config: CronConfig = {
    enabled: true,
    apiEnabled: false,
    apiPort: 4097,
    apiHost: "127.0.0.1",
    jobsFile: path.join(process.cwd(), "data", "cron-jobs.test.json"),
    jobs: [
      { name: "test-job", schedule: "every 30m", prompt: "do something", chatId: "chat-1" },
    ],
  }
  return {
    config,
    sessionManager: createMockSessionManager(),
    feishuClient: createMockFeishuClient(),
    serverUrl: "http://127.0.0.1:4096",
    logger: createMockLogger(),
    ...overrides,
  }
}

describe("CronService", () => {
  let originalFetch: typeof globalThis.fetch
  let tempDir: string
  let jobsFile: string

  beforeEach(async () => {
    originalFetch = globalThis.fetch
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cron-test-"))
    jobsFile = path.join(tempDir, "cron-jobs.json")
    vi.useFakeTimers()
    ;(__instances as any[]).length = 0
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it("normalizes legacy schedule formats into cron expressions", async () => {
    const options = makeOptions({
      config: {
        enabled: true,
        apiEnabled: false,
        apiPort: 4097,
        apiHost: "127.0.0.1",
        jobsFile,
        jobs: [
          { name: "m-job", schedule: "every 5m", prompt: "m", chatId: "chat-1" },
          { name: "h-job", schedule: "every 2h", prompt: "h", chatId: "chat-2" },
          { name: "d-job", schedule: "daily 09:30", prompt: "d", chatId: "chat-3" },
          { name: "c-job", schedule: "*/5 * * * *", prompt: "c", chatId: "chat-4" },
        ],
      },
    })
    const service = new CronService(options)

    await service.start()
    const exprs = (__instances as any[]).map((i) => i.expr)
    expect(exprs).toEqual([
      "0 */5 * * * *",
      "0 0 */2 * * *",
      "0 30 9 * * *",
      "0 */5 * * * *",
    ])

    service.stop()
  })

  it("start() logs invalid schedule and skips job", async () => {
    const options = makeOptions({
      config: {
        enabled: true,
        apiEnabled: false,
        apiPort: 4097,
        apiHost: "127.0.0.1",
        jobsFile,
        jobs: [
          { name: "bad-job", schedule: "invalid format", prompt: "test", chatId: "chat-1" },
        ],
      },
    })
    const service = new CronService(options)

    await service.start()
    expect(options.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parsing schedule for job bad-job"),
    )
    expect((__instances as any[])).toHaveLength(0)
  })

  it("start() is idempotent (calling twice does not double jobs)", async () => {
    const options = makeOptions({
      config: {
        ...makeOptions().config,
        jobsFile,
      },
    })
    const service = new CronService(options)

    await service.start()
    await service.start()

    const startCalls = (options.logger.info as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("started"))
    expect(startCalls).toHaveLength(1)

    service.stop()
  })

  it("stop() clears all jobs", async () => {
    const options = makeOptions({
      config: {
        ...makeOptions().config,
        jobsFile,
      },
    })
    const service = new CronService(options)

    await service.start()
    service.stop()

    expect(options.logger.info).toHaveBeenCalledWith("Cron service stopped")
  })

  it("stop() is idempotent", async () => {
    const options = makeOptions({
      config: {
        ...makeOptions().config,
        jobsFile,
      },
    })
    const service = new CronService(options)

    await service.start()
    service.stop()
    service.stop()

    const stopCalls = (options.logger.info as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("stopped"))
    expect(stopCalls).toHaveLength(1)
  })

  it("job execution posts to opencode and returns response text", async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.includes("/session/") && url.endsWith("/message") && init?.method === "POST") {
        return { ok: true }
      }
      if (url.includes("/session/") && !url.includes("/message")) {
        return { ok: true, json: async () => ({ status: { type: "idle" } }) }
      }
      if (url.includes("/message?limit=1")) {
        return {
          ok: true,
          json: async () => [{ role: "assistant", text: "ok" }],
        }
      }
      return { ok: false, status: 404 }
    })
    globalThis.fetch = mockFetch
    const options = makeOptions({
      config: {
        enabled: true,
        apiEnabled: false,
        apiPort: 4097,
        apiHost: "127.0.0.1",
        jobsFile,
        jobs: [
          { name: "interval-job", schedule: "every 1m", prompt: "test prompt", chatId: "chat-abc" },
        ],
      },
    })
    const service = new CronService(options)
    await service.start()
    const instance = (__instances as any[])[0]
    const runPromise = instance.fn()
    await advanceTimers(2_100)
    await runPromise
    expect(options.sessionManager.getOrCreate).toHaveBeenCalledWith("cron:interval-job")
    service.stop()
  })

  it("handles multiple jobs with different schedules", async () => {
    const options = makeOptions({
      config: {
        enabled: true,
        apiEnabled: false,
        apiPort: 4097,
        apiHost: "127.0.0.1",
        jobsFile,
        jobs: [
          { name: "job-a", schedule: "every 5m", prompt: "a", chatId: "chat-1" },
          { name: "job-b", schedule: "every 1h", prompt: "b", chatId: "chat-2" },
          { name: "job-c", schedule: "daily 09:00", prompt: "c", chatId: "chat-3" },
        ],
      },
    })
    const service = new CronService(options)

    await service.start()
    expect(options.logger.info).toHaveBeenCalledWith(expect.stringContaining("active job(s)"))

    service.stop()
  })
})
