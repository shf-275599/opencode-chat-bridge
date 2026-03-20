# 核心实现细节 (Implementation Details)

本文档深入探讨 `opencode-lark` 的关键代码模块及其实现原理。

## 1. 消息处理器 (MessageHandler)
`src/handler/message-handler.ts` 是入站消息的司令部。

- **流控与去重**: 通过 `FeishuPlugin.gateway.deduplicate` 保证同一条飞书消息不会被处理两次。
- **Session 绑定策略**:
  - 如果用户之前已有绑定的 Session，直接透传。
  - 如果是新用户，自动寻找工作目录（CWD）下最活跃的 Session。
  - 找不到则报错，并引导用户使用 `/new` 命令。

## 2. SSE 事件流转换器 (StreamingBridge)
`src/handler/streaming-integration.ts` 负责将 Agent 的流存输出转化为 IM 卡片。

- **TextDelta 累加**: 实时收集分片文本，而不立即发送。
- **防抖更新 (Debounce)**: 飞书卡片更新有频率限制。`StreamingBridge` 会每隔 500ms-1s 更新一次卡片内容，避免触发 Rate Limit。
- **状态流转**: 
  - `ToolStart` -> 展示“工具执行中...”卡片。
  - `SessionIdle` -> 将完整原文推送到 IM，并移除中间态卡片。

## 3. 多渠道适配层 (ChannelManager)
`src/channel/manager.ts` 实现了插件化的架构。

- **解耦**: 核心业务逻辑（MessageHandler）不关心消息来自飞书还是 QQ。
- **插件注册**: 在 `src/index.ts` 中完成插件实例化。每个插件负责将平台特定的格式映射为 `ChannelInboundMessage`。

## 4. 进度追踪 (ProgressTracker)
`src/session/progress-tracker.ts` 用于处理“长耗时”任务。

当 Agent 在搜索网络或运行大型脚本时，`ProgressTracker` 会在 IM 侧显示动态进度（如：正在运行终端命令...），极大提升了用户等待时的反馈体验。
