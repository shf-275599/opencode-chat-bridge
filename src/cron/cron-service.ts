import * as fs from "node:fs/promises"
import * as path from "node:path"
import { CronJob } from "cron"
import express from "express"
import type { CronConfig, CronJobConfig } from "../utils/config.js"
import type { SessionManager } from "../session/session-manager.js"
import type { FeishuApiClient } from "../feishu/api-client.js"
import type { ChannelManager } from "../channel/manager.js"
import type { Logger } from "../utils/logger.js"

export interface CronServiceOptions {
  config: CronConfig
  sessionManager: SessionManager
  feishuClient: FeishuApiClient
  channelManager?: ChannelManager
  serverUrl: string
  logger: Logger
}

export class CronService {
  private readonly options: CronServiceOptions
  private readonly activeJobs = new Map<string, CronJob>()
  private jobsData: CronJobConfig[] = []
  private running = false
  private apiServer: any

  constructor(options: CronServiceOptions) {
    this.options = options
  }

  async start(): Promise<void> {
    if (this.running || !this.options.config.enabled) return

    const { config, logger } = this.options
    
    // Load persisted jobs
    try {
      const dir = path.dirname(config.jobsFile)
      await fs.mkdir(dir, { recursive: true })
      
      const data = await fs.readFile(config.jobsFile, "utf-8")
      this.jobsData = JSON.parse(data)
    } catch (e: any) {
      if (e.code === "ENOENT") {
        this.jobsData = [...config.jobs]
        await this.saveJobs()
      } else {
        logger.error(`Failed to load jobs file ${config.jobsFile}: ${e}`)
        this.jobsData = []
      }
    }

    for (const job of this.jobsData) {
      if (job.enabled !== false) {
        this.scheduleJob(job)
      }
    }

    if (config.apiEnabled) {
      this.startApiServer()
    }

    this.running = true
    logger.info(`Cron service started with ${this.activeJobs.size} active job(s)`)
  }

  stop(): void {
    if (!this.running) return

    for (const job of this.activeJobs.values()) {
      job.stop()
    }
    this.activeJobs.clear()

    if (this.apiServer) {
      this.apiServer.close()
      this.apiServer = null
    }

    this.running = false
    this.options.logger.info("Cron service stopped")
  }

  public getJobs(): CronJobConfig[] {
    return this.jobsData
  }

  public async addJob(job: CronJobConfig): Promise<void> {
    if (!job.id) {
      job.id = Math.random().toString(36).substring(2, 9)
    }
    this.jobsData.push(job)
    await this.saveJobs()
    if (job.enabled !== false) {
      this.scheduleJob(job)
    }
  }

  public async removeJob(id: string): Promise<boolean> {
    const idx = this.jobsData.findIndex(j => j.id === id || j.name === id)
    if (idx < 0) return false
    
    const job = this.jobsData[idx]
    if (job && job.id && this.activeJobs.has(job.id)) {
      this.activeJobs.get(job.id)?.stop()
      this.activeJobs.delete(job.id)
    }
    
    this.jobsData.splice(idx, 1)
    await this.saveJobs()
    return true
  }

  private async saveJobs(): Promise<void> {
    try {
      await fs.writeFile(this.options.config.jobsFile, JSON.stringify(this.jobsData, null, 2), "utf-8")
    } catch (e) {
      this.options.logger.error(`Failed to save jobs: ${e}`)
    }
  }

