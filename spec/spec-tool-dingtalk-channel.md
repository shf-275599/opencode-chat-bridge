---
title: DingTalk Channel Plugin Integration Specification
version: 1.0
date_created: 2026-03-29
owner: opencode-im-bridge Team
tags: `channel`, `integration`, `dingtalk`, `tool`
---

# Introduction

This specification defines the requirements, interfaces, and implementation guidelines for integrating DingTalk (钉钉) as a channel plugin in the opencode-im-bridge system. The integration must provide feature parity with existing platform integrations (Feishu, QQ, Telegram, Discord, WeChat), enabling users to interact with opencode through DingTalk with full support for messaging, streaming responses, media sharing, and interactive cards.

## 1. Purpose & Scope

### Purpose

Define a complete, AI-ready specification for implementing DingTalk channel support in opencode-im-bridge. The specification ensures consistent behavior across all supported platforms and provides clear implementation guidance.

### Scope

- **In Scope**: DingTalk channel plugin implementation, configuration, message normalization, outbound messaging, streaming support, media handling, threading, and integration with existing opencode-im-bridge services.
- **Out of Scope**: Specific deployment configurations, DingTalk enterprise admin setup beyond API credentials, rate limiting strategies beyond API constraints.

### Intended Audience

- Developers implementing DingTalk channel integration
- QA engineers validating channel implementation
- System architects evaluating platform extensions

### Assumptions

- DingTalk Open Platform account with bot capabilities is pre-configured
- Developer has access to DingTalk application credentials (AppKey, AppSecret)
- Network connectivity to DingTalk Open API endpoints is available

---

## 2. Definitions

### Acronyms & Abbreviations

| Acronym | Definition |
|---------|------------|
| `ChannelId` | Branded string type uniquely identifying a channel provider |
| `ThreadKey` | Branded string type identifying a conversation thread |
| `NormalizedMessage` | Standard message format internal to opencode-im-bridge |
| `OutboundMessage` | Message structure prepared for channel-specific delivery |
| `StreamingSession` | Active session managing real-time message updates |
| `CardKit` | Interactive card message format (referenced from Feishu implementation) |
| `SSE` | Server-Sent Events - real-time streaming protocol used by opencode |

### Domain-Specific Terms

| Term | Definition |
|------|------------|
| `DingTalk Open Platform` | Official DingTalk API platform (open.dingtalk.com) providing bot and message APIs |
| `Webhook` | HTTP callback endpoint for receiving DingTalk events |
| `StreamTarget` | Destination specification for streaming operations |
| `Card Message` | Rich interactive message format supported by DingTalk |
| `Access Token` | OAuth token required for DingTalk API authentication |

---

## 3. Requirements, Constraints & Guidelines

### Functional Requirements

- **REQ-001**: The DingTalk plugin MUST implement the `ChannelPlugin` interface from `src/channel/types.ts`
- **REQ-002**: The plugin MUST support receiving text messages via DingTalk Long Polling or WebSocket connection
- **REQ-003**: The plugin MUST support sending text messages to DingTalk users/groups
- **REQ-004**: The plugin MUST support sending interactive card messages for streaming responses
- **REQ-005**: The plugin MUST support sending image, file, audio, and video media messages
- **REQ-006**: The plugin MUST implement the `ChannelMessagingAdapter` for message normalization
- **REQ-007**: The plugin MUST implement the `ChannelOutboundAdapter` for message delivery
- **REQ-008**: The plugin MUST implement the `ChannelGatewayAdapter` for connection lifecycle
- **REQ-009**: The plugin MUST implement the `ChannelStreamingAdapter` for real-time streaming support
- **REQ-010**: The plugin MUST implement the `ChannelThreadingAdapter` for thread/session mapping
- **REQ-011**: The plugin MUST extend `BaseChannelPlugin` for default threading behavior

### Security Requirements

- **SEC-001**: AppSecret MUST NOT be logged or exposed in error messages
- **SEC-002**: Access tokens MUST be stored securely and refreshed before expiry
- **SEC-003**: Incoming webhook payloads MUST be validated for authenticity
- **SEC-004**: File paths for media uploads MUST be validated against an allowlist before access

