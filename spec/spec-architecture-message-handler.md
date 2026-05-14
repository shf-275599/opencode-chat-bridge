---
title: 消息处理器架构规范 (Message Handler Architecture Specification)
version: 1.0
date_created: 2026-03-21
owner: opencode-im-bridge-slim 团队
tags: [architecture, design, message-handling]
---

# 概述

本规范定义了 `opencode-im-bridge-slim` 中 `MessageHandler` 组件的架构、要求和约束。消息处理器用作入站管道 (inbound pipeline)，负责处理来自各聊天渠道（如飞书、QQ、Telegram、Discord）的事件，并在它们被路由到 `opencode` 服务器之前管理其生命周期。

## 1. 目的与范围

消息处理器的目的是可靠地处理传入的聊天事件，应对不同渠道特有的限制，并在聊天域与 `opencode` TUI 代理之间维护会话状态映射。范围涵盖了消息去重、文件/图片解析、会话管理、消息防抖 (debouncing) 以及多层响应处理（流式桥接、基于事件收集及同步回退）。

## 2. 术语定义

- **IM (即时通讯)**: 指飞书、QQ、Telegram、Discord等平台。
- **SessionId**: 代表 `opencode` TUI 会话的唯一标识符。
- **ThreadKey (feishuKey)**: IM 中表示唯一聊天线程的复合键（例如群聊的 `chat_id:root_id`，普通私聊的 `chat_id`）。
- **StreamingBridge (流式桥接器)**: 挂载 `opencode` 的 Server-Sent Events (SSE) 流并将增量更新实时流式传输至受支持 IM 客户端的组件。
- **EventProcessor (事件处理器)**: 负责消费原始 SSE 流并触发强类型可操作事件（如 `TextDelta`, `SessionIdle`）的组件。

## 3. 需求、约束与规范

- **REQ-001 (消息去重)**: 处理器必须基于 `event_id` 丢弃重复的事件，防止二次触发。
- **REQ-002 (渠道不可知性)**: 处理器必须只通过 `ChannelPlugin` 接口透明地处理传入事件，依赖插件本身进行出站消息的传递和特定平台的格式化。
- **REQ-003 (群聊@提及)**: 在群聊中，只有当显式提及 (@) 机器人的 `open_id` 时，才处理该消息。
- **REQ-004 (富媒体分析支持)**: 处理器必须安全解析、下载并存储所附带的文档或图片至本地，随后将 IM 实体消息的载荷替换为发给 Agent 读取的文件路径指针。必须严格防范路径穿越 (Path traversal) 漏洞。
- **REQ-005 (消息防抖合并)**: 为了妥善处理媒体，发送来的消息（特别是紧跟着文本发送的各类文件/图片）必须被防抖排队处理批量合并关联的上下文语义。
- **REQ-006 (跨平台上下文标签)**: 处理器需在传入的消息前附加上平台特定标签（如 `[Lark]`，`[QQ]`），从而赋予后端 Agent 对所处聊天平台的感知能力。
- **REQ-007 (斜杠快捷指令)**: 如果该消息触发预设动作（例如 `/new`, `/status` 等），处理器必须提早阻断，快速响应结束进程。
- **REQ-008 (多层降级响应)**: 系统的出站必须能按照以下优先级流畅降级回退：Streaming Bridge (流式卡片更新) -> 事件驱动本地收集 -> 同步 POST 响应聚合。
- **REQ-009 (会话自愈机制)**: 若发现后端返回 HTTP 404 (Session Gone)，说明绑定的代理已不在活动状态，此时处理器必须自主抛弃陈旧映射并隐式衍生出新会话，执行静默无缝重试。

## 4. 接口与数据契约

### 4.1 入站消息数据传输对象 (`FeishuMessageEvent` 示例)
```typescript
interface FeishuMessageEvent {
  event_id: string;
  chat_id: string;
  chat_type: "p2p" | "group";
  message_id: string;
  root_id?: string;
  parent_id?: string;
  message: {
    message_type: "text" | "post" | "image" | "file";
    content: string; // JSON 序列化字符串
  };
  mentions?: Array<{ id: { open_id: string } }>;
}
```

### 4.2 处理器依赖注入 (`HandlerDeps`)
`createMessageHandler` 工厂期望获得 `HandlerDeps` 对象，该对象内部注入有 `SessionManager`, `EventProcessor`, `StreamingBridge`, `OutboundMediaHandler`，以及 `ChannelManager` 组件。

## 5. 验收标准

