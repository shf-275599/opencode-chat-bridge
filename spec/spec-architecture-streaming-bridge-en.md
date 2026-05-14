---
title: Streaming Bridge Architecture Specification
version: 1.0
date_created: 2026-03-21
owner: opencode-im-bridge-slim team
tags: [architecture, design, streaming, UI]
---

# Introduction

This specification defines the architecture, requirements, and constraints for the `StreamingBridge` component of `opencode-im-bridge-slim`. The Streaming Bridge is responsible for providing a real-time, interactive user experience by translating Server-Sent Events (SSE) from the `opencode` agent backend into dynamic chat UI elements (e.g., updating text cards, tool progress indicators).

## 1. Purpose & Scope

The purpose of the `StreamingBridge` is to handle the lifecycle of an agent response actively streamed over SSE. The scope includes receiving text increments (`TextDelta`), tool execution states, sub-agent discoveries, interactive requests (questions and permissions), and finalizing the response upon session completion (`SessionIdle`). It must gracefully degrade on IM platforms that do not support dynamic cards.

## 2. Definitions

- **Streaming Card**: A dynamic UI element in the chat (specifically Feishu) that can be updated in-place via API patches as new content arrives.
- **SSE (Server-Sent Events)**: The protocol used to stream real-time operational events from the `opencode` agent to the bridge.
- **CardKit**: An external service or internal UI wrapper utilized to buffer and serialize updates to Feishu cards, preventing rate-limiting.
- **Interactive Event**: Events like `QuestionAsked` or `PermissionRequested` that require explicit user input via actionable cards.

## 3. Requirements, Constraints & Guidelines

- **REQ-001 (Stream Consumption)**: The bridge must subscribe to the SSE stream via the `EventProcessor` and buffer `TextDelta` chunks, updating the active card dynamically.
- **REQ-002 (Platform Degradation)**: The bridge must exclusively attempt dynamic card streaming on platforms that support it (currently only `feishu`). Unsuported channel plugins must buffer the text silently and dispatch it entirely on completion.
- **REQ-003 (Message Truncation)**: The bridge must protect IM limits by truncating dynamically accumulating text at 102,400 characters, appending `...(内容过长，已截断)`.
- **REQ-004 (First-Event Timeout)**: If no event arrives within 5 minutes (`FIRST_EVENT_TIMEOUT_MS`), the bridge must abort streaming mode, log a timeout, and fallback to parsing the synchronous HTTP POST response text.
- **REQ-005 (Tool State Syncing)**: The bridge must visualize `ToolStateChange` events (e.g., `running`, `completed`, `error`) dynamically in the chat UI.
- **REQ-006 (Sub-Agent Routing)**: When a `SubtaskDiscovered` event fires, the bridge must dispatch a decoupled notification card pointing to the sub-agent's session.
- **REQ-007 (Interactive Modals)**: The bridge must render actionable prompt cards for `QuestionAsked` and `PermissionRequested` events.
- **REQ-008 (Sync Completion)**: Upon receiving `SessionIdle`, the bridge must seal the card, append outbound media/files, and remove all SSE event listeners cleanly.

## 4. Interfaces & Data Contracts

### 4.1 SSE Action Types (from `EventProcessor`)
```typescript
type StreamAction = 
  | { type: "TextDelta"; text: string }
  | { type: "ToolStateChange"; toolName: string; state: string; title: string }
  | { type: "SubtaskDiscovered"; description: string; agent?: string; childSessionId?: string }
  | { type: "QuestionAsked"; requestId: string; questions: any[] }
  | { type: "PermissionRequested"; requestId: string; permissionType: string; title: string }
  | { type: "SessionIdle" };
```

### 4.2 StreamingBridge API
```typescript
interface StreamingBridge {
  handleMessage(
    chatId: string,
    sessionId: string,
    eventListeners: EventListenerMap,
    eventProcessor: EventProcessor,
    sendMessage: () => Promise<string>,
    onComplete: (text: string) => void,
    messageId: string,
    reactionId: string | null,
    channelId?: string,
  ): Promise<void>;
}
```

## 5. Acceptance Criteria

- **AC-001**: Given an active session on Feishu, When an agent writes a deep recursive function taking 2 minutes, Then the user sees a Feishu card updating the text dynamically every 500-1000ms until completion.
- **AC-002**: Given an active session on Discord, When the agent writes a response, Then Discord suppresses streaming, buffers the text in memory, and dispatches the final payload only when `SessionIdle` is received.
- **AC-003**: Given a sub-agent spawn event, When `SubtaskDiscovered` is received, Then the user receives a unique card indicating the sub-agent's name and goal.
- **AC-004**: Given a slow model provider that fails to stream within 5 minutes, When the timer expires, Then the bridge aborts stream listening and directly renders the synchronous response payload to the user cleanly.

## 6. Test Automation Strategy

- **Test Levels**: Predominantly integration testing by mocking the SSE stream emitter and tracing `card.updateText()` and `feishuClient.sendMessage()` calls.
- **Frameworks**: Vitest with FakeTimers (to validate the 5-minute timeout).
- **Test Data Management**: Construct mock `TextDelta` event bursts.
- **Performance Testing**: Verify the internal CardKit buffer prevents more than 2 API requests per second per chat to avoid HTTP 429 limits from Feishu.

## 7. Rationale & Context

- **Why a 5-minute guard?** Depending on the user's workload, the `opencode` TUI might be blocked entirely by an external process or a large web download before the agent can even generate a subtask or text stream. The 5-minute delay assures the bridge doesn't hang indefinitely taking up system memory.
- **Why differentiate Feishu vs. Other Channels?** Platforms like Telegram or Discord offer limited rate limits on editing messages (e.g., Discord limits message edits to 5 per 5 seconds natively, but often fewer in practice, and Telegram has severe rate limits on Bot API). Feishu supports native streaming updates efficiently.

## 8. Dependencies & External Integrations

### External Systems
- **EXT-001**: opencode SSE Backend - Emits Server-Sent Events detailing model activity.

### Third-Party Services
- **SVC-001**: Feishu Open Platform - Handles CardKit UI payloads schema `2.0`.
- **SVC-002**: Other IM Platforms - Via injected `ChannelPlugin` drivers to support flat-text fallbacks.

### Infrastructure Dependencies
- **INF-001**: `CardKitClient` - An intermediary module bridging local state changes to serial JSON patches against Feishu cards.

## 9. Examples & Edge Cases

### Edge Case: Abandoned Streams
If an event stream silently drops (e.g., the opencode process segfaults locally), the `EventProcessor` may cease firing events. The bridge mitigates this somewhat via the POST timeout catch block. The listener cleans itself up safely regardless of promise rejection or fulfillment.

## 10. Validation Criteria

- Must enforce a strict cutoff at `102,400` characters to prevent catastrophic payload explosion.
- Cleanly closes the reactive card (`card.close()`) under both success and throw scenarios.
- Avoids mutating states recursively by validating deduplicated `requestId` tags against the local `seenInteractiveIds` set.

## 11. Related Specifications / Further Reading
- [Message Handler Architecture](./spec-architecture-message-handler.md)
