import { CronJob } from "cron"
import type { ScheduledTask } from "./types.js"

/**
 * Compute the ISO timestamp for when the task should run next.
 * Returns null if no next run is possible (e.g., once task already fired).
 */
export function computeNextRunAt(task: ScheduledTask, fromDate: Date): string | null {
  if (task.kind === "once") {
    if (!task.runAt) return null
    const runAt = new Date(task.runAt)
    return runAt > fromDate ? task.runAt : null
  }

  if (!task.cronExpression) return null
  try {
    const cronJob = new CronJob(task.cronExpression, () => {})
    const next = cronJob.nextDate()
    if (!next) return null
    return next.toJSDate().toISOString() ?? null
  } catch {
    return null
  }
}

/**
 * Check if a task is due now (within the current minute).
 */
export function isTaskDue(task: ScheduledTask): boolean {
  const now = new Date()
  const nextRun = computeNextRunAt(task, now)
  if (!nextRun) return false

  const next = new Date(nextRun)
  const diffMs = Math.abs(next.getTime() - now.getTime())
  // Due if within 60 seconds
  return diffMs < 60_000
}
