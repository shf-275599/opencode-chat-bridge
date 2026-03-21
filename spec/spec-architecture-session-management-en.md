---
title: Session Management Architecture Specification
version: 1.0
date_created: 2026-03-21
owner: opencode-im-bridge team
tags: [architecture, design, session, sqlite]
---

# Introduction

This specification defines the architecture, requirements, and constraints for the `SessionManager` and `ProgressTracker` components within `opencode-im-bridge`. These components are responsible for maintaining persistent state between stateless IM chats and stateful `opencode` TUI instances, and providing synchronous UX feedback when streaming is unavailable.

## 1. Purpose & Scope

The purpose of `SessionManager` is to reliably track which chat thread corresponds to which `opencode` session. It utilizes an embedded SQLite database (`bun:sqlite`) to ensure context survives process restarts. The scope covers automatic session discovery, persistence, cleanup of stale sessions, and state model tracking. The `ProgressTracker` provides a synchronous mechanism to display "Thinking" interactive cards on Feishu before the final response is ready.

## 2. Definitions

- **feishu_key**: A normalized unique identifier combining a chat ID and an optional root/thread ID.
- **SessionId**: A UUID representing a running `opencode` TUI backend session.
- **TUI Discovery**: The process of pinging the `opencode` server's `/session?roots=true` endpoint to find pre-existing active sessions in the current working directory.

## 3. Requirements, Constraints & Guidelines

- **REQ-001 (Persistence)**: The mapping between an IM thread and an agent session must survive node crashes or restarts. It must be stored in a relational database format.
- **REQ-002 (Discovery Priority)**: When an unmapped user sends a message, the manager must automatically try to discover and bind to an active session in the current `OPENCODE_CWD` directory before creating a new one.
- **REQ-003 (Stale Cleanup - Startup)**: On boot, the manager must validate all stored mappings sequentially against the `opencode` server. Mappings returning HTTP 404 must be purged.
- **REQ-004 (Conservative Deletion)**: Network errors (e.g., timeout, 502) when validating a session must **not** trigger deletion. Only explicit `404 Not Found` dictates a session is dead.
- **REQ-005 (Model Tracking)**: The manager must track if a user has explicitly set an LLM model preference per thread.
- **REQ-006 (Progress Tracking Fallback)**: For sync fallback operations on Feishu, the `ProgressTracker` must dispatch a "Thinking..." card immediately and update it in place upon completion or error.

## 4. Interfaces & Data Contracts

### 4.1 SQLite Schema (`feishu_sessions`)
```sql
CREATE TABLE feishu_sessions (
  feishu_key  TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  agent       TEXT NOT NULL,
  model       TEXT,
  created_at  INTEGER NOT NULL,
  last_active INTEGER NOT NULL,
  is_bound    INTEGER DEFAULT 0
)
```

### 4.2 API
```typescript
interface SessionManager {
  getOrCreate(feishuKey: string, agent?: string): Promise<string>;
  getExisting(feishuKey: string): Promise<string | undefined>;
  setMapping(feishuKey: string, sessionId: string, agent?: string): boolean;
  validateAndCleanupStale(): Promise<number>;
  cleanup(maxAgeMs?: number): number;
}
```

## 5. Acceptance Criteria

- **AC-001**: Given a restart of the `opencode-im-bridge` service, When a user resumes chatting in an existing thread, Then their previous `session_id` is retrieved from SQLite correctly without losing agent context.
- **AC-002**: Given a pristine initialization, When a user sends their first message and an active TUI window is open running an opencode session natively, Then the bridge binds their chat implicitly to the open native session instead of spawning a background ghost session.
- **AC-003**: Given a startup sequence where the opencode server purged a memory session, When `validateAndCleanupStale()` runs, Then the HTTP 404 response causes the stale `feishu_key` mapping to drop from SQLite.

## 6. Test Automation Strategy

- **Test Levels**: Database integration tests utilizing an in-memory SQLite wrapper (`:memory:`).
- **Test Data Management**: Mock fetch requests simulating `[200, 404, 500, network error]` states to validate the conservative deletion strategy.
- **Performance Testing**: Validate that startup validation `validateAndCleanupStale` does not block bootstrapping significantly when checking 1000+ sessions.

## 7. Rationale & Context

- **Why TUI Discovery?** Opencode is conceptually a terminal UI first and foremost. The most magical UX occurs when a user runs `opencode` in their terminal, then switches to their smartphone to send a message via IM, and watches the terminal auto-drive. Discovery enables this out of the box without manual `/bind` commands.
- **Why SQLite via Bun?** Bun's native sqlite driver is synchronously fast, avoids heavy V8 boundaries, and requires zero remote infrastructure, perfect for a sidecar bridge pattern.

## 8. Dependencies & External Integrations

### External Systems
- **EXT-001**: opencode HTTP API - `GET /session` (for discovery) and `GET /session/{id}` (for validation).

### Infrastructure Dependencies
- **INF-001**: Local Filesystem - Required for `database.sqlite` storage. Ensure the directory possesses read/write permissions for the executor.
- **INF-002**: `bun:sqlite` - The core runtime dependency enforcing execution in the Bun JavaScript environment.

## 9. Examples & Edge Cases

### Edge Case: Startup Network Race
If the opencode server is starting concurrently with the bridge, validation requests might yield `ECONNREFUSED`. The conservative deletion design pattern guarantees no sessions will be wiped until the server successfully replies with a definitive `404`.

## 10. Validation Criteria

- Must use prepared statements (`db.prepare`) to mitigate SQL injection vulnerabilities from forged `feishu_key`s.
- Graceful upgrade migrations (e.g., `ALTER TABLE ... ADD COLUMN`) must safely `catch(){}` to allow idempotency.

## 11. Related Specifications / Further Reading
- [Implementation Details](../docs/implementation.md)
