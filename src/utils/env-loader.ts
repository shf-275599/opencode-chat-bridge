/**
 * Minimal .env file loader.
 *
 * Reads KEY=VALUE lines from a .env file and sets them on process.env.
 * Does NOT override values already present in the environment.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

/**
 * 固定配置目录 — 项目内的 config/ 目录。
 * 同时兼容旧的 ~/.config/opencode-lark 路径（优先检查旧目录以支持存量配置）。
 */
export const CONFIG_DIR = (() => {
  // 优先使用旧目录（兼容已有安装）
  const legacyDir = path.join(os.homedir(), ".config", "opencode-lark")
  if (fs.existsSync(legacyDir)) return legacyDir
  // 否则使用项目内的 config/ 目录
  return path.resolve("config")
})()

/** Create CONFIG_DIR recursively if it doesn't exist */
export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

/**
 * Scan CONFIG_DIR for `.env.*` files and extract appId from filenames.
 * E.g. `.env.cli_abc123` → appId "cli_abc123"
 */
export function listEnvFiles(): Array<{ appId: string, filePath: string }> {
  if (!fs.existsSync(CONFIG_DIR)) return []

  const entries = fs.readdirSync(CONFIG_DIR)
  const results: Array<{ appId: string, filePath: string }> = []

  for (const entry of entries) {
    if (entry.startsWith(".env.") && entry.length > 5) {
      const appId = entry.slice(5) // strip ".env."
      results.push({ appId, filePath: path.join(CONFIG_DIR, entry) })
    }
  }

  return results
}

export function loadEnvFile(filePath?: string): void {
  if (!filePath) return

  if (!fs.existsSync(filePath)) return

  const content = fs.readFileSync(filePath, "utf-8")

  for (const line of content.split("\n")) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue

    const eqIndex = trimmed.indexOf("=")
    if (eqIndex === -1) continue

    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()

    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    // Don't override existing env vars
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
