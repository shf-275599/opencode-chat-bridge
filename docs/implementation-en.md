# Core Implementation Details

This document dives deep into the key code modules and logic within `opencode-lark`.

## 1. Message Handling (MessageHandler)
Located in `src/handler/message-handler.ts`, this is the command center for inbound messages.

- **Deduplication**: Uses `FeishuPlugin.gateway.deduplicate` to ensure each message is processed exactly once.
- **Session Binding Logic**:
  - Existing users with bound sessions remain on their current session.
  - New users are automatically mapped to the most active session in the current `CWD`.
  - If no session is found, a help message is returned, suggesting the `/new` command.

## 2. SSE to Card Conversion (StreamingBridge)
Located in `src/handler/streaming-integration.ts`, this manages the real-time agent responses.

- **TextDelta Accumulation**: Buffer partial text chunks from the SSE stream.
- **Debounced Updates**: Feishu has strict rate limits for card updates. `StreamingBridge` debounces updates (typically every 500ms-1s) to balance real-time feel with platform stability.
- **State Flow**: 
  - `ToolStart` -> Displays a progress card (e.g., "Running tool...").
  - `SessionIdle` -> Sends the finalized text reply and cleans up temporary UI elements.

## 3. Channel Abstraction Layer (ChannelManager)
`src/channel/manager.ts` enables a plugin-based architecture.

- **Decoupling**: The core logic is platform-agnostic.
- **Plugin Registration**: Plugins (Feishu, QQ, etc.) are registered at startup. Each plugin is responsible for normalizing platform-specific events into `ChannelInboundMessage` objects.

## 4. Progress Feedback (ProgressTracker)
`src/session/progress-tracker.ts` handles visual feedback for long-running tasks.

When the agent executes complex scripts or web searches, `ProgressTracker` provides dynamic UI updates (e.g., "Executing terminal command...") to keep the user informed.