  private normalizeSchedule(schedule: string): string {
    const trimmed = schedule.trim()
    const intervalMatch = trimmed.match(/^every\s+(\d+)\s*([mh])$/i)
    if (intervalMatch) {
      const value = Number(intervalMatch[1])
      const unit = intervalMatch[2]!.toLowerCase()
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid schedule "${schedule}": interval must be positive`)
      }
      if (unit === "m") {
        return `0 */${value} * * * *`
      }
      return `0 0 */${value} * * *`
    }

    const dailyMatch = trimmed.match(/^daily\s+(\d{1,2}):(\d{2})$/i)
    if (dailyMatch) {
      const hour = Number(dailyMatch[1])
      const minute = Number(dailyMatch[2])
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        throw new Error(`Invalid schedule "${schedule}": invalid time (expected HH:MM with 0-23:0-59)`)
      }
      return `0 ${minute} ${hour} * * *`
    }

    // Accept 5-field cron by prepending seconds
    const fields = trimmed.split(/\s+/)
    if (fields.length === 5) {
      return `0 ${trimmed}`
    }

    return trimmed
  }

  private scheduleJob(job: CronJobConfig): void {
    try {
      const jobId = job.id || job.name
      // Use "cron" package, assumes schedule is cron expression like "0 * * * * *"
      const cronExpr = this.normalizeSchedule(job.schedule)
      const cronJob = new CronJob(cronExpr, () => {
        void this.executeJob(job)
      })
      cronJob.start()
      this.activeJobs.set(jobId, cronJob)
      this.options.logger.info(`Scheduled job ${jobId} with cron: ${cronExpr}`)
    } catch (err: any) {
      this.options.logger.error(`Failed to parsing schedule for job ${job.name}: ${err.message}`)
    }
  }

  private async executeJob(job: CronJobConfig): Promise<void> {
    const { sessionManager, feishuClient, channelManager, serverUrl, logger } = this.options
    // Bind to existing or create new opencode session for this cron logic
    const cronKey = `cron:${job.id || job.name}`

    try {
      logger.info(`Executing cron job "${job.name}"...`)
      const sessionId = await sessionManager.getOrCreate(cronKey)

      const resp = await fetch(`${serverUrl}/session/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Simulate sending a system event payload conceptually
        body: JSON.stringify({
          parts: [{ type: "text", text: `[CRON] ${job.prompt}` }],
        }),
      })

      if (!resp.ok) {
        logger.error(`Cron job "${job.name}": POST failed with HTTP ${resp.status}`)
        return
      }

      const result = await this.waitForResponse(sessionId)
      
      const channelId = job.channelId || "feishu"
      const plugin = channelManager?.getChannel(channelId as any)
      
      if (plugin?.outbound) {
        await plugin.outbound.sendText({ address: job.chatId }, `🕒 **自动任务: ${job.name}**\n${result}`)
      } else if (channelId === "feishu") {
        await feishuClient.sendMessage(job.chatId, {
          msg_type: "text",
          content: JSON.stringify({ text: `🕒 [${job.name}] ${result}` }),
        })
      }

      logger.info(`Cron job "${job.name}" completed`)
    } catch (err) {
      logger.error(`Cron job "${job.name}" failed:`, err)
    }
  }

  private async waitForResponse(sessionId: string, maxWaitMs = 300_000): Promise<string> {
    const { serverUrl } = this.options
    const start = Date.now()
    const pollInterval = 2_000

    while (Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollInterval))

      const statusResp = await fetch(`${serverUrl}/session/${sessionId}`)
      if (!statusResp.ok) continue

      const session = (await statusResp.json()) as { status?: { type?: string } }
      if (session.status?.type === "idle") {
        const msgResp = await fetch(`${serverUrl}/session/${sessionId}/message?limit=1`)
        if (msgResp.ok) {
          const messages = (await msgResp.json()) as Array<{ role?: string; text?: string }>
          const last = messages.find((m) => m.role === "assistant")
          return last?.text ?? "(no response)"
        }
        return "(failed to retrieve response)"
      }
    }

    return "(timed out waiting for response)"
  }
  
  private startApiServer() {
    const app = express()
    app.use(express.json())

    app.get("/cron/list", (req, res) => {
      res.json(this.jobsData)
    })

    app.post("/cron/add", async (req, res) => {
      const job = req.body as CronJobConfig
      await this.addJob(job)
      res.json({ success: true, job })
    })

    app.post("/cron/remove", async (req, res) => {
      const success = await this.removeJob(req.body.id)
      res.json({ success })
    })

    this.apiServer = app.listen(this.options.config.apiPort, this.options.config.apiHost, () => {
      this.options.logger.info(`Cron API listening on ${this.options.config.apiHost}:${this.options.config.apiPort}`)
    })
  }
}
