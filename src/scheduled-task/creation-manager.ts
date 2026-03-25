import type { Logger } from "../utils/logger.js"
import type {
  ParsedTaskSchedule,
  ScheduledTaskModel,
  TaskCreationStage,
  TaskCreationState,
} from "./types.js"

function createLogger(): Logger {
  return {
    debug: (..._args: unknown[]) => { },
    info: (..._args: unknown[]) => { },
    warn: (..._args: unknown[]) => { },
    error: (..._args: unknown[]) => { },
  }
}

const defaultLogger = createLogger()

function cloneState(state: TaskCreationState): TaskCreationState {
  return { ...state }
}

export class TaskCreationManager {
  private state: TaskCreationState | null = null
  private logger: Logger

  constructor(logger: Logger = defaultLogger) {
    this.logger = logger
  }

  start(
    projectId: string,
    projectWorktree: string,
    model: ScheduledTaskModel,
    agent: string,
    sessionId?: string
  ): TaskCreationState {
    this.state = {
      stage: "awaiting_schedule",
      projectId,
      projectWorktree,
      model,
      agent,
      sessionId: sessionId || null,
      scheduleText: null,
      parsedSchedule: null,
      prompt: null,
      scheduleMessageId: null,
      previewMessageId: null,
    }
    this.logger.info("[TaskCreationManager] Start creation flow", {
      projectId,
      sessionId,
      stage: this.state.stage,
    })
    return cloneState(this.state)
  }

  isActive(): boolean {
    return this.state !== null
  }

  getState(): TaskCreationState | null {
    return this.state ? cloneState(this.state) : null
  }

  setSchedule(
    scheduleText: string,
    parsedSchedule: ParsedTaskSchedule
  ): TaskCreationState | null {
    if (!this.state) {
      this.logger.warn("[TaskCreationManager] setSchedule called but no active state")
      return null
    }
    if (this.state.stage !== "awaiting_schedule") {
      this.logger.warn("[TaskCreationManager] setSchedule called but not in awaiting_schedule stage", {
        currentStage: this.state.stage,
      })
      return null
    }

    this.state = {
      ...cloneState(this.state),
      stage: "awaiting_prompt",
      scheduleText,
      parsedSchedule,
    }
    this.logger.info("[TaskCreationManager] Schedule set, transitioning to awaiting_prompt", {
      stage: this.state.stage,
      scheduleSummary: parsedSchedule.summary,
    })
    return cloneState(this.state)
  }

  markParsing(): TaskCreationState | null {
    if (!this.state) {
      this.logger.warn("[TaskCreationManager] markParsing called but no active state")
      return null
    }
    if (this.state.stage !== "awaiting_schedule") {
      this.logger.warn("[TaskCreationManager] markParsing called but not in awaiting_schedule stage", {
        currentStage: this.state.stage,
      })
      return null
    }

    this.state = {
      ...cloneState(this.state),
      stage: "parsing_schedule",
    }
    this.logger.info("[TaskCreationManager] Marked as parsing_schedule", {
      stage: this.state.stage,
    })
    return cloneState(this.state)
  }

  setPrompt(prompt: string): TaskCreationState | null {
    if (!this.state) {
      this.logger.warn("[TaskCreationManager] setPrompt called but no active state")
      return null
    }
    if (this.state.stage !== "awaiting_prompt") {
      this.logger.warn("[TaskCreationManager] setPrompt called but not in awaiting_prompt stage", {
        currentStage: this.state.stage,
      })
      return null
    }

    this.state = {
      ...cloneState(this.state),
      stage: "preview",
      prompt,
    }
    this.logger.info("[TaskCreationManager] Prompt set, transitioning to preview", {
      stage: this.state.stage,
    })
    return cloneState(this.state)
  }

  confirm(): TaskCreationState | null {
    if (!this.state) {
      this.logger.warn("[TaskCreationManager] confirm called but no active state")
      return null
    }
    if (this.state.stage !== "preview" && this.state.stage !== "confirming") {
      this.logger.warn("[TaskCreationManager] confirm called but not in preview/confirming stage", {
        currentStage: this.state.stage,
      })
      return null
    }

    this.state = {
      ...cloneState(this.state),
      stage: "confirming",
    }
    this.logger.info("[TaskCreationManager] Confirmed, transitioning to confirming", {
      stage: this.state.stage,
    })
    return cloneState(this.state)
  }

  reset(): TaskCreationState | null {
    if (!this.state) {
      this.logger.warn("[TaskCreationManager] reset called but no active state")
      return null
    }
    if (
      this.state.stage === "idle" ||
      this.state.stage === "awaiting_schedule" ||
      this.state.stage === "parsing_schedule"
    ) {
      this.logger.warn("[TaskCreationManager] reset called but nothing to reset from", {
        currentStage: this.state.stage,
      })
      return null
    }

    this.state = {
      ...cloneState(this.state),
      stage: "awaiting_schedule",
      scheduleText: null,
      parsedSchedule: null,
      prompt: null,
      scheduleMessageId: null,
      previewMessageId: null,
    }
    this.logger.info("[TaskCreationManager] Reset to awaiting_schedule", {
      stage: this.state.stage,
    })
    return cloneState(this.state)
  }

  clear(): void {
    if (this.state) {
      this.logger.info("[TaskCreationManager] Clearing creation flow", {
        previousStage: this.state.stage,
      })
    }
    this.state = null
  }
}