### Configuration Requirements

- **CFG-001**: Configuration MUST be loaded from `opencode-im-bridge.jsonc` or environment variables
- **CFG-002**: Required environment variables: `DINGTALK_APP_KEY`, `DINGTALK_APP_SECRET`
- **CFG-003**: Optional environment variables: `DINGTALK_BOT_NAME`, `DINGTALK_WEBHOOK_PORT`
- **CFG-004**: The plugin MUST support multiple bot accounts via account ID resolution

### Integration Requirements

- **INT-001**: The plugin MUST integrate with `StreamingBridge` for SSE-to-card streaming
- **INT-002**: The plugin MUST integrate with `SessionManager` for thread-to-session mapping
- **INT-003**: The plugin MUST integrate with `EventProcessor` for SSE event handling
- **INT-004**: The plugin MUST register with `ChannelManager` in `src/index.ts` Phase 6
- **INT-005**: The plugin MUST support interactive card callbacks (questions, permissions)

### Platform-Specific Constraints

- **CON-001**: DingTalk API rate limits MUST be respected (typically 1000 requests/minute for bots)
- **CON-002**: Card message format MUST comply with DingTalk's interactive card schema
- **CON-003**: Media upload MUST use DingTalk's file upload API with proper content-type
- **CON-004**: Long polling timeout MUST be set to 25-30 seconds to avoid connection drops

### Implementation Guidelines

- **GUD-001**: Follow existing plugin patterns from `feishu-plugin.ts` and `wechat-plugin.ts`
- **GUD-002**: Use explicit `.js` extensions for ESM imports as per NodeNext resolution
- **GUD-003**: Use shared logger instance instead of `console.log`
- **GUD-004**: All async operations MUST respect `AbortSignal` for graceful shutdown
- **GUD-005**: Error handling MUST isolate plugin failures without blocking other channels

---

## 4. Interfaces & Data Contracts

### ChannelPlugin Interface

```typescript
interface ChannelPlugin {
  id: ChannelId           // MUST be "dingtalk"
  meta: ChannelMeta      // { id: "dingtalk", label: "DingTalk", description: "..." }
  config: ChannelConfigAdapter  // REQUIRED - list accounts, resolve credentials
  gateway?: ChannelGatewayAdapter      // Start/stop WebSocket or long-polling
  messaging?: ChannelMessagingAdapter   // normalizeInbound, formatOutbound
  outbound?: ChannelOutboundAdapter    // sendText, sendCard, sendImage, sendFile, sendAudio, sendVideo
  streaming?: ChannelStreamingAdapter   // createStreamingSession
  threading?: ChannelThreadingAdapter   // resolveThread, mapSession, getSession
}
```

### NormalizedMessage Structure

The plugin MUST normalize DingTalk webhook events to this standard format:

```typescript
interface NormalizedMessage {
  messageId: string       // Unique message ID from DingTalk
  senderId: string        // Sender's DingTalk user ID (unionId or staffId)
  senderName?: string     // Display name of sender
  text: string            // Message text content
  chatId: string          // Conversation ID (chatbot or user ID)
  threadId?: string       // Thread ID if available (group conversations)
  timestamp: number       // Unix timestamp (milliseconds)
  replyToId?: string      // ID of message being replied to
  messageType?: "text" | "image" | "voice" | "file" | "video"
}
```

### OutboundTarget Structure

```typescript
interface OutboundTarget {
  address: string         // User ID or conversation ID
  channelId?: string     // Channel ID (typically same as address for DingTalk)
  threadId?: string      // Thread ID for threaded conversations
}
```

### StreamTarget Structure

```typescript
interface StreamTarget {
  address: string         // User ID or conversation ID
  context?: Record<string, unknown>  // Additional context (messageId, streamMode)
}
```

### StreamingSession Structure

```typescript
interface StreamingSession {
  sessionId: string       // Unique streaming session ID
  target: StreamTarget   // Target destination
  pendingUpdates: string[] // Accumulated text updates
  createdAt: number      // Session creation timestamp
  lastMessageId?: string | number  // Last sent message ID for editing
  lastRenderedText?: string       // Last rendered content
  flush: () => Promise<void>      // Flush pending updates
  close?: (finalText?: string) => Promise<void>  // Close session with final text
}
```

