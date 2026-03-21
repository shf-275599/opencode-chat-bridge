---
title: 流式桥接器架构规范 (Streaming Bridge Architecture Specification)
version: 1.0
date_created: 2026-03-21
owner: opencode-im-bridge 团队
tags: [architecture, design, streaming, UI]
---

# 概述

本规范定义了 `opencode-im-bridge` 中 `StreamingBridge` 组件的架构、要求和约束。Streaming Bridge 负责将来自 `opencode` 后端的 Server-Sent Events (SSE) 转换为动态的聊天 UI 元素（如：更新文本卡片、工具进度指示器），从而提供实时、互动的用户体验。

## 1. 目的与范围

`StreamingBridge` 的目的是处理通过 SSE 主动推送的代理（Agent）响应生命周期。其范围涵盖接收文本增量（`TextDelta`）、工具执行状态、子代理发现、交互式请求（提问和权限审批），以及在会话完成时（`SessionIdle`）结束并封卷响应。对于不支持动态卡片更新的 IM 平台，它还必须能够顺畅地优雅降级（Graceful degradation）。

## 2. 术语定义

- **Streaming Card (流式卡片)**: 聊天界面（特指飞书）中的一种动态 UI 元素，随着新内容的到达，可以通过 API 补丁 (Patch) 对其进行原地更新。
- **SSE (Server-Sent Events)**: 一种将实时操作事件从 `opencode` 代理流式推送到桥接器的通信协议。
- **CardKit (卡片工具包)**: 一个外部服务或内部 UI 封装模块，用于缓冲并序列化飞书卡片的更新请求，从而避免触发接口速率限制 (Rate-limiting)。
- **Interactive Event (交互式事件)**: 指需要用户通过可操作卡片进行显式输入的事件，如 `QuestionAsked`（被提问）或 `PermissionRequested`（权限审批）。

## 3. 需求、约束与规范

- **REQ-001 (流消费)**: 桥接器必须通过 `EventProcessor` 订阅 SSE 流，对 `TextDelta` 数据块进行缓冲，并动态更新活动的卡片 UI。
- **REQ-002 (平台降级)**: 桥接器必须专门在支持流式的平台（目前仅 `feishu`）上尝试动态卡片更新。对于不支持流式传输的渠道插件，它必须静默地在内存中缓冲文本，并在会话完成时一次性全量下发。
- **REQ-003 (消息截断)**: 桥接器必须保护 IM 的长度限制，对动态累积的文本进行截断（最大 102,400 字符），并在末尾附加 `...(内容过长，已截断)` 字样。
- **REQ-004 (首个事件超时)**: 如果在 5 分钟内（`FIRST_EVENT_TIMEOUT_MS`）没有收到任何事件，桥接器必须中止流式监听模式，记录超时日志，并回退到解析同步的 HTTP POST 响应文本。
- **REQ-005 (工具状态同步)**: 桥接器必须在聊天 UI 中动态呈现直观的 `ToolStateChange` 事件（如：`running`, `completed`, `error`）。
- **REQ-006 (子代理路由)**: 当触发 `SubtaskDiscovered` 事件时，桥接器必须下发一张解耦的独立通知卡片，指向子代理的具体会话任务。
- **REQ-007 (交互式模态框)**: 桥接器必须为 `QuestionAsked` 和 `PermissionRequested` 事件渲染出具有对应操作按钮的提示卡片供用户点击。
- **REQ-008 (同步完成清理)**: 当收到 `SessionIdle` 闲置信号时，桥接器必须结束并固化卡片内容，追加由于防抖暂存的出站媒体图像/附件，并彻底移除所有相关的 SSE 事件监听器。

## 4. 接口与数据契约

### 4.1 SSE Action 类型 (来源于 `EventProcessor`)
```typescript
type StreamAction = 
  | { type: "TextDelta"; text: string }
  | { type: "ToolStateChange"; toolName: string; state: string; title: string }
  | { type: "SubtaskDiscovered"; description: string; agent?: string; childSessionId?: string }
  | { type: "QuestionAsked"; requestId: string; questions: any[] }
  | { type: "PermissionRequested"; requestId: string; permissionType: string; title: string }
  | { type: "SessionIdle" };
```

### 4.2 StreamingBridge 接口 API
```typescript
interface StreamingBridge {
  handleMessage(
    chatId: string,
    sessionId: string,
    eventListeners: EventListenerMap,
    eventProcessor: EventProcessor,
    sendMessage: () => Promise<string>,
    onComplete: (text: string) => void,
    messageId: string,
    reactionId: string | null,
    channelId?: string,
  ): Promise<void>;
}
```

