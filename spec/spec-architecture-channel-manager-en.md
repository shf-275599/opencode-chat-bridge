---
title: Channel Manager Architecture Specification
version: 1.0
date_created: 2026-03-21
owner: opencode-im-bridge-slim team
tags: [architecture, design, channel, plugin]
---

# Introduction

This specification defines the architecture, requirements, and constraints for the `ChannelManager` and its associated `ChannelPlugin` ecosystem within `opencode-im-bridge-slim`. The Channel Manager provides a unified abstraction layer over fundamentally different chat platforms (like Feishu, feishu, Telegram, Discord), allowing the core application logic to remain agnostic to underlying network protocols and payload schemas.

## 1. Purpose & Scope

The purpose of the `ChannelManager` is to administer the lifecycle (registration, startup, stoppage) of various `ChannelPlugin` instances. It isolates configuration parsing, inbound message normalization, and outbound message formatting. The scope covers the `ChannelManager` class itself and the `ChannelPlugin` adapter contracts interfaces.

## 2. Definitions

- **Channel**: A distinct Instant Messaging platform (e.g., `feishu`, `feishu`, `wechat`).
- **ChannelPlugin**: A modular implementation of the channel interfaces required to integrate a specific IM platform into the bridge.
- **Adapter**: Sub-interfaces of a `ChannelPlugin` responsible for focused domains (e.g., `ChannelGatewayAdapter` for connections, `ChannelOutboundAdapter` for sending messages).

## 3. Requirements, Constraints & Guidelines

- **REQ-001 (Plugin Modularity)**: The core system must never depend directly on a concrete platform implementation (e.g., hardcoding Telegram API calls in the Message Handler). All platform interaction must route through the `ChannelPlugin` interface.
- **REQ-002 (Error Isolation on Startup)**: When calling `startAll()` or `stopAll()`, the failure of one channel's gateway to start must be caught and logged, but must **not** prevent the other channels from starting.
- **REQ-003 (Optional Capabilities)**: Plugins must not be forced to implement every capability. While `config` is required, adapters for `gateway`, `messaging`, `outbound`, `streaming`, and `threading` are strictly optional.
- **REQ-004 (Graceful Degradation)**: If a core system feature (like streaming cards) attempts to use an adapter (like `outbound.sendCard`) that the plugin does not provide, the core system must degrade gracefully (e.g., fallback to basic text) rather than crash.
- **REQ-005 (Normalized Models)**: Inbound data must be converted into standard `NormalizedMessage` objects where applicable, obscuring platform-specific quirks.

## 4. Interfaces & Data Contracts

### 4.1 ChannelPlugin Contract
```typescript
interface ChannelPlugin {
  id: ChannelId;
  meta: ChannelMeta;
  config: ChannelConfigAdapter;         // REQUIRED: Resolving credentials
  gateway?: ChannelGatewayAdapter;      // OPTIONAL: Long-polling, WebSocket starts
  messaging?: ChannelMessagingAdapter;  // OPTIONAL: Normalizing message structures
  outbound?: ChannelOutboundAdapter;    // OPTIONAL: Sending standard text, cards, images
  streaming?: ChannelStreamingAdapter;  // OPTIONAL: Streaming session creation
  threading?: ChannelThreadingAdapter;  // OPTIONAL: Thread mapping overriding
}
```

### 4.2 ChannelManager API
```typescript
class ChannelManager {
  register(plugin: ChannelPlugin): void;
  startAll(signal: AbortSignal): Promise<void>;
  stopAll(): Promise<void>;
  getChannel(id: ChannelId): ChannelPlugin | undefined;
  listChannels(): ChannelPlugin[];
}
```

## 5. Acceptance Criteria

- **AC-001**: Given a registered Telegram plugin with an invalid bot token, When `startAll()` is invoked, Then the Telegram gateway throws an error, the error is logged, and the Feishu gateway starts normally without being blocked.
- **AC-002**: Given an incoming message from WeChat, When it reaches the pipeline, Then the `wechat` ChannelPlugin parses its payload and the core message handler treats it agnostically.
- **AC-003**: Given a core routing intent to send an image, When `plugin.outbound.sendImage` is called, Then the target channel's adapter processes the absolute file path and sends binary data to the IM endpoint safely.

## 6. Test Automation Strategy

- **Test Levels**: Unit tests validating isolation loops in `ChannelManager.startAll()`. Interface validation checks using dummy plugins.
- **Frameworks**: Vitest / TS Type checks.
- **CI/CD Integration**: Strict TypeScript compilation tests to assure the Adapter interfaces conform to the definitions.

## 7. Rationale & Context

- **Why Optional Adapters?** Not all platforms function the same way. feishu lacks interactive streaming cards. Webhook-based implementations (like Feishu) heavily rely on HTTP servers externally configured, thus might not use a `gateway` adapter, whereas Discord uses a long-lived WebSockets gateway connection. Optionality enables progressive enhancement.
- **Why Fault Isolation?** `opencode-im-bridge-slim` is designed to be a unified router. If feishu's external server is down and throws a 502 during startup, Feishu users in their enterprise should still be able to query the agent without interruption.

## 8. Dependencies & External Integrations

### Architectural Dependencies
- **DEP-001**: AbortController - `startAll` accepts an `AbortSignal` for strict shutdown hooks across all concurrent channel connections.

## 9. Examples & Edge Cases

### Edge Case: Missing Adapter Invocation
```typescript
// Core system must always check adapter existence before invocation
const plugin = channelManager.getChannel("wechat");
if (plugin?.outbound?.sendCard) {
  await plugin.outbound.sendCard(target, cardData);
} else {
  // Graceful degradation
  await plugin?.outbound?.sendText(target, fallbackText);
}
```

## 10. Validation Criteria

- All channel identifier IDs across the codebase must map to exactly one successfully instantiated plugin class injected at Phase 6 of standard startup.
- Adapters must never mutate the singleton `ChannelManager` state internally.

## 11. Related Specifications / Further Reading
- [Implementation Details](../docs/implementation.md)
