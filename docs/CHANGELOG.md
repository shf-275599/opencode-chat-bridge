# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## 0.36.2 (2026-03-20)

### Improvements

- **AppConfig**: Native support for `RELIABILITY_CRON_*` and `RELIABILITY_HEARTBEAT_*` environment variables for fast, full-environment deployment.
- **QQ WebSocket Resilience**: Added a runtime hotfix to force fresh `IDENTIFY` after `INVALID_SESSION` to avoid infinite reconnect loops.
- **QQ WebSocket Stability**: Set explicit WebSocket receiver defaults (`maxRetries`, `reconnectDelay`, `heartbeatInterval`) to prevent NaN backoff warnings.
- **Agent Commands**: Added `/agent` command support to list and switch agents, plus message-level agent forwarding.

### Bug Fixes

- **Tests**: Fixed `/agent` command assertion case mismatch in `command-handler.test.ts` to keep CI/CD green.
- **Agent Routing**: Persisted per-chat agent selection in session mapping and included `agent` in session message posts.

### Dependencies

- **cron**: Added `cron` and `@types/cron` dependencies and unified the Windows test runner entry path.

## 0.36.1 (2026-03-19)

### Features

- **Telegram Slash Commands**: Auto-register Bot API commands (`/new`, `/sessions`, `/abort`, `/compact`, `/share`, `/help`) on startup to provide an interactive menu in Telegram chats.

### Bug Fixes

- **SSE Reconnection**: Fixed TDZ crash on startup and added an exponential backoff auto-reconnect loop (1s to 30s) to prevent persistent 5-minute timeout errors when the event stream is disconnected.
- **Telegram Polling**: Improved long polling loop stability with reinforced abort boundary checks to prevent race conditions during graceful shutdown, and switched static retries to exponential backoff.
- **Test Integrity**: Updated legacy test assertions for Feishu V1 `elements` fields to match the correct `body.elements` structure defined by the V2 schema migration.


## 0.36.0 (2026-03-17)

### Features

- **Feishu V2 Card Standardization**: Fully updated all interactive cards to the Feishu V2 schema, resolving rendering issues and removing deprecated `tag: action`.
- **Streaming Card Output**: Enhanced real-time message streaming with improved buffering and smoother updates.
- **Tool Calling Progress**: Added visual progress indicators (Running/Completed/Error) for tool invocations within streaming cards.
- **Project Quick Switch**: Added a "Switch Project" button and a dedicated project selector card for easy session switching.
- **Enhanced Thinking Status**: Support for Feishu Typing indicators and `THINKING` reaction status for better feedback during processing.
- **Permission Approval**: Interactive cards for tool permissions (bash, file edit, etc.) with Allow/Reject buttons.
- **Code Optimization**: Centralized all card building logic into `src/feishu/card-builder.ts` and removed legacy V1-style code.

## 0.1.25 (2026-03-17)

### Features

- **Multi-channel Architecture**: Refactored core to be channel-agnostic via `ChannelManager`.
- **QQ Bot Support**: Added official QQ Bot API support (`QQPlugin`).
- **Telegram Bot Support**: Added Telegram bot integration via polling.
- **Slash Commands**: Added `/new`, `/sessions`, `/connect`, `/compact`, `/share`, `/abort`, and `/help` commands directly in the IM chats (with text-based fallback for QQ/Telegram).
- **Project Renaming**: Officially renamed package and GitHub repository from `opencode-lark` to `opencode-im-bridge`.
- **Logger Prefix**: Standardized runtime logs to use `[opencode-im]`.

### Bug Fixes

- **CLI Setup Wizard**: Updated prompt to support selecting `all` channels instead of just `both`.
- **CLI Global Binary**: Fixed `package.json` to properly map `opencode-im-bridge` global command.

## 0.1.21 (2026-03-04)

### Improvements

- **No build step**: bin entry now imports TypeScript source directly via Bun, eliminating the need for `tsc` build before publish. No more stale dist issues.

