# 核心实现细节 (Implementation Details)

本文档深入探讨 `opencode-lark` 的关键代码模块及其实现原理。

## 1. 消息处理器 (MessageHandler)
`src/handler/message-handler.ts` 是入站消息的司令部。

- **流控与去重**: 通过 `FeishuPlugin.gateway.deduplicate` 保证同一条消息不会被处理两次。
- **媒体文件处理**: 自动下载接收到的图片和文件附件，并在向外发出的 Prompt 中记录本地磁盘指针。
- **防抖合并 (Debounce)**: 如果配置了 `debounceMs` > 0，处理长多图文或连续的 IM 消息时，先将消息防抖合并。尤其是在发送图片时会等待紧随其后的文字输入，将其整合为一个整体上下文发给 Agent。
- **跨平台签名 (Context Signature)**: 对于处理通过插件化渠道进来的消息，如 `DiscordPlugin`，入站的消息会在文本末尾增加标签（例如 `[Discord]` 或者 `[Lark]`），告知底层 Agent 正在与哪个平台对话。
- **Session 绑定策略与自愈**:
  - 用户之前已有绑定的 Session 则直接使用。针对被动断开（服务器返回 HTTP 404）的情况下进行**自愈 (Self-Healing)**，清除旧有映射，发现并绑定一个新 Session 后重试。
  - 如果是新用户，自动寻找工作目录（CWD）下最活跃的 Session，找不到则引导用户使用 `/new` 命令。
- **多层级回退机制 (Multi-Tier Fallbacks)**: 
  - 优先级 1：**StreamingBridge** (使用 SSE 实时流式传输) -> 优先级 2：**Event-Driven** (监听 SSE 全量接收后统一推送) -> 优先级 3：**Sync Fallback** (直接基于 HTTP 请求响应)。

> **详细规格定义请参考：** [Message Handler Architecture Specification](../spec/spec-architecture-message-handler.md)

## 2. SSE 事件流转换器 (StreamingBridge)
`src/handler/streaming-integration.ts` 负责将 Agent 的流存输出转化为 IM 卡片。

- **TextDelta 累加**: 实时收集分片文本，而不立即发送。
- **防抖更新 (Debounce)**: 飞书卡片更新有频率限制。`StreamingBridge` 会每隔 500ms-1s 更新一次卡片内容，避免触发 Rate Limit。
- **状态流转**: 
  - `ToolStart` -> 展示“工具执行中...”卡片。
  - `SessionIdle` -> 将完整原文推送到 IM，并移除中间态卡片。

> **详细规格定义请参考：** [Streaming Bridge Architecture Specification](../spec/spec-architecture-streaming-bridge.md)

## 3. 多渠道适配层 (ChannelManager)
`src/channel/manager.ts` 与 `src/channel/types.ts` 实现了完全隔离的插件化架构。

- **解耦设计**: 通用的业务流不受底层 IM 特性的影响。QQ、Discord 等平台可以自由选择是否实现 `gateway`（长连接）、`outbound.sendCard` 等可选能力。
- **错误隔离 (Error Isolation)**: 在执行 `ChannelManager.startAll()` 时，如果某个渠道网关（例如 Discord Token 错误）挂掉，报错会被捕获而不会阻断其他健康渠道的正常启动。

> **详细规格定义请参考：** [Channel Manager Architecture Specification](../spec/spec-architecture-channel-manager.md)

## 4. 进度追踪与 TUI Session 自动发现 (ProgressTracker & SessionManager)
`src/session/session-manager.ts` 和 `src/session/progress-tracker.ts` 实现了持久化管理。

- **进度显式回馈**: 在不支持流式回显的场景中，在等待 Agent 执行深层逻辑时，推送具有时效性的“思考中”同步卡片。
- **TUI 自动发现**: 当尚未绑定会话的用户发出第一条指令时，会扫描当前工作目录 `OPENCODE_CWD` 中本机的 `opencode` TUI Session 实现自动绑定，以此完成 PC 端至移动端的跨端衔接。
- **SQLite 状态持久**: 应用内置 `bun:sqlite` 快速落盘键值映射关系；服务重启时自动遍历重连。

> **详细规格定义请参考：** [Session Management Architecture Specification](../spec/spec-architecture-session-management.md)

## 5. SSE 事件解析与观察审计 (EventProcessor)
`src/streaming/event-processor.ts` 作为反腐败隔离层，专门对接远端的 Server-Sent Events 流。

- **去推理化 (Anti-Reasoning)**: 抓取并丢弃类型为 `reasoning` (例如 o1 模型的本地推理过程) 的增量更新，避免给用户端带来干扰。
- **旁路观察 (SessionObserver)**: 当用户未在 IM 操作，而是亲自在终端命令行输入指令导致 Agent 返回数据时，Observer 会收集这些“非 IM 触发”输出并在 `SessionIdle` 阶段推送至关联平台。

> **详细规格定义请参考：** [Event Processor Architecture Specification](../spec/spec-architecture-event-processor.md)