### DingTalk API Types

```typescript
interface DingTalkAccessToken {
  access_token: string
  expires_in: number  // Seconds until expiry (typically 7200)
}

interface DingTalkMessage {
  msgtype: "text" | "markdown" | "interactive" | "image" | "file" | "audio" | "video"
  text?: { content: string }
  markdown?: { title: string; text: string }
  interactive?: { card: DingTalkCard }
  image?: { mediaId: string }
  file?: { mediaId: string }
  audio?: { mediaId: string }
  video?: { mediaId: string; title: string; duration: number }
}

interface DingTalkCard {
  config?: { wide_screen_mode?: boolean }
  header?: { title: { tag: "plain_text"; content: string }; template?: string }
  body?: { elements: DingTalkCardElement[] }
}

interface DingTalkCardElement {
  tag: "markdown" | "text" | "hr" | "actions" | "button"
  content?: string
  text?: { tag: "plain_text"; content: string }
  actions?: DingTalkCardAction[]
}

interface DingTalkCardAction {
  tag: "button"
  text: { tag: "plain_text"; content: string }
  type: "primary" | "default" | "danger"
  value: Record<string, unknown>
}
```

---

## 5. Acceptance Criteria

- **AC-001**: Given a running opencode-im-bridge with DingTalk plugin, When a user sends a text message to the DingTalk bot, Then the message is normalized and routed to the correct opencode session
- **AC-002**: Given an active opencode session, When the agent produces streaming text output, Then the DingTalk plugin sends progressive card updates via `StreamingBridge`
- **AC-003**: Given an opencode session with file attachment output, When the session completes, Then the plugin uploads and sends the file to DingTalk via `sendImage`, `sendFile`, `sendAudio`, or `sendVideo`
- **AC-004**: Given a question event from opencode, When `StreamingBridge` processes it, Then the plugin sends an interactive question card with options to the DingTalk user
- **AC-005**: Given a permission request event from opencode, When `StreamingBridge` processes it, Then the plugin sends a permission approval card with Allow/Reject buttons
- **AC-006**: Given the plugin receives a button callback from DingTalk, When the callback matches an interactive card action, Then the response is routed back to opencode correctly
- **AC-007**: Given the plugin starts with valid credentials, When `ChannelManager.startAll()` is called, Then a connection to DingTalk Open Platform is established (WebSocket or long-polling)
- **AC-008**: Given the plugin loses connection, When the connection can be recovered, Then the plugin automatically reconnects with exponential backoff
- **AC-009**: Given a graceful shutdown signal, When SIGTERM is received, Then the plugin closes connections cleanly without errors
- **AC-010**: Given configuration with `DINGTALK_APP_KEY` and `DINGTALK_APP_SECRET`, When the plugin starts, Then it retrieves and caches a valid access token
- **AC-011**: Given an expired access token, When the plugin needs to make an API call, Then it automatically refreshes the token and retries the request
- **AC-012**: Given the plugin receives a message in a group conversation, When `resolveThread` is called, Then the thread key correctly identifies the group and thread

---

## 6. Test Automation Strategy

### Test Levels

| Level | Description | Location |
|-------|-------------|----------|
| Unit | Adapter methods, message normalization, token refresh | `src/channel/dingtalk/*.test.ts` |
| Integration | API calls with mocked responses, StreamingBridge integration | `src/channel/dingtalk/*.integration.test.ts` |
| End-to-End | Full message flow with test DingTalk account | Manual or CI with test bot |

### Frameworks

- **Testing Framework**: Node.js built-in test runner (`node:test`) or Vitest
- **Assertions**: FluentAssertions patterns from existing tests
- **Mocking**: Lightweight HTTP mocking for DingTalk API responses

### Test Data Management

- Use environment variable `DINGTALK_TEST_APP_KEY` / `DINGTALK_TEST_APP_SECRET` for test credentials
- Mock responses stored in `src/channel/dingtalk/__fixtures__/`
- Test session files stored in `data/test/dingtalk-session.json`

### CI/CD Integration

