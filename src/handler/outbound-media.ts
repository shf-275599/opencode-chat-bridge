/**
 * Outbound media handler — detects file paths in agent replies
 * and sends them to the target channel as image messages.
 *
 * Security: only files within allowed directories may be uploaded.
 * Symlinks are resolved via fs.realpath to prevent escaping the allowlist.
 *
 * Design: uses ChannelOutboundAdapter.sendImage (optional) so each channel
 * plugin is responsible for its own upload/send logic. Falls back silently
 * if the plugin does not implement sendImage.
 */

import { stat, realpath } from "node:fs/promises"
import { resolve } from "node:path"
import { homedir } from "node:os"
import type { ChannelOutboundAdapter, OutboundTarget } from "../channel/types.js"
import type { Logger } from "../utils/logger.js"
import { getAttachmentsDir } from "../utils/paths.js"

// ── Public types ──

export interface OutboundMediaDeps {
  /**
   * Channel outbound adapter that implements sendImage.
   * Optional at construction time — sendDetectedFiles is a no-op when not provided.
   * Callers (streaming-integration, message-handler) should inject the correct
   * channel plugin's outbound adapter per message.
   */
  outbound?: ChannelOutboundAdapter
  logger: Logger
  /** Extra directories (absolute) from which uploads are allowed. */
  allowedUploadDirs?: string[]
}

export interface OutboundMediaHandler {
  sendDetectedFiles(target: OutboundTarget, text: string, outboundAdapter?: ChannelOutboundAdapter): Promise<void>
}

// ── Constants ──

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

// SVG excluded — treated as a regular file, not an image
const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp)$/i

// ── Path extraction ──

export function expandTilde(p: string): string {
  if (p.startsWith("~/")) {
    return resolve(homedir(), p.slice(2))
  }
  return p
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/")
}

const EXT_REGEX = /\.(png|jpg|jpeg|gif|webp|pdf|svg|doc|docx|xls|xlsx|csv|zip|tar|gz|mp3|mp4|wav|mov|avi|txt|md|json|yaml|yml|html|css|js|ts|py)$/i

export function extractFilePaths(text: string): string[] {
  const seen = new Set<string>()
  const results: string[] = []

  for (const match of text.matchAll(/([A-Za-z]:[/\\][^ "'`<>|*?:]+)/g)) {
    const raw = match[1]
    if (!raw || !EXT_REGEX.test(raw)) continue
    const normalized = normalizePath(raw)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      results.push(normalized)
    }
  }

  for (const match of text.matchAll(/([/~][^ "'`<>|*?:\\]+)/g)) {
    const raw = match[1]
    if (!raw || !EXT_REGEX.test(raw)) continue
    const expanded = expandTilde(raw)
    const normalized = normalizePath(expanded)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      results.push(normalized)
    }
  }

  for (const match of text.matchAll(/`file:(\/[^`]+)`/g)) {
    const raw = match[1]
    if (!raw || !EXT_REGEX.test(raw)) continue
    const expanded = expandTilde(raw)
    const normalized = normalizePath(expanded)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      results.push(normalized)
    }
  }

  return results
}

function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.test(filePath)
}

// ── Allowlist helpers ──

function defaultAllowedDir(): string {
  return getAttachmentsDir()
}

function buildAllowlist(extraDirs?: string[]): string[] {
  const dirs = [normalizePath(defaultAllowedDir())]
  if (extraDirs) {
    for (const d of extraDirs) {
      dirs.push(normalizePath(resolve(d)))
    }
  }
  return dirs
}

/**
 * Resolve symlinks and check the real path against the allowlist.
 * Returns the resolved real path if allowed, null otherwise.
 */
async function resolveAllowedPath(
  filePath: string,
  allowlist: string[],
  logger: Logger,
): Promise<string | null> {
  let real: string
  try {
    real = await realpath(filePath)
  } catch {
    // File doesn't exist or can't be resolved
    return null
  }

  const normalizedReal = normalizePath(real)
  for (const dir of allowlist) {
    if (normalizedReal === dir || normalizedReal.startsWith(dir + "/")) {
      return normalizedReal
    }
  }
  logger.warn(
    `Blocked upload: resolved path "${real}" is outside allowed directories [${allowlist.join(", ")}]`,
  )
  return null
}

// ── Factory ──

export function createOutboundMediaHandler(
  deps: OutboundMediaDeps,
): OutboundMediaHandler {
  const { outbound, logger } = deps
  const allowlist = buildAllowlist(deps.allowedUploadDirs)

  return {
    async sendDetectedFiles(target: OutboundTarget, text: string, outboundAdapter?: ChannelOutboundAdapter): Promise<void> {
      const adapter = outboundAdapter ?? outbound
      // Skip entirely if no outbound adapter or it doesn't support sendImage
      if (!adapter?.sendImage) {
        logger.debug("Channel plugin not provided or does not implement sendImage, skipping media detection")
        return
      }

      const paths = [...new Set(extractFilePaths(text))]
      if (paths.length === 0) {
        logger.debug(`No file paths detected in response text (${text.length} chars)`)
        return
      }

      // Filter to image files only
      const imagePaths = paths.filter(isImageFile)
      if (imagePaths.length === 0) {
        logger.debug("No image file paths detected in response text")
        return
      }

      logger.info(`Detected ${imagePaths.length} image path(s) in agent reply, attempting send`)

      for (const filePath of imagePaths) {
        try {
          // Cheap string prefilter — skip FS calls for paths clearly outside allowlist
          const resolved = normalizePath(resolve(filePath))
          if (!allowlist.some((dir) => resolved === dir || resolved.startsWith(dir + "/"))) {
            logger.debug(`Skipped ${filePath}: outside allowed directories (prefilter)`)
            continue
          }

          // Security: resolve symlinks and verify path is within allowlist
          const realPath = await resolveAllowedPath(filePath, allowlist, logger)
          if (!realPath) continue

          // Check file size using resolved path
          const fileStat = await stat(realPath)
          if (fileStat.size > MAX_UPLOAD_BYTES) {
            logger.warn(`Skipping ${realPath}: exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB size limit`)
            continue
          }

          // Delegate to channel plugin — it owns the upload/send implementation
          await adapter.sendImage(target, realPath)
          logger.info(`Sent image via channel plugin: ${realPath}`)
        } catch (err) {
          logger.warn(`Failed to send image ${filePath}: ${err}`)
        }
      }
    },
  }
}
