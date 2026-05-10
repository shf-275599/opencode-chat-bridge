# Architecture Guide

This document provides a technical overview of `opencode-im-bridge`, covering its module layout, key abstractions, data flow, and startup process.

## Project Purpose

`opencode-im-bridge` acts as a bridge between IM platforms (Feishu, QQ, Telegram, Discord, WeChat) and `opencode` TUI sessions. 
Messages from IM flow into `opencode` as if typed in a terminal, and Agent responses are streamed back to the IM chat in real-time.

```
Feishu/QQ/Telegram/Discord Client
    ↕  WebSocket (long-lived)
IM Platform
    ↕  WebSocket / HTTP Bot API
opencode-im-bridge (this project)
    ↕  HTTP API + SSE
opencode server (localhost:4096)
    ↕  stdin/stdout
opencode TUI

WeChat Client
    ↕  HTTP Long Polling
WeChat iLink API (ilinkai.weixin.qq.com)
    ↕  HTTP
opencode-im-bridge (this project)
```

---

## Module Map

```
src/
├── index.ts         # Entry point, 9-phase startup + graceful shutdown
├── types.ts         # Shared type definitions
├── channel/         # ChannelPlugin interface, ChannelManager
│   ├── feishu/     # Feishu REST client, CardKit, WebSocket
│   ├── wechat/     # WeChat iLink Bot API, QR login
│   ├── qq/         # QQ Official Bot SDK
│   └── dingtalk/   # DingTalk Bot API
├── handler/         # MessageHandler (inbound pipeline) + StreamingBridge (SSE → cards)
├── session/         # TUI session discovery, thread→session mapping, progress cards
├── streaming/       # EventProcessor (SSE parsing), SessionObserver
├── cron/            # CronService (scheduled jobs) + HeartbeatService
└── utils/           # Config loader, logger, SQLite init, EventListenerMap
```

---

## Key Abstractions

### ChannelPlugin (`src/channel/types.ts`)

The core extension contract. Any chat platform can be integrated by implementing this interface for `ChannelManager`.

```typescript
interface ChannelPlugin {
  id: ChannelId           // e.g. "feishu"
  meta: ChannelMeta       // label + description
  config: ChannelConfigAdapter      // list accounts, resolve credentials
  gateway?: ChannelGatewayAdapter   // start/stop connections
  messaging?: ChannelMessagingAdapter  // normalize inbound, format outbound
  outbound?: ChannelOutboundAdapter    // sendText, sendCard
  streaming?: ChannelStreamingAdapter  // createStreamingSession, coalesceUpdates
  threading?: ChannelThreadingAdapter  // resolveThread, mapSession, getSession
}
```

### EventProcessor (`src/streaming/event-processor.ts`)

Consumes the raw SSE stream from `opencode` and emits structured events like `TextDelta`, `SessionIdle`, `ToolStart`, and `ToolEnd`.

### SessionManager (`src/session/session-manager.ts`)

Discovers live `opencode` TUI sessions for a working directory. It binds an IM thread key to a specific Session ID and persists the mapping in SQLite.

### StreamingBridge (`src/handler/streaming-integration.ts`)

Buffers `TextDelta` events and queues them into card updates. When `SessionIdle` fires, it flushes the final text and closes the streaming card.

---

## Platform Comparison

| Platform | Protocol | Auth | Features |
|----------|----------|------|----------|
| Feishu | WebSocket | App ID + Secret | Rich media cards, streaming updates |
| QQ | WebSocket | App ID + Secret | Markdown support |
| Telegram | HTTP Bot API | Bot Token | Polling for messages |
| Discord | HTTP Bot API | Bot Token | Webhook receive |
| WeChat | HTTP Long Polling | QR Code Login | iLink Bot API |

---

## Data Flow

### Inbound (IM → opencode)

1. **Receive**: Platform plugins receive raw events via their protocols (WebSocket / HTTP polling / Bot API)
2. **Normalize**: `ChannelMessagingAdapter` converts them to standard internal messages
3. **Handle**: `MessageHandler` performs deduplication
4. **Route**: `SessionManager` resolves or discovers the target session
5. **Dispatch**: Sends the message via HTTP POST to `opencode` `/session/{id}/message`
6. **Feedback**: `ProgressTracker` updates the IM with a "thinking..." status

### Outbound (opencode → IM)

1. **Subscribe**: Listen to the `opencode` SSE event stream
2. **Parse**: `EventProcessor` parses raw strings into typed events
3. **Distribute**: `SessionObserver` fans out events to registered listeners
4. **Transform**: `StreamingBridge` accumulates text and updates IM cards dynamically

---

## Startup Phases

`index.ts` follows a strict 9-phase startup sequence:

1. **Load Config**: Load settings from `opencode-lark.jsonc` or env vars
2. **Connect Server**: Connect to `opencode server` with exponential backoff
3. **Init DB**: Initialize SQLite for session mapping and cron jobs
4. **Create Services**: Initialize `SessionManager`, `EventProcessor`, `StreamingBridge`, etc.
5. **Subscribe SSE**: Start global SSE stream subscription
6. **Register Plugins**: Instantiate and register IM plugins (e.g., `FeishuPlugin`, `WechatPlugin`)
7. **Start Channels**: Activate connections for all channels (WebSocket / HTTP polling / Bot API)
8. **Start Cron**: Launch `CronService` and `HeartbeatService`
9. **Graceful Shutdown**: Register SIGTERM/SIGINT handlers for clean resource release
