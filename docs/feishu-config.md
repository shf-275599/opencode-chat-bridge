# 飞书渠道配置指南

本指南详细说明如何配置飞书开放平台应用，以实现与 `opencode-lark` 的完美对接。

## 1. 创建应用
1. 访问 [飞书开放平台](https://open.feishu.cn/app)。
2. 点击 **创建企自建应用**。
3. 记下 **App ID** 和 **App Secret**。

## 2. 启用机器人能力
在应用详情页，进入 **应用功能 -> 机器人**，启用机器人能力。

## 3. 配置权限
进入 **开发配置 -> 权限管理**，批量导入以下权限：

```json
{
  "scopes": {
    "tenant": [
      "im:message",
      "im:message.p2p_msg:readonly",
      "im:message.group_msg",
      "im:message.group_at_msg:readonly",
      "im:resource",
      "cardkit:card:write"
    ]
  }
}
```

## 4. 订阅事件 (WebSocket 模式)
进入 **开发配置 -> 事件订阅**：
1. 开启 **长连接 (WebSocket)** 模式（无需公网 IP）。
2. 添加事件：`im.message.receive_v1` (接收消息)。

## 5. 订阅卡片交互 (关键)
进入 **开发配置 -> 事件订阅 -> 回调订阅 (Callback Subscription)**：
1. 同样开启 **长连接** 模式。
2. 添加回调：`card.action.trigger` (卡片内按钮交互)。

> [!WARNING]
> 如果不配置“回调订阅”，Agent 提出的提问卡片或权限请求卡片将无法点击，报错 `200340`。

## 6. 发布应用
在 **版本管理与发布** 中创建一个版本并申请运行。如果是内部应用且你是管理员，审核会秒过。
