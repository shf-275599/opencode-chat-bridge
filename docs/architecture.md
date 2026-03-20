# 架构导读

本文档旨在为开发者提供 `opencode-lark` 的架构设计说明，涵盖模块布局、关键抽象、数据流以及系统扩展方法。

## 项目定位

`opencode-lark` 是一个桥接服务，它将 IM 聊天平台（飞书、QQ、Telegram、Discord）与 `opencode` TUI 会话连接起来。
用户在 IM 中发送的消息会流动到 `opencode` 中，如同在终端直接输入一样；Agent 的回复则实时流式推送回 IM 平台。

```
飞书/QQ/TG 客户端
    ↕  WebSocket (长连接)
IM 开放平台
    ↕  WebSocket / Webhook
opencode-lark (本项目)
    ↕  HTTP API + SSE
opencode server (localhost:4096)
    ↕  stdin/stdout
opencode TUI
```

---

## 模块地图

```
src/
├── index.ts         # 入口，负责 9 阶段启动与优雅关闭
├── types.ts         # 共享类型定义
├── channel/         # ChannelPlugin 接口、ChannelManager 调度
├── feishu/          # 飞书 REST 客户端、CardKit (卡片构建)、WebSocket
├── handler/         # MessageHandler (入站管道) + StreamingBridge (SSE → IM 卡片)
├── session/         # TUI session 发现、thread→session 映射、进度追踪
├── streaming/       # EventProcessor (SSE 解析)、SessionObserver
├── cron/            # CronService (定时任务) + HeartbeatService (心跳)
└── utils/           # 配置加载、日志、SQLite 初始化、工具类
```

---

## 关键抽象

### ChannelPlugin (`src/channel/types.ts`)

核心扩展契约。任何聊天平台（Slack, Discord 等）只需实现此接口即可接入 `ChannelManager`。

```typescript
interface ChannelPlugin {
  id: ChannelId           // 唯一标识，如 "feishu"
  meta: ChannelMeta       // 元信息（名称、描述）
  config: ChannelConfigAdapter      // 账户配置适配
  gateway?: ChannelGatewayAdapter   // 连接启动/停止
  messaging?: ChannelMessagingAdapter  // 入站消息标准化
  outbound?: ChannelOutboundAdapter    // 出站发送（文本/卡片）
}
```

### EventProcessor (`src/streaming/event-processor.ts`)

消费来自 `opencode` 的原始 SSE 流，并实时抛出结构化事件：`TextDelta` (文字增量), `SessionIdle` (空闲), `ToolStart` (工具开始) 等。

### SessionManager (`src/session/session-manager.ts`)

自动发现工作目录下的 `opencode` TUI 会话。它将 IM 的 Thread Key（聊天 ID + 话题 ID）绑定到具体的 Session ID，并将映射关系持久化在 SQLite 中。

### StreamingBridge (`src/handler/streaming-integration.ts`)

缓冲 `TextDelta` 事件，并将它们入队到卡片更新流中。当 `SessionIdle` 触发时，发送最终消息并平滑关闭流式卡片。如果是工具或子 Agent 状态，也会通过独立的进度卡片展示。

---

## 数据流向

### 入站 (IM → opencode)

1. **接收**: 平台 Plugin (如 `FeishuPlugin`) 通过 WebSocket 接收原始事件。
2. **标准化**: `ChannelMessagingAdapter` 将其转换为标准内部消息。
3. **处理**: `MessageHandler` 进行去重检查。
4. **路由**: `SessionManager` 查找或发现绑定的 session。
5. **分发**: 通过 HTTP POST 调用 `opencode` 的 `/session/{id}/message` 接口。
6. **反馈**: `ProgressTracker` 在 IM 端展示“思考中”的状态。

### 出站 (opencode → IM)

1. **订阅**: 启动对 `opencode` SSE 事件流的监听。
2. **解析**: `EventProcessor` 将原始字符串解析为强类型事件。
3. **分发**: `SessionObserver` 将事件分发给已注册的监听器。
4. **转换**: `StreamingBridge` 累积文字，触发卡片动态更新，并在结束时固化消息。

---

## 启动阶段 (Startup Phases)

`index.ts` 严格遵循 9 个启动阶段：

1. **Load Config**: 加载 `opencode-lark.jsonc` 或环境变量。
2. **Connect Server**: 连接 `opencode server`（指数退避重试，最大 10 次）。
3. **Init DB**: 初始化 SQLite 数据库（存储 session 映射与 cron 任务）。
4. **Create Services**: 创建 `SessionManager`, `EventProcessor`, `StreamingBridge` 等核心服务。
5. **Subscribe SSE**: 全局订阅 `opencode` 事件流。
6. **Register Plugins**: 实例化并注册各渠道插件（如 `FeishuPlugin`）。
7. **Start Channels**: 启动各渠道的 WebSocket 连接与 Webhook 服务。
8. **Start Cron**: 启动 `CronService` 与 `HeartbeatService`。
9. **Graceful Shutdown**: 监听 SIGTERM/SIGINT，确保资源安全释放。
