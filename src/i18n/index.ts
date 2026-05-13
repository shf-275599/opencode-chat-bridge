import { en } from "./locales/en.js"
import { zhCN } from "./locales/zh-CN.js"

export type Locale = "en" | "zh-CN"

const locales = {
  en,
  "zh-CN": zhCN,
} as const

export const defaultLocale: Locale = "en"

export function getLocale(channelId?: string): Locale {
  if (!channelId) return defaultLocale
  if (channelId === "feishu" || channelId === "lark" || channelId === "wechat") {
    return "zh-CN"
  }
  return defaultLocale
}

export function t(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const keys = key.split(".")
  let value: unknown = locales[locale]

  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = (value as Record<string, unknown>)[k]
    } else {
      console.warn(`[i18n] Missing translation key: ${key} for locale ${locale}`)
      return key
    }
  }

  if (typeof value !== "string") {
    console.warn(`[i18n] Translation value is not a string: ${key}`)
    return key
  }

  if (!params) return value

  return value.replace(/\{(\w+)\}/g, (_, paramKey) => {
    return params[paramKey]?.toString() ?? `{${paramKey}}`
  })
}

export { en, zhCN }
