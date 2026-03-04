import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { MessageDebouncer, type BufferedMessage, type FlushCallback } from "../message-debounce.js"
import { createMockLogger } from "../../__tests__/setup.js"
import type { FeishuMessageEvent } from "../../types.js"

function makeEvent(overrides: Partial<FeishuMessageEvent> = {}): FeishuMessageEvent {
  return {
    event_id: "evt-1",
    event_type: "im.message.receive_v1",
    chat_id: "chat-1",
    chat_type: "p2p",
    message_id: "msg-1",
    sender: {
      sender_id: { open_id: "ou-1" },
      sender_type: "user",
      tenant_key: "tk-1",
    },
    message: {
      message_type: "text",
      content: JSON.stringify({ text: "Hello" }),
    },
    ...overrides,
  }
}

function makeBufferedMessage(
  text: string,
  event?: Partial<FeishuMessageEvent>,
): BufferedMessage {
  return {
    userText: text,
    event: makeEvent(event),
    timestamp: Date.now(),
  }
}

describe("MessageDebouncer", () => {
  let onFlush: FlushCallback & ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    onFlush = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("single message flushes after window", () => {
    const debouncer = new MessageDebouncer(2000, onFlush, createMockLogger())
    const msg = makeBufferedMessage("hello")

    debouncer.add("key-1", msg)
    expect(onFlush).not.toHaveBeenCalled()

    vi.advanceTimersByTime(2000)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith(
      "key-1",
      [msg],
      expect.objectContaining({
        firstEvent: msg.event,
        lastEvent: msg.event,
      }),
    )
  })

  it("multiple messages merge into single flush", () => {
    const debouncer = new MessageDebouncer(2000, onFlush, createMockLogger())
    const msg1 = makeBufferedMessage("first")
    const msg2 = makeBufferedMessage("second", { message_id: "msg-2" })
    const msg3 = makeBufferedMessage("third", { message_id: "msg-3" })

    debouncer.add("key-1", msg1)
    debouncer.add("key-1", msg2)
    debouncer.add("key-1", msg3)

    vi.advanceTimersByTime(2000)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith(
      "key-1",
      [msg1, msg2, msg3],
      expect.objectContaining({
        firstEvent: msg1.event,
        lastEvent: msg3.event,
      }),
    )
  })

  it("timer resets on each new message", () => {
    const debouncer = new MessageDebouncer(2000, onFlush, createMockLogger())
    const msg1 = makeBufferedMessage("first")
    const msg2 = makeBufferedMessage("second", { message_id: "msg-2" })

    debouncer.add("key-1", msg1)

    // Advance 1500ms (within window)
    vi.advanceTimersByTime(1500)
    expect(onFlush).not.toHaveBeenCalled()

    // Add another message — should reset the timer
    debouncer.add("key-1", msg2)

    // Advance another 1500ms (3000ms total) — first timer would have fired but was reset
    vi.advanceTimersByTime(1500)
    expect(onFlush).not.toHaveBeenCalled()

    // Advance remaining 500ms to complete second timer
    vi.advanceTimersByTime(500)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith("key-1", [msg1, msg2], expect.any(Object))
  })

  it("different keys are isolated", () => {
    const debouncer = new MessageDebouncer(2000, onFlush, createMockLogger())
    const msgA = makeBufferedMessage("user-a", { sender: { sender_id: { open_id: "ou-a" }, sender_type: "user", tenant_key: "tk-1" } })
    const msgB = makeBufferedMessage("user-b", { sender: { sender_id: { open_id: "ou-b" }, sender_type: "user", tenant_key: "tk-1" } })

    debouncer.add("key-a", msgA)
    debouncer.add("key-b", msgB)

    vi.advanceTimersByTime(2000)
    expect(onFlush).toHaveBeenCalledTimes(2)

    const calls = onFlush.mock.calls as [string, BufferedMessage[], unknown][]
    const keyACall = calls.find(c => c[0] === "key-a")
    const keyBCall = calls.find(c => c[0] === "key-b")
    expect(keyACall).toBeDefined()
    expect(keyBCall).toBeDefined()
    expect(keyACall![1]).toHaveLength(1)
    expect(keyBCall![1]).toHaveLength(1)
    expect(keyACall![1][0]!.userText).toBe("user-a")
    expect(keyBCall![1][0]!.userText).toBe("user-b")
  })

  it("add() returns true for first, false for subsequent", () => {
    const debouncer = new MessageDebouncer(2000, onFlush, createMockLogger())
    const msg1 = makeBufferedMessage("first")
    const msg2 = makeBufferedMessage("second")

    expect(debouncer.add("key-1", msg1)).toBe(true)
    expect(debouncer.add("key-1", msg2)).toBe(false)
  })

  it("updateContext updates thinkingMessageId and reactionId", () => {
    const debouncer = new MessageDebouncer(2000, onFlush, createMockLogger())
    const msg = makeBufferedMessage("hello")

    debouncer.add("key-1", msg)
    debouncer.updateContext("key-1", {
      thinkingMessageId: "think-1",
      reactionId: "react-1",
    })

    vi.advanceTimersByTime(2000)
    expect(onFlush).toHaveBeenCalledWith(
      "key-1",
      [msg],
      expect.objectContaining({
        thinkingMessageId: "think-1",
        reactionId: "react-1",
      }),
    )
  })

  it("updateContext is no-op for non-existent key", () => {
    const debouncer = new MessageDebouncer(2000, onFlush, createMockLogger())
    // Should not throw
    debouncer.updateContext("missing-key", { thinkingMessageId: "x" })
  })

  it("flush() clears buffer and timer", () => {
    const debouncer = new MessageDebouncer(2000, onFlush, createMockLogger())
    const msg = makeBufferedMessage("hello")

    debouncer.add("key-1", msg)
    expect(debouncer.pendingCount).toBe(1)

    debouncer.flush("key-1")
    expect(debouncer.pendingCount).toBe(0)
    expect(onFlush).toHaveBeenCalledTimes(1)

    // Timer should not fire again
    vi.advanceTimersByTime(5000)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it("dispose() clears all timers without flushing", () => {
    const debouncer = new MessageDebouncer(2000, onFlush, createMockLogger())
    debouncer.add("key-1", makeBufferedMessage("a"))
    debouncer.add("key-2", makeBufferedMessage("b"))

    debouncer.dispose()
    expect(debouncer.pendingCount).toBe(0)

    vi.advanceTimersByTime(5000)
    expect(onFlush).not.toHaveBeenCalled()
  })

  it("dispose(true) flushes all remaining batches", () => {
    const debouncer = new MessageDebouncer(2000, onFlush, createMockLogger())
    debouncer.add("key-1", makeBufferedMessage("a"))
    debouncer.add("key-2", makeBufferedMessage("b"))

    debouncer.dispose(true)
    expect(onFlush).toHaveBeenCalledTimes(2)
    expect(debouncer.pendingCount).toBe(0)
  })

  it("onFlush errors are caught and logged", () => {
    const mockLogger = createMockLogger()
    const failingFlush = vi.fn().mockRejectedValue(new Error("flush failed"))
    const debouncer = new MessageDebouncer(2000, failingFlush, mockLogger)

    debouncer.add("key-1", makeBufferedMessage("hello"))
    debouncer.flush("key-1")

    // Error should be caught — no unhandled promise rejection
    // The error logging happens asynchronously via .catch()
    expect(failingFlush).toHaveBeenCalledTimes(1)
  })

  it("messages are ordered by insertion", () => {
    const debouncer = new MessageDebouncer(2000, onFlush, createMockLogger())
    const msg1 = makeBufferedMessage("first")
    const msg2 = makeBufferedMessage("second")
    const msg3 = makeBufferedMessage("third")

    debouncer.add("key-1", msg1)
    debouncer.add("key-1", msg2)
    debouncer.add("key-1", msg3)

    vi.advanceTimersByTime(2000)
    const messages = onFlush.mock.calls[0]![1] as BufferedMessage[]
    expect(messages[0]!.userText).toBe("first")
    expect(messages[1]!.userText).toBe("second")
    expect(messages[2]!.userText).toBe("third")
  })

  it("pendingCount reflects active buffers", () => {
    const debouncer = new MessageDebouncer(2000, onFlush, createMockLogger())

    expect(debouncer.pendingCount).toBe(0)

    debouncer.add("key-1", makeBufferedMessage("a"))
    expect(debouncer.pendingCount).toBe(1)

    debouncer.add("key-2", makeBufferedMessage("b"))
    expect(debouncer.pendingCount).toBe(2)

    // Adding to existing key doesn't increase count
    debouncer.add("key-1", makeBufferedMessage("c"))
    expect(debouncer.pendingCount).toBe(2)

    vi.advanceTimersByTime(2000)
    expect(debouncer.pendingCount).toBe(0)
  })

  it("force-flushes at MAX_BATCH_SIZE (20 messages)", () => {
    const debouncer = new MessageDebouncer(2000, onFlush, createMockLogger())

    for (let i = 0; i < 20; i++) {
      debouncer.add("key-1", makeBufferedMessage(`msg-${i}`))
    }

    // Should flush immediately without waiting for timer
    expect(onFlush).toHaveBeenCalledTimes(1)
    const messages = onFlush.mock.calls[0]![1] as BufferedMessage[]
    expect(messages).toHaveLength(20)
  })

  it("flush() is no-op for non-existent key", () => {
    const debouncer = new MessageDebouncer(2000, onFlush, createMockLogger())
    debouncer.flush("non-existent")
    expect(onFlush).not.toHaveBeenCalled()
  })

  it("hasPending() returns true when buffer has messages", () => {
    const debouncer = new MessageDebouncer(2000, onFlush, createMockLogger())
    expect(debouncer.hasPending("key-1")).toBe(false)

    debouncer.add("key-1", makeBufferedMessage("hello"))
    expect(debouncer.hasPending("key-1")).toBe(true)
    expect(debouncer.hasPending("key-2")).toBe(false)

    debouncer.flush("key-1")
    expect(debouncer.hasPending("key-1")).toBe(false)
  })
})