## 5. 验收标准

- **AC-001**: 给定用户在飞书使用的一个活跃会话，当 Agent 正在编写一个耗时 2 分钟的深层递归函数时，该用户应持续看到一个飞书卡片的内容在以每 500-1000 毫秒一次的频率动态刷新文本内容 直到完成。
- **AC-002**: 给定用户在 Discord 使用的一个活跃会话，当 Agent 生成回复时，Discord 的专属适配器将不开启流式行为，而是在内存中静默缓冲文本，直到接收到 `SessionIdle` 信号时，才将合并后的文本作为单条消息下发。
- **AC-003**: 给定一次产生子代理衍生的事件触发，当收到 `SubtaskDiscovered` 后，用户立即得到一张独立的微型卡片指示子代理的名字信息和子目标。
- **AC-004**: 给定某个响应异常迟缓、超过 5 分钟也未能给出流式首字节确认的模型供应商。当 5 分钟超时后，桥接器必须终止 SSE 监听，回退到并行的同步机制，在响应完成后直接向用户渲染文本负载。

## 6. 自动化测试策略

- **测试层级**: 大量集成测试通过运用 Mock 方法来充当推演 SSE 的事件节点发生器，并对其是否合法触发调用 `card.updateText()` 及 `feishuClient.sendMessage()` 分支步骤进行追踪记录监控 (Tracing)。
- **分析框架**: 借助自带 FakeTimers 沙箱环境的 Vitest（专门验证 5 分钟超时处理链路）。
- **测试数据管理**: 构造密集的 `TextDelta` 事件流，以模拟大语言模型的高频输出压力。
- **性能负载压测**: 验证内嵌 CardKit 之防抖器有效限制了卡片请求发送频率，并限定于各个聊天线程不高于每秒 2 频次的 API 请求边界，由此防止撞击飞书严格速率接口（Rate-Limit）导致的 429 错误。

## 7. 基本原理与背景

- **为何需要5分钟防死锁超时熔断守卫？** 依据用户的重度使用场景强度，如果本地正好在运行某些长阻塞进程或者等待大型的外部系统 Web 下载队列结束之前，`opencode` TUI 可能无法及时派生子任务或返回流式内容字符。设立五分钟延迟担保可确保桥接系统不会无限挂起，防止内存泄漏或资源持续被无效占用。
- **为何要特殊化区分飞书与其他渠道？** Telegram 或 Discord 等平台对“修改已发消息”接口存在苛刻的频率限制（例如 Discord 约 1次/秒）。相反，飞书等应用提供了原生高效的交互式组件框架（Card 组件），因此系统专门设计流式引擎以提供最佳的视觉响应体验。

## 8. 依赖关系及外部集成

### 外部连带系统机制
- **EXT-001**: opencode SSE Backend - 提供 Server-Sent Events 流式接口，推送大语言模型的执行细节和内容产出。

### 第三方系统接入
- **SVC-001**: 飞书开放平台 (Feishu Open Platform) - 接收通过 CardKit 构建的平台原生卡片 JSON 载荷更新。
- **SVC-002**: 其他辅助 IM 平台 - 通过按需注入的第三方 `ChannelPlugin` 实现文本优雅降级展示策略。

### 基础建设生态圈依靠
- **INF-001**: `CardKitClient` - 作为中间缓冲层，管理系统本地状态与远端卡片 API 之间的更新节流机制。

## 9. 示例及边缘情况 (Edge Cases)

### 边缘情况：意外遗弃的数据流 (Abandoned Streams)
如果底层事件流突然中断（例如由于本地 `opencode` 进程崩溃导致 OOM），`EventProcessor` 将不再发出任何信号。此时，同步的 POST 请求将捕获异常并介入处理。无论 Promise 被 Resolve 还是 Reject，与该会话相关的监听器都会被可靠地注销并清理其内存引用。

## 10. 验证标准

- 必须严格限制文本长度在 102,400 字符内，以防止超长负载拒绝服务攻击导致的系统崩溃或 IM 被封禁限流。
- 无论系统正常完成还是遇到严重异常捕获退出，系统都必须确保在最终状态中安全调用 `card.close()` 将响应式 UI 封存。
- 杜绝循环触发的交互传递：通过收集并比对 `requestId` 来过滤交互事件请求，防止重复处理引发的混乱逻辑冲突或死锁。

## 11. 相关规范与进一步阅读
- [消息处理器架构规范](./spec-architecture-message-handler.md)
