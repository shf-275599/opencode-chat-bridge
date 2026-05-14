---
title: 通道管理器架构规范 (Channel Manager Architecture Specification)
version: 1.0
date_created: 2026-03-21
owner: opencode-im-bridge-slim 团队
tags: [architecture, design, channel, plugin]
---

# 概述

本规范定义了 `opencode-im-bridge-slim` 中 `ChannelManager` 组件及生态关联的 `ChannelPlugin` 接口架构、要求与约束。通道管理器在基础聊天平台（如飞书、QQ、Telegram、Discord）之上提供了一层统一的抽象，使得核心业务逻辑能够与底层的网络协议或数据 Schema 彻底解耦。

## 1. 目的与范围

`ChannelManager` 的目的是为了管理不同 `ChannelPlugin` 实例的完整生命周期（包括注册、启动、停止）。它隔离了配置解析、入站消息标准化以及出站消息的格式化过程。该范围覆盖 `ChannelManager` 核心类及其对应的 `ChannelPlugin` 适配器接口契约。

## 2. 术语定义

- **Channel (通道)**: 指一个独立的 IM 平台（例如 `feishu`, `qq`, `wechat`）。
- **ChannelPlugin (通道插件)**: 通道接口的模块化实现，用于将特定 IM 平台接入桥接器网络中。
- **Adapter (适配器)**: `ChannelPlugin` 的子接口实现，负责更细分的业务领域（例如 `ChannelGatewayAdapter` 负责网络连接建立；`ChannelOutboundAdapter` 负责发送消息交互）。

## 3. 需求、约束与规范

- **REQ-001 (插件模块化)**: 核心系统绝对不能直接依赖于具体的第三方平台实现（例如，绝不能在 Message Handler 内硬编码 Telegram 的 API 调用）。所有的平台交互必须且只能通过 `ChannelPlugin` 接口路由。
- **REQ-002 (启动错误隔离)**: 当执行 `startAll()` 或 `stopAll()` 时，如果某一个通道网关启动失败，应当被捕获并记录日志，但也**绝不会**阻塞其他通道的正常启动。
- **REQ-003 (可选能力集)**: 插件不需要被强制实现所有能力选项。除 `config` 适配器必须要求以外，其他诸如 `gateway`, `messaging`, `outbound`, `streaming`, `threading` 的适配器完全是严格可选的。
- **REQ-004 (优雅降级)**: 如果核心系统特性（如流式更新卡片）尝试调用某项暂未受到平台插件提供的 API（如受限的 `outbound.sendCard`），系统必须优雅降级回退（如退回基本文本输出模式），而不是抛出空指针异常导致系统崩溃。
- **REQ-005 (标准化模型)**: 入站数据在可能的情况下必须被转换为标准的 `NormalizedMessage` 对象，以抹平各平台自有的数据格式差异。

## 4. 接口与数据契约

### 4.1 ChannelPlugin 契约 (Contract)
```typescript
interface ChannelPlugin {
  id: ChannelId;
  meta: ChannelMeta;
  config: ChannelConfigAdapter;         // 必填项: 解析凭证
  gateway?: ChannelGatewayAdapter;      // 可选项: 启动长轮询或 WebSocket 链接
  messaging?: ChannelMessagingAdapter;  // 可选项: 标准化消息体报文结构
  outbound?: ChannelOutboundAdapter;    // 可选项: 提供下发通用文本、卡片或图片的实现
  streaming?: ChannelStreamingAdapter;  // 可选项: 负责流式 Session 通信链路的初始化
  threading?: ChannelThreadingAdapter;  // 可选项: 覆盖线程会话与 IM Context 标识映射关系
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

## 5. 验收标准
- **AC-001**: 假设我们已经注册了一个携带错误非法 `bot token` 的 Telegram 插件，当调用 `startAll()` 时，Telegram 系统网关会抛出异常并被捕获记录日志，此时飞书等其他网关不受影响，能够正常启动。
- **AC-002**: 假设存在一条源自微信的新进消息，当达到 Handler 管道时，`wechat` `ChannelPlugin` 被调用并自行执行私有解析，然后将结构化信息传递给通用的消息处理器执行后续逻辑。
- **AC-003**: 假设核心应用准备下发一张新图片时，通过 `plugin.outbound.sendImage` 调度，对应通道的适配器会接管处理，读取本地绝对路径下的图片资源并发送给 IM 服务器。

## 6. 自动化测试策略

- **测试层级**: 专门针对验证 `ChannelManager.startAll()` 错误隔离特性的单元测试。使用 Mock 对象隔离接口以进行验证。
- **分析框架**: Vitest 内部断言以及 TS 类型强检查。
- **CI/CD 应用**: 通过严格的 TypeScript 类型推导构建阻断以防止适配器未对齐所需契约结构。

## 7. 基本原理与背景

- **为何要做可选化抽象适配（Optional Adapters）？** 因为不同的聊天平台行为差异巨大。QQ 平台没有开放动态更新的交互式卡片接口支持能力；基于 Webhook 的系统通常依赖外部 HTTP 代理配置回调，很少需要 gateway 主动管理连接；然而 Discord 却恰恰以内部长连接 WebSocket 作为心跳 Gateway 的立足点。能力集可选赋予了渐进增强 (Progressive enhancement) 最佳支持。
- **为何必须建立故障隔离（Fault Isolation）机制？** `opencode-im-bridge-slim` 目标是一个统一网关引擎。若 QQ 渠道外的公共服务端宕机进而造成 502 错误导致应用崩溃，绝对不应该令原本服务企业内网的飞书用户集群在质询 Agent 时中断服务。

## 8. 依赖关系及外部集成

### 架构级系统绑定
- **DEP-001**: 必须接受标准 `AbortController` API — 并将 `AbortSignal` 向下传递至 `startAll` 中，以方便统筹销毁清理关闭当前系统并发的 Channel 长连接。

## 9. 示例及边缘情况 (Edge Cases)

### 边缘情况：某功能缺失适配器触发异常
```typescript
// Core system must always check adapter existence before invocation
// 核心系统必须调用前检测适配器存续情况
const plugin = channelManager.getChannel("wechat");
if (plugin?.outbound?.sendCard) {
  await plugin.outbound.sendCard(target, cardData);
} else {
  // Graceful degradation 优雅降级，使用文本替代发送
  await plugin?.outbound?.sendText(target, fallbackText);
}
```

## 10. 验证标准

- 代码库中所有使用的 Channel ID 必须映射到唯一实例化的插件，并在启动的第 6 阶段完成注册与激活。
- Plugin 接口内部不得修改 ChannelManager 全局单例的任何属性。

## 11. 相关规范与进一步阅读
- [实现细节指南](../docs/implementation.md)
