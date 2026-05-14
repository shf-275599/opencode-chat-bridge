---
title: 事件处理器架构规范 (Event Processor Architecture Specification)
version: 1.0
date_created: 2026-03-21
owner: opencode-im-bridge-slim 团队
tags: [architecture, design, events, sse]
---

# 概述

本规范定义了 `opencode-im-bridge-slim` 中 `EventProcessor` 和 `SessionObserver` 组件的架构、要求和约束。这些组件负责接收、过滤和解析由 `opencode` 服务器发出的原始 Server-Sent Events (SSE) 流，并将其转换为强类型的、可执行的事件，供桥接器的路由层使用。

## 1. 目的与范围

`EventProcessor` 的目的是作为一个严格的防腐层 (Anti-corruption layer)，将 opencode 内部无类型的 JSON 数据与桥接器使用的强类型事件总线隔离开来。其范围涵盖解析 `message.part.updated` 和 `message.part.delta` 事件，并过滤掉非面向用户的内容。`SessionObserver` 则充当后台审计员的角色，如果用户从原生的终端 (TUI) 发起操作而不是通过即时通讯 (IM) 客户端发起，它会将消息路由回 IM 客户端。

## 2. 术语定义

- **Raw SSE**: 从 `opencode` 后端流式传输的原始 JSON 数据行（例如 `message.part.updated`）。
- **ProcessedAction**: 由处理器发出的强类型联合 (Discriminated Union)（例如 `TextDelta`, `ToolStateChange`）。
- **Reasoning Part**: 推理模型（如 o1）显式发出的内部思考过程文本块。必须从聊天输出中屏蔽这些内容，以防止刷屏。

## 3. 需求、约束与规范

- **REQ-001 (类型安全)**: 处理器必须将原始的未知 JSON 对象明确解析为标签联合类型（`TextDelta`, `ToolStateChange`, `SubtaskDiscovered`, `SessionIdle`, `QuestionAsked`, `PermissionRequested`），或者将其丢弃。
- **REQ-002 (会话安全作用域)**: 处理器必须立即丢弃任何属于未在 `ownedSessions` 集合中跟踪的 `sessionId` 事件，以防止多租户之间发生数据串扰 (Crosstalk)。
- **REQ-003 (推理抑制)**: 任何 `type: "reasoning"` 的 `message.part` 必须被识别并按 ID 进行追踪，随后指向该 ID 的所有 `message.part.delta` 数据块更新必须被屏蔽。
- **REQ-004 (TUI 观察)**: `SessionObserver` 必须缓冲任何完全独立于已知 IM `message_id` 的 `TextDelta` 事件（即由某人在本地原生终端输入而触发的事件）。
- **REQ-005 (防止双重数据流)**: 如果 `StreamingBridge` 当前正在处理某个会话，则 `SessionObserver` 必须将该会话标记为“忙碌” (`busy`)，并停止其自身的缓冲输出，以防止在 IM 聊天中出现重复回复。

## 4. 接口与数据契约

### 4.1 输出的已处理操作 (Processed Actions)
```typescript
type ProcessedAction =
  | { type: "TextDelta"; sessionId: string; text: string }
  | { type: "ToolStateChange"; sessionId: string; toolName: string; state: string; title?: string }
  | { type: "SubtaskDiscovered"; sessionId: string; description: string; agent: string }
  | { type: "SessionIdle"; sessionId: string }
  | { type: "QuestionAsked"; sessionId: string; requestId: string; questions: any[] }
  | { type: "PermissionRequested"; sessionId: string; requestId: string; permissionType: string };
```

### 4.2 原始 SSE 输入示例
```json
// Tool State Change 工具状态变更
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

## 5. 验收标准

- **AC-001**: 给定一系列代表推理 Agent 思考过程的 `message.part.delta` 事件，当其对应部分的类型被标记为 `"reasoning"` 时，`EventProcessor` 对每个数据块都返回 `null`，并阻止桥接器显示这些内容。
- **AC-002**: 给定用户直接在 opencode CLI 终端窗口中输入 `run test`，当 TUI Agent 执行并返回文本时，`SessionObserver` 会捕获没有关联 `message_id` 的 `TextDelta` 数据块，并在触发 `SessionIdle` 时自动将其推送到绑定的飞书群聊中。
- **AC-003**: 给定格式非预期的 SSE 事件，在处理时，处理器能优雅地返回 `null`，而不会导致 JSON 解析器崩溃或 Node 进程退出。

## 6. 自动化测试策略

- **测试层级**: 快速单元测试，将预定义的 JSON 字符串 Payload 数组输入到 `processEvent` 方法中。
- **测试数据管理**: 维护包含真实 opencode SSE 数据转储的快照文件夹（例如 `o1-reasoning.jsonl`, `bash-tool-run.jsonl`），以验证向后兼容性。
- **测试框架**: Vitest 单元测试。

## 7. 基本原理与背景

- **为什么要使用防腐层？** opencode 服务器内部事件的数据结构可能会频繁迭代更新。基于 `action.type === 'TextDelta'` 构建逻辑可保护桥接器代码库免受上游重构的影响。
- **为什么需要 TUI 越肩观察功能？** 开发者经常在电脑（本地 TUI）和手机（飞书等平台）之间切换。如果 Agent 在用户通勤期间完成了一个耗时 20 分钟的构建任务，`SessionObserver` 可以直接将终端输出推送到他们的移动端聊天界面中。

## 8. 依赖关系及外部集成

### 数据依赖
- **DAT-001**: Opencode Server SSE 格式。要求稳定的 `type` 区分标识，例如 `message.part.updated` 和 `session.idle`。

## 9. 示例及边缘情况 (Edge Cases)

### 边缘情况：乱序的 Delta 事件
`message.part.delta` 可能在主 `message.part.updated` 事件定义其为 `type: "reasoning"` 之前就已到达。解析器通过使用 `reasoningPartIds` 来防范此问题。如果收到未知 `partID` 的 delta 事件，必须允许其通过，除非我们能保证严格的有序交付机制。

## 10. 验证标准

- 必须为每个有效输出 Action 类型导出完整的 Typescript 接口。
- 不得出现无限制的内存驻留（例如，`reasoningPartIds` 理想情况下应在会话终止时被垃圾回收清除）。

## 11. 相关规范与进一步阅读
- [Streaming Bridge Specs](./spec-architecture-streaming-bridge.md)
