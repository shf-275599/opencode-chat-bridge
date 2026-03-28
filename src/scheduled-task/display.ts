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
      `> ID: ${task.id}\n` +
      `> 任务: ${task.prompt || "-"}\n` +
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
      `   ID: ${task.id}\n` +
      `   任务: ${task.prompt || "-"}\n` +
      `   ${task.scheduleSummary}\n` +
      `   ${enabledLabel} | ${nextRun} | ${lastRun}`
    )
  })

  return (
    t(locale, "scheduledTask.list.header", { count: tasks.length }) + "\n\n" + lines.join("\n\n")
  )
}

export function buildTaskRemoveCard(tasks: TaskDisplayItem[], locale: Locale): Record<string, unknown> {
  if (tasks.length === 0) {
    return {
      schema: "2.0",
      config: { wide_screen_mode: true },
      header: {
        title: {
          tag: "plain_text",
          content: t(locale, "scheduledTask.remove.title"),
        },
        template: "red",
      },
      body: {
        elements: [
          {
            tag: "markdown",
            content: t(locale, "scheduledTask.remove.empty"),
          },
        ],
      },
    }
  }

  const elements: Record<string, unknown>[] = []

  for (const task of tasks) {
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

    elements.push({
      tag: "markdown",
      content:
        `${statusIcon} **${task.name}**\n` +
        `> ID: \`${task.id}\`\n` +
        `> ${task.scheduleSummary}\n` +
        `> 状态: ${enabledLabel} | ${nextRun} | ${lastRun}`,
    })
    elements.push({
      tag: "button",
      text: {
        tag: "plain_text",
        content: `🗑️ 删除: ${task.name}`,
      },
      type: "danger",
      value: { action: "command_execute", command: `/cron remove ${task.id}` },
    })
  }

  elements.push({
    tag: "div",
    text: {
      tag: "lark_md",
      content: t(locale, "scheduledTask.remove.hint"),
    },
  })

  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: "plain_text",
        content: t(locale, "scheduledTask.remove.title"),
      },
      template: "red",
    },
    body: {
      elements,
    },
  }
}

export function buildTaskCreationCard(
  stage: TaskCreationStage,
  data: Partial<TaskCreationState>,
  locale: Locale,
  channelId: string = "feishu",
): string | Record<string, unknown> {
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

    case "preview": {
      const taskData: Partial<ScheduledTask> = {
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
      }
      if (channelId === "feishu") {
        return buildTaskConfirmCard(taskData, locale)
      }
      return buildTaskPreviewCard(taskData, locale)
    }

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
    ``,
    `⏳ **${t(locale, "scheduledTask.preview.confirmHint")}**`,
  ]

  return lines.join("\n")
}

export function buildTaskConfirmCard(
  task: Partial<ScheduledTask>,
  locale: Locale,
): Record<string, unknown> {
  const kindLabel =
    task.kind === "cron"
      ? t(locale, "scheduledTask.kind.cron")
      : t(locale, "scheduledTask.kind.once")

  const modelLabel = task.model
    ? `${task.model.providerID}/${task.model.modelID}`
    : t(locale, "scheduledTask.modelNotSet")

  const scheduleInfo = task.scheduleSummary ?? task.schedule ?? ""

  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: "plain_text",
        content: t(locale, "scheduledTask.preview.title"),
      },
      template: "blue",
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content:
            `**${t(locale, "scheduledTask.preview.name")}:** ${task.name ?? "-"}\n\n` +
            `**${t(locale, "scheduledTask.preview.kind")}:** ${kindLabel}\n\n` +
            `**${t(locale, "scheduledTask.preview.schedule")}:** ${scheduleInfo}\n\n` +
            `**${t(locale, "scheduledTask.preview.model")}:** ${modelLabel}\n\n` +
            `**${t(locale, "scheduledTask.preview.agent")}:** ${task.agent ?? "-"}\n\n` +
            `**${t(locale, "scheduledTask.preview.prompt")}:**\n${task.prompt ?? "-"}`,
        },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `⏳ **${t(locale, "scheduledTask.preview.confirmHint")}**`,
          },
        },
        {
          tag: "button",
          text: {
            tag: "plain_text",
            content: "✅ " + t(locale, "scheduledTask.confirm"),
          },
          type: "primary",
          value: { action: "command_execute", command: "/cron confirm" },
        },
        {
          tag: "button",
          text: {
            tag: "plain_text",
            content: "❌ " + t(locale, "scheduledTask.reject"),
          },
          type: "danger",
          value: { action: "command_execute", command: "/cron reject" },
        },
      ],
    },
  }
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
