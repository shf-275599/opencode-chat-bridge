import { t, type Locale } from "../i18n/index.js"
import type {
  TaskDisplayItem,
  TaskCreationStage,
  TaskCreationState,
  ScheduledTask,
} from "./types.js"

export function buildTaskListCard(tasks: TaskDisplayItem[], locale: Locale): string {
  if (tasks.length === 0) {
    return t(locale, "scheduledTask.list.empty")
  }

  const lines = tasks.map((task) => {
    const statusIcon = getStatusIcon(task.lastStatus, locale)
    const enabledLabel = task.enabled
      ? t(locale, "scheduledTask.status.enabled")
      : t(locale, "scheduledTask.status.disabled")
    const nextRun = task.nextRunAt
      ? t(locale, "scheduledTask.nextRun", { time: task.nextRunAt })
      : t(locale, "scheduledTask.nextRunNone")
    const lastRun = task.lastRunAt
      ? t(locale, "scheduledTask.lastRun", { time: task.lastRunAt })
      : t(locale, "scheduledTask.lastRunNone")

    return (
      `${statusIcon} **${task.name}**\n` +
      `> ${task.scheduleSummary}\n` +
      `> ${enabledLabel} | ${nextRun} | ${lastRun}`
    )
  })

  return t(locale, "scheduledTask.list.header", { count: tasks.length }) + "\n\n" + lines.join("\n\n")
}

export function buildTaskListText(tasks: TaskDisplayItem[], locale: Locale): string {
  if (tasks.length === 0) {
    return t(locale, "scheduledTask.list.empty")
  }

  const lines = tasks.map((task) => {
    const statusIcon = getStatusIcon(task.lastStatus, locale)
    const enabledLabel = task.enabled
      ? `[${t(locale, "scheduledTask.status.enabled")}]`
      : `[${t(locale, "scheduledTask.status.disabled")}]`
    const nextRun = task.nextRunAt
      ? t(locale, "scheduledTask.nextRun", { time: task.nextRunAt })
      : t(locale, "scheduledTask.nextRunNone")
    const lastRun = task.lastRunAt
      ? t(locale, "scheduledTask.lastRun", { time: task.lastRunAt })
      : t(locale, "scheduledTask.lastRunNone")

    return (
      `${statusIcon} ${task.name}\n` +
      `   ${task.scheduleSummary}\n` +
      `   ${enabledLabel} | ${nextRun} | ${lastRun}`
    )
  })

  return (
    t(locale, "scheduledTask.list.header", { count: tasks.length }) + "\n\n" + lines.join("\n\n")
  )
}

export function buildTaskCreationCard(
  stage: TaskCreationStage,
  data: Partial<TaskCreationState>,
  locale: Locale,
): string {
  switch (stage) {
    case "idle":
      return t(locale, "scheduledTask.creation.idle")

    case "awaiting_schedule":
      return t(locale, "scheduledTask.creation.awaitingSchedule", {
        projectId: data.projectId ?? "",
      })

    case "parsing_schedule":
      return t(locale, "scheduledTask.creation.parsingSchedule", {
        scheduleText: data.scheduleText ?? "",
      })

    case "awaiting_prompt":
      return t(locale, "scheduledTask.creation.awaitingPrompt", {
        scheduleSummary: data.parsedSchedule?.summary ?? data.scheduleText ?? "",
      })

    case "preview":
      return buildTaskPreviewCard(
        {
          id: "",
          name: data.parsedSchedule?.summary ?? "",
          kind: data.parsedSchedule?.kind ?? "once",
          prompt: data.prompt ?? "",
          schedule: data.scheduleText ?? "",
          scheduleSummary: data.parsedSchedule?.summary ?? "",
          cronExpression: data.parsedSchedule?.cronExpression ?? "",
          model: data.model ?? { providerID: "", modelID: "" },
          agent: data.agent ?? "",
          projectId: data.projectId ?? "",
          projectWorktree: data.projectWorktree ?? "",
          enabled: true,
          nextRunAt: null,
          lastRunAt: null,
          lastStatus: "idle",
          lastError: null,
          runCount: 0,
          createdAt: "",
        },
        locale,
      )

    case "confirming":
      return t(locale, "scheduledTask.creation.confirming")

    default:
      return t(locale, "scheduledTask.creation.unknown")
  }
}

export function buildTaskPreviewCard(task: Partial<ScheduledTask>, locale: Locale): string {
  const kindLabel =
    task.kind === "cron"
      ? t(locale, "scheduledTask.kind.cron")
      : t(locale, "scheduledTask.kind.once")

  const modelLabel = task.model
    ? `${task.model.providerID}/${task.model.modelID}`
    : t(locale, "scheduledTask.modelNotSet")

  const scheduleInfo = task.scheduleSummary ?? task.schedule ?? ""

  const lines = [
    `**${t(locale, "scheduledTask.preview.title")}**`,
    ``,
    `**${t(locale, "scheduledTask.preview.name")}:** ${task.name ?? "-"}`,
    `**${t(locale, "scheduledTask.preview.kind")}:** ${kindLabel}`,
    `**${t(locale, "scheduledTask.preview.schedule")}:** ${scheduleInfo}`,
    `**${t(locale, "scheduledTask.preview.model")}:** ${modelLabel}`,
    `**${t(locale, "scheduledTask.preview.agent")}:** ${task.agent ?? "-"}`,
    ``,
    `**${t(locale, "scheduledTask.preview.prompt")}:**`,
    task.prompt ?? "-",
  ]

  return lines.join("\n")
}

function getStatusIcon(status: TaskDisplayItem["lastStatus"], locale: Locale): string {
  switch (status) {
    case "running":
      return t(locale, "scheduledTask.statusIcon.running")
    case "success":
      return t(locale, "scheduledTask.statusIcon.success")
    case "error":
      return t(locale, "scheduledTask.statusIcon.error")
    default:
      return t(locale, "scheduledTask.statusIcon.idle")
  }
}
