/**
 * Voice transcriber module.
 *
 * Downloads an audio file from Feishu, converts it from OPUS to PCM format
 * using ffmpeg, and transcribes it using the Feishu ASR API.
 *
 * Gracefully handles missing ffmpeg and ASR failures by returning
 * user-facing fallback messages instead of throwing.
 */

import { createLogger } from "../utils/logger.js"
import { spawn, type ChildProcess } from "node:child_process"
import { writeFile, readFile, unlink } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const logger = createLogger("voice-transcriber")

export interface VoiceTranscribeResult {
  text: string
  durationMs: number
}

function convertToPcm(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let proc: ChildProcess
    try {
      proc = spawn("ffmpeg", [
        "-y",
        "-i", inputPath,
        "-acodec", "pcm_s16le",
        "-ac", "1",
        "-ar", "16000",
        "-f", "s16le",
        outputPath,
      ])
    } catch (err) {
      reject(err)
      return
    }
    // ffmpeg logs progress and metadata to stderr — swallow it
    if (proc.stderr) proc.stderr.on("data", () => {})
    proc.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}`))
    })
    proc.on("error", reject)
  })
}

function isFfmpegNotFound(err: unknown): boolean {
  if (err instanceof Error) {
    if (hasCode(err, "ENOENT")) return true
    if (err.message.includes("ENOENT") || err.message.includes("spawn ffmpeg ENOENT")) return true
  }
  return false
}

function hasCode(err: Error, code: string): boolean {
  return (err as unknown as Record<string, unknown>).code === code
}

export interface VoiceTranscriberClient {
  downloadResource: (
    messageId: string,
    fileKey: string,
    type: "file",
  ) => Promise<{ data: Buffer; filename?: string }>
  speechToText: (audioData: Buffer) => Promise<string>
}

export function createVoiceTranscriber(feishuClient: VoiceTranscriberClient) {
  return {
    async transcribe(
      messageId: string,
      fileKey: string,
      durationMs: number,
    ): Promise<VoiceTranscribeResult> {
      logger.info(`Downloading audio message=${messageId} fileKey=${fileKey}`)
      let downloadResult: { data: Buffer; filename?: string }
      try {
        downloadResult = await feishuClient.downloadResource(messageId, fileKey, "file")
      } catch (err) {
        logger.error(`Download failed for message ${messageId}: ${err}`)
        throw err
      }

      const ts = Date.now()
      const opusPath = join(tmpdir(), `voice-${messageId}-${ts}.opus`)
      const pcmPath = join(tmpdir(), `voice-${messageId}-${ts}.pcm`)

      try {
        logger.info(`Writing OPUS audio to ${opusPath}`)
        await writeFile(opusPath, downloadResult.data)

        logger.info("Converting OPUS to PCM (16kHz, mono, s16le)")
        try {
          await convertToPcm(opusPath, pcmPath)
        } catch (err) {
          if (isFfmpegNotFound(err)) {
            logger.warn("ffmpeg not available — returning graceful fallback")
            return { text: "[语音消息 — 转码失败：未安装 ffmpeg]", durationMs }
          }
          logger.error(`ffmpeg conversion failed: ${err}`)
          throw err
        }

        logger.info("Reading PCM output")
        const pcmBuffer = await readFile(pcmPath)

        logger.info("Calling Feishu speech_to_text API")
        let transcribedText: string
        try {
          transcribedText = await feishuClient.speechToText(pcmBuffer)
        } catch (err) {
          logger.error(`Feishu ASR failed: ${err}`)
          return { text: "[语音消息 — 语音识别失败]", durationMs }
        }

        const trimmed = transcribedText.slice(0, 80)
        logger.info(`Transcription result: "${trimmed}..."`)
        return { text: transcribedText, durationMs }
      } finally {
        await unlink(opusPath).catch(() => {})
        await unlink(pcmPath).catch(() => {})
        logger.debug("Temp audio files cleaned up")
      }
    },
  }
}
