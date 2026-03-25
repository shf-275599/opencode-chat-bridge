import type { ParsedTaskSchedule } from "./types.js"

/**
 * Parses natural language schedule expressions into structured data.
 * Supports: "every Nm", "every Nh", "daily HH:MM", "weekly", "cron expr", and specific datetime for one-time tasks.
 */

export function parseSchedule(text: string): ParsedTaskSchedule {
  const trimmed = text.trim()

  const datetimeMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})$/)
  if (datetimeMatch) {
    const [, date, hourStr, minuteStr] = datetimeMatch
    const hour = Number(hourStr)
    const minute = Number(minuteStr)
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new Error(`Invalid datetime "${text}": hour must be 0-23, minute must be 0-59`)
    }
    const runAt = `${date}T${hourStr!.padStart(2, "0")}:${minuteStr!.padStart(2, "0")}:00`
    return {
      cronExpression: `${minute} ${hour} ${date!.split("-")[1]} ${date!.split("-")[2]} *`,
      summary: `Once at ${date} ${hourStr}:${minuteStr!.padStart(2, "0")}`,
      kind: "once",
      runAt,
    }
  }

  const intervalMatch = trimmed.match(/^every\s+(\d+)\s*([mh])$/i)
  if (intervalMatch) {
    const value = Number(intervalMatch[1])
    const unit = intervalMatch[2]!.toLowerCase()
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid schedule "${text}": interval must be a positive number`)
    }
    if (unit === "m") {
      return {
        cronExpression: `0 */${value} * * * *`,
        summary: `Every ${value} minute${value > 1 ? "s" : ""}`,
        kind: "cron",
      }
    }
    return {
      cronExpression: `0 0 */${value} * * *`,
      summary: `Every ${value} hour${value > 1 ? "s" : ""}`,
      kind: "cron",
    }
  }

  const dailyMatch = trimmed.match(/^daily\s+(\d{1,2}):(\d{2})$/i)
  if (dailyMatch) {
    const hour = Number(dailyMatch[1])
    const minute = Number(dailyMatch[2])
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new Error(`Invalid schedule "${text}": invalid time (expected HH:MM with hour 0-23, minute 0-59)`)
    }
    const hourStr = String(hour).padStart(2, "0")
    const minuteStr = String(minute).padStart(2, "0")
    return {
      cronExpression: `0 ${minute} ${hour} * * *`,
      summary: `Daily at ${hourStr}:${minuteStr}`,
      kind: "cron",
    }
  }

  if (/^weekly$/i.test(trimmed)) {
    return {
      cronExpression: `0 0 0 * * 0`,
      summary: "Weekly on Sunday",
      kind: "cron",
    }
  }

  const fields = trimmed.split(/\s+/)
  if (fields.length === 5) {
    if (!isValidCronFields(fields)) {
      throw new Error(`Invalid cron expression "${text}": invalid field values`)
    }
    return {
      cronExpression: `0 ${trimmed}`,
      summary: `Cron: ${trimmed}`,
      kind: "cron",
    }
  }

  if (fields.length === 6) {
    if (!isValidCronFields(fields)) {
      throw new Error(`Invalid cron expression "${text}": invalid field values`)
    }
    return {
      cronExpression: trimmed,
      summary: `Cron: ${trimmed}`,
      kind: "cron",
    }
  }

  throw new Error(`Unrecognized schedule format "${text}". Supported formats: "every Nm", "every Nh", "daily HH:MM", "weekly", "cron expression", or "YYYY-MM-DD HH:MM"`)
}

export function getScheduleSummary(parsed: ParsedTaskSchedule): string {
  return parsed.summary
}

function isValidCronFields(fields: string[]): boolean {
  const fieldCount = fields.length
  if (fieldCount !== 5 && fieldCount !== 6) return false

  // Field positions (0-indexed):
  // 5-field: minute hour day month dayOfWeek
  // 6-field: second minute hour day month dayOfWeek

  const ranges: [number, number][] = fieldCount === 5
    ? [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]]  // minute, hour, day, month, dayOfWeek
    : [[0, 59], [0, 59], [0, 23], [1, 31], [1, 12], [0, 6]] // second, minute, hour, day, month, dayOfWeek

  for (let i = 0; i < fieldCount; i++) {
    const field = fields[i]!
    if (field === "*") continue

    const stepMatch = field.match(/^\*\/(\d+)$/)
    if (stepMatch) {
      const step = Number(stepMatch[1])
      if (step < 1 || step > ranges[i]![1]) return false
      continue
    }

    const rangeMatch = field.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (start < ranges[i]![0] || start > ranges[i]![1]) return false
      if (end < ranges[i]![0] || end > ranges[i]![1]) return false
      if (start > end) return false
      continue
    }

    const listMatch = field.match(/^(\d+(,\d+)*)$/)
    if (listMatch) {
      const parts = field.split(",")
      for (const part of parts) {
        const num = Number(part)
        if (isNaN(num) || num < ranges[i]![0] || num > ranges[i]![1]) return false
      }
      continue
    }

    const num = Number(field)
    if (isNaN(num) || num < ranges[i]![0] || num > ranges[i]![1]) return false
  }

  return true
}
