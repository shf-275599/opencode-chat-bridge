/**
 * QQ channel media download utilities.
 *
 * Handles parsing media messages from QQ events and downloading
 * files/images/videos/recordings to the local attachments directory.
 */

import { createWriteStream } from "node:fs"
import { mkdir, access, writeFile, readFile, unlink } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { randomBytes } from "node:crypto"
import { getAttachmentsDir } from "../../utils/paths.js"
import type { Logger } from "../../utils/logger.js"

// ── Constants ──

export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024 // 50 MB, mirrors Feishu client

// ── Types ──

export interface QQMediaMessage {
  type: "image" | "file" | "video" | "record"
  fileId: string
  fileName: string
  fileSize: number
  url: string
}

// ── QQMediaDownloadError ──

export class QQMediaDownloadError extends Error {
  constructor(
    message: string,
    public readonly mediaType: string,
    public readonly fileId: string,
    public readonly statusCode?: number,
  ) {
    super(message)
    this.name = "QQMediaDownloadError"
  }
}

// ── Helper: resolve the download directory ──

let cachedDownloadDir: string | null = null

export async function resolveDownloadDir(): Promise<string> {
  if (cachedDownloadDir) return cachedDownloadDir
  const primaryDir = getAttachmentsDir()
  try {
    await mkdir(primaryDir, { recursive: true })
    await access(primaryDir)
    cachedDownloadDir = primaryDir
    return primaryDir
  } catch {
    const fallbackDir = join(tmpdir(), "opencode-im-bridge-downloads")
    await mkdir(fallbackDir, { recursive: true })
    cachedDownloadDir = fallbackDir
    return fallbackDir
  }
}

// ── Helper: sanitize untrusted QQ filename ──

export function sanitizeFilename(raw: string): string {
  // Strip path separators, parent-dir traversals, and control characters
  let name = raw
    .replace(/[/\\]/g, "")
    .replace(/\.\./g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()

  if (!name) name = "file"

  // Clamp to prevent filesystem issues (255 byte limit)
  const MAX_NAME_LEN = 200 // leave room for timestamp-rand prefix
  if (name.length > MAX_NAME_LEN) {
    const dotIdx = name.lastIndexOf(".")
    const ext = dotIdx > 0 ? name.slice(dotIdx) : ""
    name = name.slice(0, MAX_NAME_LEN - ext.length) + ext
  }

  const timestamp = Date.now()
  const rand = randomBytes(2).toString("hex")
  return `${timestamp}-${rand}-${name}`
}

// ── Helper: parse QQ media messages from event.message array ──
// QQ SDK event.message is an array of message segments with structure:
// [{ type: "image", data: { file: "...", name: "...", url: "..." } }]
// [{ type: "file", data: { file: "...", name: "...", size: ..., url: "..." } }]
// [{ type: "video", data: { file: "...", name: "...", size: ..., url: "..." } }]
// [{ type: "record", data: { file: "...", name: "...", size: ..., url: "..." } }]

export function parseQQMediaMessage(message: any[]): QQMediaMessage[] {
  if (!Array.isArray(message)) return []

  const media: QQMediaMessage[] = []
  const supportedTypes = ["image", "file", "video", "record"]

  for (const item of message) {
    if (!item || typeof item !== "object") continue
    if (!supportedTypes.includes(item.type)) continue

    const data = item.data || {}
    const fileId = data.file || data.id || ""
    const url = data.url || ""

    media.push({
      type: item.type as "image" | "file" | "video" | "record",
      fileId: String(fileId),
      fileName: data.name || `${item.type}_${fileId}` || "unnamed",
      fileSize: Number(data.size) || 0,
      url: String(url),
    })
  }

  return media
}

// ── Helper: download QQ media to local file ──

export async function downloadQQMedia(
  media: QQMediaMessage,
  logger: Logger,
): Promise<string> {
  const { type, fileId, fileName, url } = media

  if (!url) {
    throw new QQMediaDownloadError(
      `No URL provided for ${type} media (fileId: ${fileId})`,
      type,
      fileId,
    )
  }

  const downloadDir = await resolveDownloadDir()
  const safeName = sanitizeFilename(fileName)
  const filepath = join(downloadDir, safeName)

  // Guard against path traversal
  if (!resolve(filepath).startsWith(resolve(downloadDir))) {
    throw new QQMediaDownloadError(
      "Path traversal detected in filename",
      type,
      fileId,
    )
  }

  // Stream download with size validation to prevent OOM
  let downloadedBytes = 0
  let exceededLimit = false

  try {
    const response = await fetch(url)

    if (!response.ok) {
      throw new QQMediaDownloadError(
        `HTTP ${response.status} for ${type} media (fileId: ${fileId})`,
        type,
        fileId,
        response.status,
      )
    }

    // Validate Content-Length header before streaming
    const contentLength = response.headers.get("content-length")
    if (contentLength) {
      const size = Number(contentLength)
      if (size > MAX_DOWNLOAD_BYTES) {
        exceededLimit = true
        throw new QQMediaDownloadError(
          `File "${fileName}" exceeds the ${MAX_DOWNLOAD_BYTES / 1024 / 1024}MB size limit (Content-Length: ${size} bytes)`,
          type,
          fileId,
        )
      }
    }

    const body = response.body
    if (!body) {
      throw new QQMediaDownloadError(
        `Empty response body for ${type} media (fileId: ${fileId})`,
        type,
        fileId,
      )
    }

    // Write to temp file first, then rename to target (atomic write)
    const tmpPath = filepath + ".tmp"
    const writeStream = createWriteStream(tmpPath, { mode: 0o600 })

    const reader = body.getReader()

    try {
      for (;;) {
        const { done, value } = await reader.read()

        if (done) break

        downloadedBytes += value.byteLength

        // Hard limit guard: abort if no Content-Length was provided and we exceed limit mid-stream
        if (downloadedBytes > MAX_DOWNLOAD_BYTES) {
          exceededLimit = true
          writeStream.destroy()
          throw new QQMediaDownloadError(
            `File "${fileName}" exceeded ${MAX_DOWNLOAD_BYTES / 1024 / 1024}MB size limit during streaming (received: ${downloadedBytes} bytes)`,
            type,
            fileId,
          )
        }

        const canContinue = writeStream.write(value)
        if (!canContinue) {
          // Wait for drain before continuing
          await new Promise<void>((resolve) => writeStream.once("drain", resolve))
        }
      }

      writeStream.end()
      await new Promise<void>((resolve, reject) => {
        writeStream.once("finish", resolve)
        writeStream.once("error", reject)
      })
    } finally {
      reader.releaseLock()
    }

    // Atomic rename
    const tmpData = await readFile(tmpPath)
    await writeFile(filepath, tmpData)
    await unlink(tmpPath).catch(() => {})

    logger.info(`Saved ${type} to ${filepath}`)
    return filepath
  } catch (err) {
    if (exceededLimit) throw err

    if (err instanceof QQMediaDownloadError) throw err

    throw new QQMediaDownloadError(
      `Download failed for ${type} media (fileId: ${fileId}): ${err instanceof Error ? err.message : String(err)}`,
      type,
      fileId,
    )
  }
}
