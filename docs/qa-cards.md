# Q&A 卡片交互文档

本文档描述 opencode-im-bridge 如何在飞书和 Telegram 中实现问答卡片交互。

## 交互类型

系统支持两种卡片交互：

| 类型 | 说明 | 触发方式 |
|------|------|----------|
| **Question** | Agent 询问用户问题，等待回答 | opencode SSE 事件 |
| **Permission** | Agent 请求权限（文件操作、命令执行等） | opencode SSE 事件 |

---

## 飞书实现

### 技术方案

- **卡片类型**：CardKit v2 流式卡片
- **发送方式**：`POST /open-apis/im/v1/messages` + `card_id` 引用
- **卡片更新**：通过 CardKit API `PUT /cardkit/v1/cards/{card_id}/elements/{element_id}/content`
- **流式关闭**：`PATCH /cardkit/v1/cards/{card_id}/settings` 结束流式模式
- **回调接收**：Webhook 服务器（默认端口 3001）接收卡片按钮点击

### 卡片生命周期

```
1. Agent 触发问题/权限请求
       ↓
2. StreamingCardSession.start() 创建流式卡片
   - schema: "2.0"
   - config.streaming_mode: true
   - body.elements[0]: markdown 元素 (element_id: "content")
       ↓
3. 卡片发送到飞书聊天
       ↓
4. 用户点击按钮 → Webhook 回调 → InteractiveHandler
       ↓
5. InteractiveHandler.handleQuestionAnswer() / handlePermissionReply()
   - POST /question/{requestId}/reply
   - POST /permission/{requestId}/reply
       ↓
6. StreamingCardSession.close() 关闭流式模式
```

### CardKit Schema

```typescript
// 卡片创建请求
const cardJson: CardKitSchema = {
  schema: "2.0",
  config: {
    streaming_mode: true,
    summary: { content: "[Generating...]" },
    streaming_config: {
      print_frequency_ms: { default: 200 },
      print_step: { default: 10 },
    },
  },
  body: {
    elements: [
      { tag: "markdown", content: "🛠️ Processing...", element_id: "content" },
    ],
  },
}
```

### 卡片回调处理

```typescript
// FeishuCardAction 结构
interface FeishuCardAction {
  action: {
    tag: "button"
    value: {
      action: "question_answer" | "permission_reply"
      requestId: string
      answers?: string[][]  // question_answer
      reply?: "once" | "always" | "reject"  // permission_reply
    }
  }
  open_message_id: string
  open_chat_id: string
  operator: { open_id: string }
}
```

### 关键文件

| 文件 | 职责 |
|------|------|
| `src/feishu/cardkit-client.ts` | CardKit v2 API 封装 |
| `src/streaming/streaming-card.ts` | 流式卡片生命周期管理 |
| `src/feishu/webhook-server.ts` | 接收卡片回调 |
| `src/handler/interactive-handler.ts` | 处理问答和权限响应 |
| `src/channel/feishu/feishu-plugin.ts` | 飞书 ChannelPlugin 实现 |

---

## Telegram 实现

### 技术方案

- **消息类型**：Inline 键盘按钮 (InlineKeyboardMarkup)
- **消息编辑**：`editMessageText` 更新流式消息
- **回调接收**：CallbackQuery + `answerCallbackQuery`
- **数据编码**：`tg1|{action}|{args}` 格式，限制 64 字节

### 按钮回调协议

```typescript
// 回调数据格式
type TelegramCallbackAction = "cmd" | "qa" | "pr"

// question 回调
"tg1|qa|{requestId}|{flatAnswers}"

// permission 回调  
"tg1|pr|{requestId}|{reply}"
// reply: "once" | "always" | "reject"
```

### Inline 卡片创建

```typescript
// createTelegramInlineCard(text, rows)
// rows: [[{ text: "按钮文本", payload: { action: "qa", requestId: "...", answers: [[...]] } }]]

const card = createTelegramInlineCard(
  "请选择方案：",
  [
    [
      { text: "🚀 方案 A", payload: { action: "qa", requestId: "req_123", answers: [["A"]] } },
      { text: "⚡ 方案 B", payload: { action: "qa", requestId: "req_123", answers: [["B"]] } },
    ],
  ]
)
```

### 消息流式更新

```typescript
// StreamingSession 实现
interface StreamingSession {
  sessionId: string
  lastMessageId?: string  // Bot 发送的最后消息 ID
  lastRenderedText: string
  
  flush(): Promise<void>   // 防抖后编辑消息
  close(finalText?): Promise<void>  // 发送最终消息
}
```

- 初始：发送新消息，记录 `message_id`
- 更新：编辑已发送消息 (900ms 防抖)
- 结束：编辑或发送最终消息

### 关键文件

| 文件 | 职责 |
|------|------|
| `src/channel/telegram/telegram-interactive.ts` | Inline 卡片创建、回调编解码 |
| `src/channel/telegram/telegram-plugin.ts` | Telegram Plugin + 长轮询 + 消息编辑 |
| `src/handler/interactive-handler.ts` | 处理问答和权限响应 |

---

## 统一交互流程

无论平台如何，交互流程一致：

```
Agent 发送问题/权限请求
         ↓
   opencode SSE 事件
         ↓
   EventProcessor 解析事件
         ↓
   StreamingCardSession (飞书) / StreamingSession (Telegram)
         ↓
   发送交互式卡片到用户
         ↓
   用户点击按钮
         ↓
   onCardAction 回调
         ↓
   InteractiveHandler 处理
         ↓
   POST /question/{id}/reply 或 /permission/{id}/reply
         ↓
   opencode 继续执行
```

---

## 配置选项

在 `opencode-im-bridge.jsonc` 中：

```jsonc
{
  "progress": {
    "debounceMs": 500,      // 飞书卡片更新防抖
    "maxDebounceMs": 3000   // 最大防抖时间
  }
}
```

Telegram 流式更新：固定 900ms 防抖 (`TELEGRAM_STREAM_THROTTLE_MS`)

---

## 注意事项

### 飞书

- CardKit 卡片有最大元素数量限制，长文本需截断或分页
- Webhook 服务器需公网可达（开发时可用 ngrok）
- Token 自动刷新，99991663 错误码触发重试

### Telegram

- `callback_data` 限制 64 字节，复杂数据需压缩
- 只能编辑 Bot 发送的消息，不能编辑用户消息
- `answerCallbackQuery` 的 text 限制 180 字符
