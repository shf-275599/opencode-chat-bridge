const TELEGRAM_CALLBACK_PREFIX = "tg1"
const TELEGRAM_MAX_CALLBACK_BYTES = 64

export type TelegramCallbackAction =
  | "cmd"
  | "qa"
  | "pr"

export interface TelegramCallbackPayload {
  action: TelegramCallbackAction
  command?: string
  requestId?: string
  answers?: string[][]
  reply?: "once" | "always" | "reject"
}

export interface TelegramInlineButton {
  text: string
  callback_data: string
}

export interface TelegramInlineCard {
  text: string
  parse_mode?: "HTML" | "MarkdownV2"
  reply_markup: {
    inline_keyboard: TelegramInlineButton[][]
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length
}

export function encodeTelegramCallbackPayload(payload: TelegramCallbackPayload): string | null {
  let encoded: string | null = null

  if (payload.action === "cmd" && payload.command) {
    encoded = `${TELEGRAM_CALLBACK_PREFIX}|cmd|${payload.command}`
  } else if (payload.action === "qa" && payload.requestId && payload.answers) {
    const flatAnswers = payload.answers.map((row) => row.join(",")).join(";")
    encoded = `${TELEGRAM_CALLBACK_PREFIX}|qa|${payload.requestId}|${flatAnswers}`
  } else if (payload.action === "pr" && payload.requestId && payload.reply) {
    encoded = `${TELEGRAM_CALLBACK_PREFIX}|pr|${payload.requestId}|${payload.reply}`
  }

  if (!encoded || utf8Bytes(encoded) > TELEGRAM_MAX_CALLBACK_BYTES) {
    return null
  }

  return encoded
}

export function decodeTelegramCallbackPayload(raw: string): TelegramCallbackPayload | null {
  const [prefix, action, arg1 = "", arg2 = ""] = raw.split("|")
  if (prefix !== TELEGRAM_CALLBACK_PREFIX) return null

  if (action === "cmd") {
    return {
      action: "cmd",
      command: arg1,
    }
  }

  if (action === "qa") {
    return {
      action: "qa",
      requestId: arg1,
      answers: arg2
        ? arg2.split(";").filter(Boolean).map((row) => row.split(",").filter(Boolean))
        : [],
    }
  }

  if (action === "pr" && (arg2 === "once" || arg2 === "always" || arg2 === "reject")) {
    return {
      action: "pr",
      requestId: arg1,
      reply: arg2,
    }
  }

  return null
}

export function createTelegramInlineCard(
  text: string,
  rows: Array<Array<{ text: string; payload: TelegramCallbackPayload }>>,
): TelegramInlineCard | null {
  const inline_keyboard: TelegramInlineButton[][] = []

  for (const row of rows) {
    const encodedRow: TelegramInlineButton[] = []
    for (const button of row) {
      const callback_data = encodeTelegramCallbackPayload(button.payload)
      if (!callback_data) return null
      encodedRow.push({
        text: button.text,
        callback_data,
      })
    }
    if (encodedRow.length > 0) {
      inline_keyboard.push(encodedRow)
    }
  }

  if (inline_keyboard.length === 0) {
    return null
  }

  return {
    text,
    reply_markup: {
      inline_keyboard,
    },
  }
}