- Unit tests run on every PR and push to `main`
- Integration tests run on merge to `main` with mocked API
- E2E tests require `DINGTALK_E2E_TEST_BOT_TOKEN` secret in CI

### Coverage Requirements

- Minimum 80% line coverage for `dingtalk-plugin.ts`
- All public adapter methods MUST have at least one test case
- Error handling paths MUST be covered

---

## 7. Rationale & Context

### Why DingTalk?

DingTalk is a leading enterprise communication platform in China with over 600 million users. Adding DingTalk support extends opencode-im-bridge accessibility to enterprise teams using DingTalk as their primary collaboration tool.

### Design Decisions

1. **WebSocket over Long Polling**: DingTalk supports both WebSocket (recommended) and HTTP long-polling. WebSocket provides lower latency and better resource utilization. Long-polling is used as fallback if WebSocket SDK is unavailable.

2. **Card-based Streaming**: Similar to Feishu, DingTalk supports interactive cards that can be updated in-place. This provides a better user experience than sending multiple sequential messages.

3. **Separate Media Upload**: DingTalk requires media files to be uploaded separately before being referenced in messages. This follows the pattern used by other platforms (Feishu, QQ, WeChat).

4. **Access Token Caching**: DingTalk access tokens expire after 2 hours. Caching and proactively refreshing the token prevents API failures mid-session.

5. **Extend BaseChannelPlugin**: Using the base class provides default threading behavior, reducing boilerplate and ensuring consistency with other plugins.

### Relationship to Other Specifications

This specification complements:
- `spec-architecture-streaming-bridge.md` - Details on SSE event handling and card updates
- `spec-architecture-channel-manager.md` - Plugin registration and lifecycle management
- `spec-architecture-message-handler.md` - Inbound message processing pipeline

---

## 8. Dependencies & External Integrations

### External Systems

| System | Purpose | Integration Type |
|--------|---------|------------------|
| DingTalk Open Platform | Bot messaging, webhook events, media upload | REST API + WebSocket |

### Third-Party Services

| Service | Required Capabilities | Notes |
|---------|----------------------|-------|
| DingTalk Open API | Message sending, media upload, bot events | No specific SLA beyond DingTalk's own guarantees |

### Infrastructure Dependencies

| Component | Requirements | Constraints |
|-----------|--------------|-------------|
| HTTP Client | Support for multipart/form-data for media upload | Must handle file streams |
| WebSocket Client | DingTalk WebSocket protocol support | Must support DingTalk's custom framing |

### Data Dependencies

| External Data Source | Format | Access Frequency | Notes |
|---------------------|--------|------------------|-------|
| DingTalk Access Token | JSON | On-demand + proactive refresh | Cached, 2-hour expiry |
| Media Upload URLs | JSON | Per media file upload | Short-lived URLs |

### Technology Platform Dependencies

| Platform | Version | Rationale |
|---------|---------|-----------|
| Node.js | ES2022+ with NodeNext modules | Required for ESM imports with `.js` extension |
| TypeScript | Strict mode | Type safety required for plugin interface compliance |

### Compliance Dependencies

| Requirement | Impact |
|-------------|--------|
| DingTalk Platform Policies | Bot must comply with DingTalk messaging policies and rate limits |
| User Privacy | Only process messages from users who have initiated contact with the bot |

---

## 9. Examples & Edge Cases

### Example: Normalizing Inbound Text Message

```typescript
// DingTalk webhook payload for text message
const dingtalkPayload = {
  msgId: "msg123456",
  senderNick: "张三",
  senderStaffId: "user001",
  conversationId: "chat001",
  conversationType: "2", // 1: p2p, 2: group
  messageType: "text",
  content: '{"text":"Hello"}',
}

// NormalizedMessage output
const normalized: NormalizedMessage = {
  messageId: "msg123456",
  senderId: "user001",
  senderName: "张三",
  text: "Hello",
  chatId: "chat001",
  threadId: undefined, // No thread in p2p
  timestamp: Date.now(),
  messageType: "text",
}
```

### Example: Interactive Card for Question

