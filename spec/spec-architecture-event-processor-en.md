---
title: Event Processor Architecture Specification
version: 1.0
date_created: 2026-03-21
owner: opencode-im-bridge team
tags: [architecture, design, events, sse]
---

# Introduction

This specification defines the architecture, requirements, and constraints for the `EventProcessor` and `SessionObserver` components within `opencode-im-bridge`. These components are responsible for ingesting, filtering, and parsing the raw Server-Sent Events (SSE) stream emitted by the `opencode` server and converting it into typed, actionable events for the bridge's routing layers.

## 1. Purpose & Scope

The purpose of the `EventProcessor` is to act as a strict anti-corruption layer separating the internal loosely-typed JSON payloads of opencode from the tightly-typed event bus used by the bridge. The scope covers the parsing of `message.part.updated` and `message.part.delta` events and filtering out non-user-facing content. The `SessionObserver` acts as a background auditor, routing messages back to the IM client if the user initiates an action natively from the TUI rather than the IM client.

## 2. Definitions

- **Raw SSE**: The JSON lines streamed from the `opencode` backend (e.g., `message.part.updated`).
- **ProcessedAction**: The strongly-typed union emitted by the processor (e.g., `TextDelta`, `ToolStateChange`).
- **Reasoning Part**: An internal thought-process text block explicitly emitted by reasoning models (like o1). Must be suppressed from chat outputs to prevent spam.

## 3. Requirements, Constraints & Guidelines

- **REQ-001 (Type Safety)**: The processor must definitively parse raw generic `unknown` JSON objects into discriminated unions (`TextDelta`, `ToolStateChange`, `SubtaskDiscovered`, `SessionIdle`, `QuestionAsked`, `PermissionRequested`) or discard them.
- **REQ-002 (Session Security Scope)**: The processor must instantly discard any events belonging to `sessionId`s not currently tracked in the `ownedSessions` set to prevent multi-tenant cross-talk.
- **REQ-003 (Reasoning Suppression)**: Any `message.part` with `type: "reasoning"` must be identified, tracked by ID, and all subsequent `message.part.delta` chunk updates pointing to that ID must be suppressed.
- **REQ-004 (TUI Observation)**: The `SessionObserver` must buffer any `TextDelta` events that are completely independent of a known IM `message_id` (i.e., triggered by someone typing locally in the native terminal).
- **REQ-005 (Double Stream Prevention)**: If a `StreamingBridge` is actively processing a session, the `SessionObserver` must mark the session as `busy` and halt its own buffered output to prevent duplicated responses in the IM chat.

## 4. Interfaces & Data Contracts

### 4.1 Output Processed Actions
```typescript
type ProcessedAction =
  | { type: "TextDelta"; sessionId: string; text: string }
  | { type: "ToolStateChange"; sessionId: string; toolName: string; state: string; title?: string }
  | { type: "SubtaskDiscovered"; sessionId: string; description: string; agent: string }
  | { type: "SessionIdle"; sessionId: string }
  | { type: "QuestionAsked"; sessionId: string; requestId: string; questions: any[] }
  | { type: "PermissionRequested"; sessionId: string; requestId: string; permissionType: string };
```

### 4.2 Raw SSE Input Examples
```json
// Tool State Change
{
  "type": "message.part.updated",
  "properties": {
    "part": {
      "sessionID": "...",
      "type": "tool",
      "tool": "bash",
      "state": { "status": "running", "title": "Listing directory" }
    }
  }
}
```

## 5. Acceptance Criteria

- **AC-001**: Given a stream of `message.part.delta` events representing a reasoning agent's thoughts, When the core type is tagged as `"reasoning"`, Then the `EventProcessor` returns `null` for every chunk and prevents the bridge from displaying them.
- **AC-002**: Given a user typing `run test` directly into the opencode CLI terminal window, When the TUI agent executes and returns text, Then the `SessionObserver` captures the `TextDelta` chunks with no associated `message_id` and flushes them to the bound Feishu chat automatically on `SessionIdle`.
- **AC-003**: Given a malformed third-party SSE event format, When processed, Then the processor gracefully returns `null` without crashing the JSON parser or the node process.

## 6. Test Automation Strategy

- **Test Levels**: Fast unit tests feeding predefined arrays of JSON string payloads into the `processEvent` method.
- **Test Data Management**: Maintain a snapshot folder of real-world opencode SSE dumps (e.g., `o1-reasoning.jsonl`, `bash-tool-run.jsonl`) to validate backward compatibility.
- **Frameworks**: Vitest inline tests.

## 7. Rationale & Context

- **Why an Anti-Corruption Layer?** The opencode server may update its internal event representation rapidly. Building logic based on `action.type === 'TextDelta'` protects the bridge codebase from upstream refactors.
- **Why TUI Over-The-Shoulder Viewing?** Developers often pivot between their computer (native TUI) and phone (Feishu). If the agent finishes a 20-minute build task while the user is commuting, the `SessionObserver` pushes the terminal output directly to their mobile chat.

## 8. Dependencies & External Integrations

### Data Dependencies
- **DAT-001**: Opencode Server SSE Formats. Requires stable `type` discriminators like `message.part.updated` and `session.idle`.

## 9. Examples & Edge Cases

### Edge Case: Missing Delta Association
A `message.part.delta` might arrive for a `reasoning` chunk before the main `message.part.updated` event defines the chunk as `type: "reasoning"`. The parser guards against this by using `reasoningPartIds`. If a delta arrives for an unknown `partID`, it must be allowed through unless we can guarantee strict ordered delivery.

## 10. Validation Criteria

- Must export comprehensive Typescript interfaces for every output action type.
- Must not retain memory unboundedly (e.g., `reasoningPartIds` should idealy be garbage collected upon session termination).

## 11. Related Specifications / Further Reading
- [Streaming Bridge Specs](./spec-architecture-streaming-bridge.md)
