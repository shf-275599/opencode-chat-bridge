import { en, type EnglishLocale } from "./locales/en.js"
import { zhCN, type ChineseLocale } from "./locales/zh-CN.js"

export type Locale = "en" | "zh-CN"
export type LocaleStrings = EnglishLocale | ChineseLocale

const locales: Record<Locale, LocaleStrings> = {
  en,
  "zh-CN": zhCN,
}

export const defaultLocale: Locale = "en"

export function getLocale(channelId?: string): Locale {
  if (!channelId) return defaultLocale
  if (channelId === "feishu" || channelId === "lark" || channelId === "wechat") {
    return "zh-CN"
  }
  return defaultLocale
}

type TranslateKey<S extends LocaleStrings, Path extends string> =
  Path extends keyof S ? S[Path]
    : Path extends `${infer K}.${infer Rest}`
      ? K extends keyof S ? TranslateKey<S[K], Rest>
      : never
      : never

export function t<Key extends string>(
  locale: Locale,
  key: Key,
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
export type { EnglishLocale, ChineseLocale }