## 0.1.20 (2026-03-04)

### Bug Fixes

- **Build**: Rebuild dist with all debounce fixes (v0.1.19 was published with stale dist)

## 0.1.19 (2026-03-04)

### Features

- **Message debounce/batching**: Smart batching of rapid multi-message inputs (e.g. image + text combos). Text/post messages trigger immediate flush; media messages buffer with a configurable 10s timer fallback. Configure via `messageDebounceMs` in config.
- **Graceful shutdown**: `dispose()` flushes all pending debounce buffers on process exit.

### Bug Fixes

- **Debounce key isolation**: Messages now keyed by `open_id:feishuKey` (includes root_id for thread replies), preventing cross-thread message merging.
- **Reaction cleanup**: "Typing" reaction is now correctly removed from the original reaction message, not the last message in a batch.
- **Init race condition**: Per-key initialization guard ensures the debounce timer cannot fire before thinking/reaction context is set, even under concurrent webhook delivery.
- **Text-during-init safety**: Text messages arriving while a debounce key is initializing are deferred until init completes, preventing premature flushes without context.
- **Error resilience**: `try/finally` guarantees init completion even if `sendThinking()` or `addReaction()` fails.

## [0.1.17] - 2026-03-04

### Fixed

- Outbound media: in the event-driven flow, `sendDetectedFiles()` is now called only when no `StreamingBridge` is active, preventing duplicate uploads/sends

## [0.1.16] - 2026-03-04

### Fixed

- Outbound media 文件路径正则扩展支持中文标点，修复含中文符号的路径无法被正确识别的问题

## [0.1.15] - 2026-03-04

### Changed

- Lark 上下文签名策略调整：每条飞书消息都携带签名标记，首条消息注入完整上下文说明，后续消息仅附加简短 `[Lark]` 前缀，减少 token 消耗

### Lark MCP Integration — 2026-03-04 (18/18 tools passed)

End-to-end validation of `lark-openapi-mcp` tool chain — all tools callable directly from opencode agent:

| Category | Tools | Status |
|----------|-------|--------|
| docx | import, markdownWrite, markdownRead, rawContent, search | ✅ 5/5 |
| drive | upload, download | ✅ 2/2 |
| bitable | create app, create table, list tables, list fields, create/search/update record | ✅ 6/6 |
| im | chat list, chat members | ✅ 2/2 |
| wiki | search, getNode | ✅ 2/2 |

## [0.1.14] - 2026-03-04

### Added

- Outbound media: agent responses containing file paths are detected, validated against an allowlist, and uploaded to Feishu as images/files
- Lark context signature: first message per session includes a `[Lark]` prefix with save-file instructions so the AI knows files go to a specific directory
- Bot identity resolution: `getBotInfo()` fetches bot's open_id at startup for accurate @mention filtering in group chats
- `/sessions` command: current active session pinned at top, sessions listed as interactive card buttons for quick connection
- `/sessions` command: sessions displayed as interactive cards (no relative timestamps)
- `sessionManager.getExisting()` method for retrieving current session without creating new one
- `getAttachmentsDir()` shared utility for consistent attachment directory paths (`src/utils/paths.ts`)
- AGENTS.md files in key src/ subdirectories for contributor orientation

### Fixed

- `getBotInfo()` response parsing: Feishu `/bot/v3/info` returns `bot` at top level (not under `data`), causing empty `botOpenId` and broken group @mention filtering
- TOCTOU race condition in outbound media: all filesystem operations now use resolved `realPath` consistently
- String prefix prefilter added to `sendDetectedFiles()` in `outbound-media.ts` — skips unnecessary filesystem calls for paths outside allowlist
- Lark signature Set bounded to 1001 entries (`> 1000` triggers clear) to prevent unbounded memory growth
- 3 failing tests fixed (mock `getExisting`, group @mention test, quoted message assertion)

### Changed

