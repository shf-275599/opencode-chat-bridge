# Q&A 卡片交互文档

本文档描述 opencode-im-bridge 如何在飞书中实现问答卡片交互。

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

## 交互流程

```
Agent 发送问题/权限请求
         ↓
   opencode SSE 事件
         ↓
   EventProcessor 解析事件
         ↓
   StreamingCardSession (飞书)
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

在 `config/opencode-im.jsonc` 中：

```jsonc
{
  "progress": {
    "debounceMs": 500,      // 飞书卡片更新防抖
    "maxDebounceMs": 3000   // 最大防抖时间
  }
}
```

---

## 注意事项

- CardKit 卡片有最大元素数量限制，长文本需截断或分页
- Webhook 服务器需公网可达（开发时可用 ngrok）
- Token 自动刷新，99991663 错误码触发重试
