---
title: 会话管理器架构规范 (Session Management Architecture Specification)
version: 1.0
date_created: 2026-03-21
owner: opencode-im-bridge 团队
tags: [architecture, design, session, sqlite]
---

# 概述

本规范定义了 `opencode-im-bridge` 中 `SessionManager` 和 `ProgressTracker` 组件的架构、要求和约束。这些组件负责在无状态的 IM（即时通讯）聊天和有状态的 `opencode` TUI 实例之间维护持久化状态，并在流式传输不可用时提供同步的 UX 反馈。

## 1. 目的与范围

`SessionManager` 的目的是可靠地跟踪哪个聊天线程对应哪个 `opencode` 会话。它利用嵌入式的 SQLite 数据库 (`bun:sqlite`) 来确保上下文在进程重启后依然存在。该范围包括自动会话发现、持久化存储、清理过期会话以及状态模型跟踪。`ProgressTracker` 则提供了一种同步机制，在最终响应尚未就绪前，在飞书上显示“思考中”等互动式占位卡片提示。

## 2. 术语定义

- **feishu_key**: 一种标准化的唯一标识符，结合了 `chat_id` 和可选的 `root_id/thread_id` 以标识特定聊天上下文。
- **SessionId**: 代表一个正在后台运行的 `opencode` TUI 会话的一个 UUID。
- **TUI Discovery (TUI 端会话发现)**: 通过请求 `opencode` 服务器的 `/session?roots=true` 接口，寻找当前工作目录中活跃本地终端会话的过程。

## 3. 需求、约束与规范

- **REQ-001 (持久化)**: IM 线程与代理（Agent）会话之间的映射关系必须在 Node.js 崩溃或应用重启后保持数据不丢失。
- **REQ-002 (会话发现优先机制)**: 当未映射的用户发送消息时，必须优先探测当前 `OPENCODE_CWD` 目录中的活动会话并尝试建立绑定，最后再考虑创建新会话。
- **REQ-003 (启动时陈旧清理)**: 应用启动时需依次向 `opencode` 服务器验证存储的会话映射。当返回 HTTP 404 结论时，必须从数据库中删除失效的映射。
- **REQ-004 (保守惰性删除)**: 当验证过程中遇到网络错误（如 timeout, 502 等非致命错误）时，禁止删除映射。仅在明确收到 HTTP 404 响应时才视为会话消亡。
- **REQ-005 (模型配置跟踪)**: 会话管理器必须跟踪每个聊天线程中用户显式设置的 LLM 模型偏好。
- **REQ-006 (进度追踪降级)**: 在不支持流式更新但支持卡片的平台中触发同步回拨时，必须立即下发“思考中”状态卡片，并在完成后原地更新。

## 4. 接口与数据契约

### 4.1 SQLite Schema 表结构 (`feishu_sessions`)
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

### 4.2 Application Programming Interface
```typescript
interface SessionManager {
  getOrCreate(feishuKey: string, agent?: string): Promise<string>;
  getExisting(feishuKey: string): Promise<string | undefined>;
  setMapping(feishuKey: string, sessionId: string, agent?: string): boolean;
  validateAndCleanupStale(): Promise<number>;
  cleanup(maxAgeMs?: number): number;
}
```

## 5. 验收标准

- **AC-001**: 给定桥接服务重启的场景，当用户在现有线程中继续聊天时，系统必须能从 SQLite 正确恢复 previous session_id 及上下文，而不丢失任务。
- **AC-002**: 给定冷启动场景，当用户发出第一条消息且后台正好有活跃的原生 `opencode` TUI 会话时，系统能够自动发现并隐式绑定到该原生会话，而不是建立影子后台会话。
- **AC-003**: 给定服务器刚重启清除了内存会话的场景，执行 `validateAndCleanupStale()` 后抛出的 HTTP 404 响应会导致过期的 `feishu_key` 映射从数据库中被永久移除。

## 6. 测试策略

- **测试层级**: 使用内存数据库 (`:memory:`) 进行集成测试验证 SQLite 的存储逻辑。
- **测试数据管理**: 模拟 API 的 `[200, 404, 500, 网络错误]` 反馈状态，以检验保守删除机制的可靠性。

## 7. 基本原理与背景

- **为何需要 TUI 会话发现 (TUI Discovery)？** 提供无缝体验：开发者可在电脑终端启动 `opencode`，随后在手机 IM 上无缝接手运行进度，无需手动敲击 `/bind` 指令。
- **为什么采用 Bun 内置 SQLite？** 因为它是同步驱动的高速数据库引擎，免除了复杂的原生 V8 边界绑定和额外的基础设施依赖。

## 8. 技术依赖

- **EXT-001**: opencode HTTP API 检索
- **INF-001/-002**: Local Filesystem & `bun:sqlite`。

### 边缘情况：启动时的网络竞争 (Startup Network Race)
当 opencode 服务器与桥接器并发启动时，验证请求可能会产生 `ECONNREFUSED`（拒绝连接）错误。本系统的“保守删除”设计模式确保了在服务器明确返回其作为最终定论的 `404` 响应之前，绝对不会误删任何会话映射。

## 10. 参考

- [Implementation Details](../docs/implementation.md)