- `MAX_FILE_SIZE_BYTES` split into `MAX_DOWNLOAD_BYTES` (50MB) and `MAX_UPLOAD_BYTES` (20MB) for clarity
- Deleted orphaned `src/memory/` directory (functionality previously removed)
- 8 unused variables prefixed with `_`, removed unused `Statement` import and 3 unused class fields
- `expandTilde`, `extractFilePaths`, `isImageFile` un-exported (internal-only in outbound-media.ts)
- Removed duplicate `dedup:` key in smoke test
- 6 `console.log` calls replaced with no-op in test files
- Centralized 3 hardcoded attachment directory paths to use shared `getAttachmentsDir()`

### Security

- Outbound media allowlist enforces TOCTOU-safe path resolution
- String prefix prefilter in `sendDetectedFiles()` prevents unnecessary filesystem access for non-allowlist paths
- Signature injection bounded (Set clears after exceeding 1000 entries) to prevent memory exhaustion

### Docs

- Root AGENTS.md updated: removed deleted `memory/` module references from Data Flow and Startup Phases
- Sub-directory AGENTS.md files added for handler/, feishu/, streaming/, session/, channel/, utils/

## [0.1.3] - 2026-02-26

### Fixed

- Shebang changed from `#!/usr/bin/env node` to `#!/usr/bin/env bun` — project requires Bun runtime (`bun:sqlite`)

## [0.1.2] - 2026-02-26

### Added

- Interactive CLI setup wizard: first-run experience guides new users through credential entry, server validation, `.env` creation, and auto-start
- `opencode-lark init` command to re-run the setup wizard at any time
- Minimal `.env` file parser (`loadEnvFile`) — loads environment variables before config phase

### Changed

- Startup Phase 0 added: env file loading + setup wizard check before normal boot sequence
- `needsSetup()` only triggers when no config file exists, credentials are missing, AND stdin is a TTY

### Docs

- READMEs updated: setup wizard shown as primary Quick Start path
- Added `opencode-lark init` tip for re-running wizard

## [0.1.1] - 2026-02-26

### Added

- Interactive question cards: when the AI agent asks a question, Feishu users see a card with clickable answer buttons
- Interactive permission cards: file edit, bash, and webfetch approvals rendered as Feishu cards with Allow/Reject buttons
- Card action callbacks via WebSocket long connection (`card.action.trigger`)
- Toast feedback + card replacement on button click (buttons disabled after answering)
- Interactive poller fallback: polls `/question` and `/permission` endpoints every 3s in case SSE events are missed
- Chinese README (`README.zh-CN.md`)

### Fixed

- Card action callback timeout (error 200340): handler now returns immediately within Feishu's 3s requirement
- Interactive cards sent as direct JSON instead of CardKit v2 wrapper (fixes `content type illegal` error)
- Permission event type corrected from `permission.updated` to `permission.asked`
- POST timeout no longer kills SSE listener when session is blocked on a question

### Changed

- Removed dead code: `editMessage`, `appendText`, `SessionBusy`, `ReasoningDelta`

### Docs

- Added callback subscription setup guide (Step 8) — required for interactive cards
- Added `cardkit:card:write` permission to required permissions table
- Added error 200340 to troubleshooting table

## [0.1.0] - 2026-02-25

### Initial Open-Source Release

- Feishu/Lark ↔ opencode bidirectional messaging via WebSocket long connection
- Real-time streaming cards with tool progress indicators (CardKit v2)
- Sub-agent task tracking with expandable progress cards
- Channel abstraction layer (`ChannelPlugin` interface for extensibility)
- Session management with TUI session discovery and automatic binding
- Cron scheduling service with configurable jobs
- Heartbeat monitoring with Feishu status notifications
- SQLite-backed conversation memory with context injection
- Message deduplication to prevent duplicate processing
- Configurable via JSONC config file + environment variables
- TypeScript with strict mode, zero-error build
- 248 unit + integration tests (vitest)
