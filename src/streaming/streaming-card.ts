/**
 * High-level streaming card session manager.
 * Wraps CardKitClient with throttling, tool status, sub-agent buttons,
 * and full lifecycle management.
 */

import type { CardKitClient, CardKitSchema } from "../feishu/cardkit-client.js"
import type { FeishuApiClient } from "../feishu/api-client.js"

export interface StreamingCardOptions {
  cardkitClient: CardKitClient
  feishuClient: FeishuApiClient
  chatId: string
}

interface CardState {
  cardId: string
  messageId: string
  sequence: number
  currentText: string
}

interface ToolStatus {
  name: string
  state: "running" | "completed" | "error"
  title?: string
}

interface SubtaskButton {
  label: string
  actionValue: string
}

export class StreamingCardSession {
  private readonly cardkitClient: CardKitClient
  private readonly feishuClient: FeishuApiClient
  private readonly chatId: string

  private state: CardState | null = null
  private closed = false
  private queue: Promise<void> = Promise.resolve()
  private lastSentContent = ""

  private toolStatuses: ToolStatus[] = []
  private subtaskButtons: SubtaskButton[] = []

  constructor(options: StreamingCardOptions) {
    this.cardkitClient = options.cardkitClient
    this.feishuClient = options.feishuClient
    this.chatId = options.chatId
  }

  get isActive(): boolean {
    return this.state !== null && !this.closed
  }

  async start(): Promise<void> {
    if (this.state) {
      return
    }

    const cardJson: CardKitSchema = {
      schema: "2.0",
      config: {
        streaming_mode: true,
        summary: { content: "[Generating...]" },
        streaming_config: {
          print_frequency_ms: { default: 200 },
          print_step: { default: 10 },
        },
      },
      body: {
        elements: [
          { tag: "markdown", content: "🛠️ Processing...", element_id: "content" },
        ],
      },
    }

    const cardId = await this.cardkitClient.createCard(cardJson)

    const result = await this.feishuClient.sendMessage(this.chatId, {
      msg_type: "interactive",
      content: JSON.stringify({ type: "card", data: { card_id: cardId } }),
    })

    const messageId = result.data?.["message_id"] as string | undefined
    if (!messageId) {
      throw new Error("sendMessage returned no message_id")
    }

    this.state = { cardId, messageId, sequence: 1, currentText: "" }
  }


  async setToolStatus(name: string, state: "running" | "completed" | "error", title?: string): Promise<void> {
    if (!this.state || this.closed) {
      return
    }

    const existing = this.toolStatuses.find((t) => t.name === name)
    if (existing) {
      existing.state = state
      if (title !== undefined) existing.title = title
    } else {
      this.toolStatuses.push({ name, state, title })
    }

    // Build tool status text and update the content element
    const fullContent = this.buildFullContent()
    await this.enqueueUpdate(fullContent)
  }

  async updateText(text: string): Promise<void> {
    if (!this.state || this.closed) {
      return
    }

    this.state.currentText = text
    const fullContent = this.buildFullContent()
    await this.enqueueUpdate(fullContent)
  }

  async addSubtaskButton(label: string, actionValue: string): Promise<void> {
    if (!this.state || this.closed) {
      return
    }

    this.subtaskButtons.push({ label, actionValue })

    // Rebuild full content with buttons section
    const fullContent = this.buildFullContent()
    await this.enqueueUpdate(fullContent)
  }

  async close(finalText?: string): Promise<void> {
    if (!this.state || this.closed) {
      return
    }
    this.closed = true
    await this.queue
    // Final content: use finalText override, tool status content, or "Done" fallback
    const text = finalText ?? (this.toolStatuses.length > 0 ? this.buildFullContent() : "✅ Done")
    // Only send final update if content differs from what was last sent
    if (text && text !== this.lastSentContent) {
      this.state.sequence += 1
      await this.cardkitClient.updateElement(
        this.state.cardId,
        "content",
        text,
        this.state.sequence,
      )
    }

    // Close streaming mode with tool-focused summary
    const completed = this.toolStatuses.filter(t => t.state === "completed").length
    const summary = completed > 0 ? `✅ ${completed} tool(s) used` : "Done"
    this.state.sequence += 1
    await this.cardkitClient.closeStreaming(
      this.state.cardId,
      summary,
      this.state.sequence,
    )
  }

  private async enqueueUpdate(content: string): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (!this.state || this.closed) {
        return
      }
      this.state.sequence += 1
      await this.cardkitClient.updateElement(
        this.state.cardId,
        "content",
        content,
        this.state.sequence,
      )
      this.lastSentContent = content
    })
    await this.queue
  }

  private buildToolStatusText(): string {
    if (this.toolStatuses.length === 0) {
      return ""
    }
    const icons: Record<string, string> = {
      running: "🔄",
      completed: "✅",
      error: "❌",
    }
    const lines = this.toolStatuses.map(
      (t) => t.title ? `${icons[t.state]} ${t.name} · ${t.title}` : `${icons[t.state]} ${t.name}`,
    )
    return "\n\n---\n" + lines.join("\n")
  }

  private buildButtonsText(): string {
    if (this.subtaskButtons.length === 0) {
      return ""
    }
    const lines = this.subtaskButtons.map(
      (b) => `🔗 [${b.label}](${b.actionValue})`,
    )
    return "\n\n---\n" + lines.join("\n")
  }

  private buildFullContent(): string {
    const mainText = (this.state?.currentText || "")
      // Strip file:// URLs — Feishu clients can't access local paths and
      // Feishu would interpret them as invalid image keys in card content.
      .replace(/!?\[[^\]]*\]\(file:\/\/[^)]+\)/g, "")
      .trim()
    const toolText = this.buildToolStatusText()
    const buttonText = this.buildButtonsText()
    return (mainText + toolText + buttonText).trim() || "🛠️ Processing..."
  }
}