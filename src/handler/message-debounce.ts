/**
 * Message debounce buffer.
 *
 * Collects consecutive messages from the same user+chat within a
 * configurable time window, then flushes them as a single batch.
 * This prevents Feishu's multi-message pattern (image + text sent
 * separately) from reaching opencode as fragmented requests.
 */

import type { Logger } from "../utils/logger.js"
import type { FeishuMessageEvent } from "../types.js"

// ── Types ──

export interface BufferedMessage {
  userText: string
  event: FeishuMessageEvent
  timestamp: number
}

export interface BatchContext {
  firstEvent: FeishuMessageEvent
  lastEvent: FeishuMessageEvent
  thinkingMessageId: string | null
  reactionId: string | null
}

export type FlushCallback = (
  debounceKey: string,
  messages: BufferedMessage[],
  context: BatchContext,
) => Promise<void>

// ── Constants ──

const MAX_BATCH_SIZE = 20

// ── Class ──

export class MessageDebouncer {
  private readonly buffers = new Map<string, {
    messages: BufferedMessage[]
    context: BatchContext
  }>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly windowMs: number,
    private readonly onFlush: FlushCallback,
    private readonly logger: Logger,
  ) {}

  /**
   * Add a processed message to the debounce buffer.
   * Returns `true` if this is the first message for this key
   * (caller should send thinking indicator).
   */
  add(
    debounceKey: string,
    message: BufferedMessage,
  ): boolean {
    const existing = this.buffers.get(debounceKey)
    const isFirst = !existing

    if (existing) {
      existing.messages.push(message)
      existing.context.lastEvent = message.event
    } else {
      this.buffers.set(debounceKey, {
        messages: [message],
        context: {
          firstEvent: message.event,
          lastEvent: message.event,
          thinkingMessageId: null,
          reactionId: null,
        },
      })
    }

    // Reset timer
    const existingTimer = this.timers.get(debounceKey)
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer)
    }

    // Force-flush if we hit the batch size cap
    const buffer = this.buffers.get(debounceKey)
    if (buffer && buffer.messages.length >= MAX_BATCH_SIZE) {
      this.flush(debounceKey)
      return isFirst
    }

    // Start new timer
    const timer = setTimeout(() => {
      this.flush(debounceKey)
    }, this.windowMs)

    this.timers.set(debounceKey, timer)

    return isFirst
  }

  /**
   * Update batch context after async operations complete
   * (e.g., after thinking indicator is sent).
   */
  updateContext(
    debounceKey: string,
    updates: Partial<BatchContext>,
  ): void {
    const buffer = this.buffers.get(debounceKey)
    if (!buffer) return

    if (updates.thinkingMessageId !== undefined) {
      buffer.context.thinkingMessageId = updates.thinkingMessageId
    }
    if (updates.reactionId !== undefined) {
      buffer.context.reactionId = updates.reactionId
    }
    if (updates.firstEvent !== undefined) {
      buffer.context.firstEvent = updates.firstEvent
    }
    if (updates.lastEvent !== undefined) {
      buffer.context.lastEvent = updates.lastEvent
    }
  }

  /**
   * Immediately flush a specific key.
   */
  flush(debounceKey: string): void {
    const timer = this.timers.get(debounceKey)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.timers.delete(debounceKey)
    }

    const buffer = this.buffers.get(debounceKey)
    if (!buffer) return

    this.buffers.delete(debounceKey)

    this.onFlush(debounceKey, buffer.messages, buffer.context).catch((err) => {
      this.logger.error(`Debounce flush failed for ${debounceKey}: ${err}`)
    })
  }

  /**
   * Clean up all timers. If flushRemaining=true, flush
   * all pending batches before clearing.
   */
  dispose(flushRemaining = false): void {
    if (flushRemaining) {
      const keys = [...this.buffers.keys()]
      for (const key of keys) {
        this.flush(key)
      }
    } else {
      for (const timer of this.timers.values()) {
        clearTimeout(timer)
      }
      this.timers.clear()
      this.buffers.clear()
    }
  }

  /** Number of keys with pending messages. */
  get pendingCount(): number {
    return this.buffers.size
  }

  /** Check if there are pending messages for a key. */
  hasPending(debounceKey: string): boolean {
    return this.buffers.has(debounceKey)
  }
}