```typescript
// Card following DingTalk schema
const questionCard = {
  card: {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "❓ 需要澄清" },
      template: "orange",
    },
    body: {
      elements: [
        { tag: "markdown", content: "您想要我做什么？" },
        {
          tag: "action",
          actions: [
            { tag: "button", text: { tag: "plain_text", content: "选项 A" }, type: "primary", value: { action: "qa", requestId: "req123", answers: [["选项 A"]] } },
            { tag: "button", text: { tag: "plain_text", content: "选项 B" }, type: "default", value: { action: "qa", requestId: "req123", answers: [["选项 B"]] } },
          ],
        },
      ],
    },
  },
}
```

### Edge Cases

| Case | Handling |
|------|----------|
| Access token expired mid-request | Catch 401 response, refresh token, retry original request once |
| Media upload fails | Retry up to 3 times with exponential backoff, then log error and continue |
| Message too large (> 2048 chars for text) | Split into multiple messages under the limit |
| Group message without @mention | Process if bot is mentioned, otherwise ignore |
| Rapid successive messages from same user | Queue messages to prevent rate limit violations |
| WebSocket connection dropped | Reconnect with exponential backoff (max 5 attempts) |
| Invalid card JSON schema | Fall back to plain text message |

---

## 10. Validation Criteria

### Implementation Checklist

- [ ] `src/channel/dingtalk/` directory created with `index.ts`, `dingtalk-plugin.ts`
- [ ] `DingTalkPlugin` class extends `BaseChannelPlugin`
- [ ] `id` property returns `"dingtalk" as ChannelId`
- [ ] `meta` object correctly describes the channel
- [ ] `config` adapter returns `["default"]` and resolves to `AppConfig`
- [ ] `gateway.startAccount()` establishes connection to DingTalk API
- [ ] `gateway` respects `AbortSignal` for graceful shutdown
- [ ] `messaging.normalizeInbound()` converts DingTalk payloads to `NormalizedMessage`
- [ ] `outbound.sendText()` sends text to DingTalk API
- [ ] `outbound.sendCard()` sends interactive card
- [ ] `outbound.sendImage/File/Audio/Video()` upload and send media
- [ ] `streaming.createStreamingSession()` returns valid `StreamingSession`
- [ ] `streaming` flush mechanism updates card in-place if supported
- [ ] `threading` methods correctly map threads to sessions
- [ ] Plugin registered in `src/index.ts` Phase 6
- [ ] Access token cached and refreshed before expiry
- [ ] Error handling isolates plugin failures
- [ ] Unit tests cover all adapter methods

### Integration Validation

- [ ] Plugin starts without errors when `DINGTALK_APP_KEY` and `DINGTALK_APP_SECRET` are set
- [ ] Plugin logs appropriate messages during startup
- [ ] Plugin reconnects automatically after connection loss
- [ ] Plugin shuts down cleanly on SIGTERM
- [ ] Messages flow correctly from DingTalk to opencode
- [ ] Streaming responses appear as progressive card updates
- [ ] Interactive card buttons route responses back to opencode
- [ ] Media files upload correctly to DingTalk

---

## 11. Related Specifications / Further Reading

### Internal Specifications

- `spec-architecture-streaming-bridge.md` - SSE event processing and streaming card updates
- `spec-architecture-channel-manager.md` - Plugin registry and lifecycle management
- `spec-architecture-message-handler.md` - Inbound message processing pipeline
- `spec-architecture-event-processor.md` - SSE event type parsing

### External Documentation

- [DingTalk Open Platform Documentation](https://open.dingtalk.com/) - Official API reference
- [DingTalk Bot Development Guide](https://open.dingtalk.com/document/org/bot-overview) - Bot setup and capabilities
- [DingTalk Message Types](https://open.dingtalk.com/document/org/message-types) - Supported message formats
- [DingTalk Interactive Card Schema](https://open.dingtalk.com/document/org/overview-of-interactive-cards) - Card message format specification

### Implementation References

- `src/channel/feishu/feishu-plugin.ts` - Full-featured plugin with streaming cards (reference implementation)
- `src/channel/wechat/wechat-plugin.ts` - Alternative polling-based plugin
- `src/channel/telegram/telegram-plugin.ts` - Plugin with Markdown v2 formatting
- `src/channel/types.ts` - ChannelPlugin interface definition
