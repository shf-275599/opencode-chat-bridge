---
title: Message Handler Architecture Specification
version: 1.0
date_created: 2026-03-21
owner: opencode-im-bridge-slim team
tags: [architecture, design, message-handling]
---

# Introduction

This specification defines the architecture, requirements, and constraints for the `MessageHandler` component of `opencode-im-bridge-slim`. The message handler serves as the inbound pipeline for processing events from various chat channels (Feishu, QQ, Telegram, Discord) and managing their lifecycle before they are routed to the `opencode` server.

## 1. Purpose & Scope

The purpose of the Message Handler is to reliably process incoming chat events, handle varying channel-specific constraints, and maintain session state mapping between the chat domain and the `opencode` TUI agent. The scope includes message deduplication, file/image parsing, session management, message debouncing, and multi-tier response handling (Streaming Bridge, Event-Driven, and Sync Fallback).

## 2. Definitions

- **IM**: Instant Messaging (e.g., Feishu, QQ, Telegram, Discord).
- **SessionId**: The unique identifier for an `opencode` TUI session.
- **ThreadKey (feishuKey)**: A composite key representing a unique chat thread in the IM (e.g., `chat_id:root_id` or just `chat_id` for p2p).
- **StreamingBridge**: A component that hooks into Server-Sent Events (SSE) from `opencode` to stream delta updates live to supported IM clients.
- **EventProcessor**: A component that consumes raw SSE streams and emits typed operational events (e.g., `TextDelta`, `SessionIdle`).

## 3. Requirements, Constraints & Guidelines

- **REQ-001 (Deduplication)**: The handler must drop duplicated events based on an `event_id` to prevent double-processing.
- **REQ-002 (Channel Aggnosticism)**: The handler must handle incoming events transparently through the `ChannelPlugin` interface, relying on plugins for outbound message delivery and platform-specific formatting.
- **REQ-003 (Mentions)**: In group chats, messages must only be processed if the bot's `open_id` is explicitly mentioned.
- **REQ-004 (Media Support)**: The handler must parse, download, and store attached documents or images locally, replacing the IM message payload with file path pointers for the agent. Path traversal vulnerabilities must be prevented.
- **REQ-005 (Message Debouncing)**: To handle media properly, messages (especially files/images followed quickly by text) must be debounced and batched to combine context.
- **REQ-006 (Context Signatures)**: The handler must append platform tags (e.g., `[Lark]`) to incoming messages to provide the agent with platform awareness.
- **REQ-007 (Slash Commands)**: The handler must yield early if a message triggers a predefined slash command (e.g. `/new`, `/status`).
- **REQ-008 (Response Multi-Tiering)**: The system must gracefully fallback in the following priority: Streaming Bridge -> Event-Driven local collection -> Sync POST Response.
- **REQ-009 (Session Healing)**: If the backend returns HTTP 404 (Session Gone), the handler must scrub the stale session mapping and automatically generate a new mapping, retrying seamlessly.

## 4. Interfaces & Data Contracts

### 4.1 Inbound Message DTO (`FeishuMessageEvent`)
```typescript
interface FeishuMessageEvent {
  event_id: string;
  chat_id: string;
  chat_type: "p2p" | "group";
  message_id: string;
  root_id?: string;
  parent_id?: string;
  message: {
    message_type: "text" | "post" | "image" | "file";
    content: string; // JSON serialized string
  };
  mentions?: Array<{ id: { open_id: string } }>;
}
```

### 4.2 Handler Dependencies (`HandlerDeps`)
The `createMessageHandler` factory expects `HandlerDeps`, injecting `SessionManager`, `EventProcessor`, `StreamingBridge`, `OutboundMediaHandler`, and `ChannelManager`.

## 5. Acceptance Criteria

- **AC-001**: Given a file upload from the user, When the handler processes the message, Then the file is downloaded to the local attachments directory and the prompt is rewritten to include the verified absolute path.
- **AC-002**: Given a group chat message, When the message does not mention the bot's defined openId, Then the handler returns immediately without contacting the opencode server.
- **AC-003**: Given a 404 error from `POST /session/{id}/message`, When the agent is no longer active, Then the handler deletes the mapping, spawns a new session, and retries the exact same prompt automatically.
- **AC-004**: Given a rapid succession of an image followed by a text message, When debouncing is enabled (>0ms), Then the messages are buffered and dispatched to the opencode server as a single prompt with combined context.

## 6. Test Automation Strategy

- **Test Levels**: Unit testing for logic (deduplication, filename sanitization), Integration testing for full flow (mocking HTTP and SSE streams).
- **Frameworks**: Vitest / Jest.
- **Test Data Management**: Create fake `FeishuMessageEvent` objects reflecting basic text, post formats, and images. Mock out the `fs` API to avoid true disk writes.
- **Coverage Requirements**: Minimum 85% branch coverage on the message handler logic, particularly the debounce and 404-recovery paths.

## 7. Rationale & Context

- **Why Debouncing?** Chat platforms often send images and accompanying texts as two separate events. Opencode treats each as a distinct prompt if not batched, causing fragmented context and race conditions in session processing.
- **Why Multi-Tier Fallback?** Some channels (like Telegram, or certain older IM platforms) cannot handle live message modifications easily. Streaming is prioritized for UX, but sync/event-driven collection is essential for rigid IM protocols.
- **Why 404 Self-Healing?** Users often leave a chat idle, and the opencode terminal session might be closed or restarted. Seamlessly resurrecting the session improves retention without making the user explicitly issue a `/new` command.

## 8. Dependencies & External Integrations

### External Systems
- **EXT-001**: opencode HTTP API - The central nervous system hosting TUI agents. Expects `POST /session/{id}/message` interactions.
- **EXT-002**: opencode SSE Stream - The Server-Sent Events endpoint pushing agent activity events (`TextDelta`, `SessionIdle`).

### Third-Party Services
- **SVC-001**: Chat Platforms (Feishu, QQ, Telegram) - Used for fetching message content and media byte streams.

### Infrastructure Dependencies
- **INF-001**: Local Filesystem - Required for maintaining SQLite files and downloading media attachments securely.
- **INF-002**: Memory Runtime - Ephemeral memory is utilized for message deduplication and stream listeners mapping.

## 9. Examples & Edge Cases

### Edge Case: Path Traversal Attack inside Media Files
```typescript
// Incoming file_name: ../../../etc/shadow
function sanitizeFilename(raw: string): string {
  // Must aggressively strip path separators and dots.
  // Must clamp byte lengths to prevent OS file system errors.
}
```

### Edge Case: Concurrent Media and Text
When `isMedia` is true, the incoming event initializes the debounce buffer and fires a thinking/typing indicator immediately but blocks task execution. A subsequent `text` event is placed into the same batch, unblocking the execution cleanly.

## 10. Validation Criteria

- The handler must transparently accept and route requests from dynamically loaded `ChannelPlugin` drivers.
- All code paths must safely clean up SSE memory listeners (`removeListener`) irrespective of network success or HTTP timeouts.
- File writes must use strict permissions (Mode `0o600`).

## 11. Related Specifications / Further Reading

- [Architecture Document](../docs/architecture.md)
- [Implementation Details](../docs/implementation.md)