- **AC-001**: 给定用户上传的一份文件负载，当处理器接管报文时，文件必须被正确保存到本地附件库安全目录，并且送达 opencode 的提示词 (Prompt) 文本内容经过重写，成功包含了被验证绝对路径的文本。
- **AC-002**: 给定群聊接收的一条普通文本，若没有显式包含该机器人的 openId 提及，处理器立即中止处理，不再请求 opencode 引擎。
- **AC-003**: 给定向 `POST /session/{id}/message` 发起请求时碰到的 404 错误，表示 Agent 会话已失效，处理器必须立刻清除相应的会话映射，重建新的子会话，并针对相同的 prompt 自动重试发送，实现用户无感知的异常恢复。
- **AC-004**: 给定一张图片连带着快速追加了一段描述文字，当启动防抖机制时 (>0ms)，两端请求被推入缓冲列队并且合并后作为一个整体语境发送到 opencode 服务器。

## 6. 自动化测试策略

- **测试层级**: 逻辑侧重于专门针对去重与文件过滤剥离的漏洞检测（单元测试）；包含 Mock HTTP 与 SSE 等全部连条行为（集成测试）。
- **分析框架**: Vitest / Jest。
- **测试数据管理**: 构造 `FeishuMessageEvent` 等基本 Mock 数据用于校验处理逻辑。使用前先 `Mock` fs API，避免产生真正的磁盘读写。
- **需求覆盖率**: 要求针对 Handler 入口处理逻辑核心网格至少覆盖到 85% 分支，尤其重视测试防抖机制 (debounce) 与会话失效自愈 (404-recovery) 的异常处理链路。

## 7. 基本原理与背景

- **为什么需要消息防抖机制？** 各种 IM 平台通常将带有描述的图片消息拆分为单独的图片事件和文本事件先后到达。如果没有合并措施，极大概率会被发送引擎切割，导致 Agent 本身收到破碎的单片对话丧失语义串联且触发并发死锁条件。
- **为什么分层回退（Multi-Tier Fallback）这么重要？** 并非所有的即时聊天终端都设计过允许任意篡改历史即时交互卡片（比如早年的旧框架）。将 Streaming 置为极高优先保障良好体验，而 sync / Event-Driven 队列回收集则服务于不能编辑交互的传统聊天引擎设计。
- **自愈功能解决了什么？** 用户普遍下班会让窗口离线抛入后台进入无操作闲时休眠，从而导致原本挂接在内存层面的老 opencode 引擎端失效终止。如果要求用户手动输入 `/new` 来重置会话，会显著降低体验。因此，程序对失效会话的静默重连和自愈是提升用户体验的关键。

## 8. 依赖关系及外部集成

### 相关远端应用
- **EXT-001**: opencode HTTP API - 处理核心 TUI 会话进程逻辑，接收 `POST /session/{id}/message` 内容投递。
- **EXT-002**: opencode SSE Stream - The Server-Sent Events Endpoint 实时推送如思考过程、回复内容等 Agent 的运行状态更新。

### 第三方系统接入
- **SVC-001**: 中大型企业协同及聊天套件（飞书、QQ、Telegram）- 开放对应 WebAPI 获取会话记录片段及读取二进制文件流。

### 基础设施支持
- **INF-001**: Local Filesystem - 用于长期存储 SQLite 数据落盘防丢失状态文件、及用于临时过渡各种图片附件以策安全保障。
- **INF-002**: Memory Runtime - 依附运行时的高速闪存记录排重表机制及映射分发给具体流控制监听者的关联绑定表状态。

## 9. 示例及边缘情况 (Edge Cases)

### 边缘情况：媒体附件引发的路径穿越攻击 (Path Traversal Attack) 拦截
```typescript
// Incoming file_name: ../../../etc/shadow
function sanitizeFilename(raw: string): string {
  // 必须使用强硬的匹配式剔除任意尝试注入跳出限制的父级访问标记或者点号分隔。
  // 须强制裁剪文件长度字符数上限规避 OS 类型溢出的特殊崩溃溢出错误。
}
```

### 边缘情况：重叠式的图片+多语境内容
当检测为媒体消息 (`isMedia` 为 true) 时，处理管线会将其推入合并缓冲区，并启动防抖定时器等待伴随的文本描述到达合并；如果在超时前收到文本，则一并提交处理，从而避免孤立的媒体消息引发上下文断裂。

## 10. 验证标准

- 该通道拦截器务必需以极高透明兼容度接驳各具特色的自定义加载模块（`ChannelPlugin` 接口驱动）。
- 测试案例必须对断点和无响应断网产生超时拒绝请求抛错场景进行全面 `removeListener` 反监听解绑测试防止系统产生大规模内存指针泄漏 (Memory Leak)。
- 文件的读写 Mode 权限要被配置限制保障只执行最小操作可能范围的锁定（例 `0o600`）。

## 11. 相关规范与进一步阅读

- [架构设计指南](../docs/architecture.md)
- [代码实现详情手册](../docs/implementation.md)
