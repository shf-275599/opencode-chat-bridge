export type TaskKind = "once" | "cron"

export type TaskStatus = "idle" | "running" | "success" | "error"

export interface ScheduledTaskModel {
  providerID: string
  modelID: string
}

export interface ParsedTaskSchedule {
  cronExpression: string
  summary: string
  kind: TaskKind
  runAt?: string
}

export interface ScheduledTask {
  id: string
  name: string
  /** "once" = 执行一次后自动删除；"cron" = 按周期重复执行 */
  kind: TaskKind
  prompt: string
  schedule: string
  scheduleSummary: string
  cronExpression: string
  model: ScheduledTaskModel
  agent: string
  projectId: string
  projectWorktree: string
  /** 目标回复频道（feishu / wechat） */
  channelId: string
  /** 目标回复的 chat/group ID */
  chatId: string
  enabled: boolean
  sessionId?: string
  runAt?: string
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: TaskStatus
  lastError: string | null
  runCount: number
  createdAt: string
}

export type TaskCreationStage =
  | "idle"
  | "awaiting_schedule"
  | "parsing_schedule"
  | "awaiting_prompt"
  | "preview"
  | "confirming"

export interface TaskCreationState {
  stage: TaskCreationStage
  projectId: string
  projectWorktree: string
  model: ScheduledTaskModel
  agent: string
  sessionId: string | null
  scheduleText: string | null
  parsedSchedule: ParsedTaskSchedule | null
  prompt: string | null
  scheduleMessageId: string | null
  previewMessageId: string | null
}

export interface TaskDelivery {
  taskId: string
  taskName: string
  scheduleSummary: string
  prompt: string
  runAt: string
  status: "success" | "error"
  messageText: string
  sessionId?: string
  /** 路由信息：回复到哪个频道 */
  channelId: string
  /** 路由信息：回复到哪个 chat */
  chatId: string
}

export interface TaskDisplayItem {
  id: string
  name: string
  prompt?: string
  scheduleSummary: string
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: TaskStatus
  enabled: boolean
}
