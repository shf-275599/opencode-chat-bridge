# channel/

The plugin system that makes opencode-lark platform-agnostic. Define the contract here; implement it per platform.

## Files

### `types.ts`
Defines the `ChannelPlugin` interface and all its sub-adapter interfaces. This is the only contract file — if you're adding a new chat platform, start here.

Adapter breakdown:

| Adapter | Responsibility |
|---|---|
| `ChannelConfigAdapter` | List accounts, resolve credentials (required) |
| `ChannelGatewayAdapter` | Start/stop platform connections (WebSocket, polling) |
| `ChannelMessagingAdapter` | Normalize inbound events, format outbound text |
| `ChannelOutboundAdapter` | `sendText`, `sendCard` to a thread |
| `ChannelStreamingAdapter` | Create streaming sessions, coalesce rapid updates |
| `ChannelThreadingAdapter` | Map platform thread IDs to session IDs |

All adapters except `config` are optional. A read-only notification bot only needs `config` + `outbound`.

### `manager.ts`
`ChannelManager` holds the registry of active plugins. Key methods:
- `register(plugin)` — adds a plugin. Logs a message and overwrites if the same `plugin.id` is registered twice.
- `startAll()` — iterates registered plugins **sequentially** (awaits each), calls `gateway.startAccount()` for each. Error isolation: one plugin failing does not prevent others from starting.
- `stopAll()` — graceful shutdown, called from SIGTERM handler in `src/index.ts`

### `feishu/feishu-plugin.ts`
The Feishu implementation of `ChannelPlugin`. Wires together:
- `FeishuApiClient` → config + outbound adapters
- `FeishuWsClient` → gateway adapter
- `MessageHandler` + `CommandHandler` → messaging adapter
- `StreamingBridge` → streaming adapter
- `SessionManager` → threading adapter

Don't add Feishu-specific logic here. This file is glue only. Business logic lives in `src/handler/` and `src/feishu/`.

## Adding a new channel

1. Create `src/channel/{platform}/` with a `{platform}-plugin.ts` file.
2. Implement `ChannelPlugin` from `types.ts`.
3. In `src/index.ts` Phase 6, instantiate and register it: `channelManager.register(new YourPlugin(...))`.
4. `startAll()` picks it up automatically.

## Gotchas

- `ChannelId` is a branded string type. Don't use raw strings where `ChannelId` is expected.
- `startAll()` awaits each plugin start sequentially. If startup order matters between plugins, they are naturally ordered by registration order. Error isolation ensures one failing plugin doesn't block others.
