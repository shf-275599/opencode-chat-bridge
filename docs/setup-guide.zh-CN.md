# 机器人配置指南

## 飞书应用配置

本节介绍如何创建飞书企业自建应用并配置所需权限。

### 1. 创建企业自建应用

1. 打开[飞书开放平台](https://open.feishu.cn/app)
2. 点击**创建应用** → **创建企业自建应用**
3. 填写应用名称和描述后确认

### 2. 开启机器人能力

进入**应用功能 → 机器人**，开启机器人功能。

### 3. 获取凭证

进入**凭证与基础信息**找到：

- **App ID** → 设为 `FEISHU_APP_ID`
- **App Secret** → 设为 `FEISHU_APP_SECRET`

步骤 6 配置 opencode-im-bridge-slim 时需要这些凭证。

### 4. 配置权限

进入**开发配置 → 权限管理**，开通以下权限：

| 权限 | 权限标识 | 用途 | 必需 |
|---|---|---|---|
| 获取与发送单聊、群组消息 | `im:message` | 发送消息、更新卡片 | ✅ |
| 获取用户发给机器人的单聊消息 | `im:message.p2p_msg:readonly` | 接收私聊消息 | ✅ |
| 获取群组中所有消息 | `im:message.group_msg` | 接收群聊中的所有消息 | ✅ |
| 获取群组中 @机器人的消息 | `im:message.group_at_msg:readonly` | 接收群聊中 @机器人的消息 | ✅ |
| 获取与上传图片或文件资源 | `im:resource` | 处理消息附件 | ✅ |
| 创建并发布卡片 | `cardkit:card:write` | 渲染交互式卡片（提问、权限审批） | ✅ |

> **提示**：你可以复制下面的 JSON，在飞书开放平台 **权限管理** 页面点击 **批量导入/导出** -> **导入**，直接导入所需权限：
> ```json
> {
>   "scopes": {
>     "tenant": [
>       "im:message",
>       "im:message.p2p_msg:readonly",
>       "im:message.group_msg",
>       "im:message.group_at_msg:readonly",
>       "im:resource",
>       "cardkit:card:write"
>     ]
>   }
> }
> ```


### 5. 发布应用

进入**应用发布 → 版本管理与发布**，创建版本并提交审核。审核通过后，将机器人添加到工作区。

> **注意**：测试阶段，应用管理员可直接使用，无需等待审核通过。

### 6. 配置并启动 opencode-im-bridge-slim

在配置事件订阅之前，需要先启动 opencode-im-bridge-slim，飞书才能检测到 WebSocket 连接。

1. 安装并配置：
   ```bash
   # 全局安装
   bun add -g opencode-im-bridge-slim
   # 或：npm install -g opencode-im-bridge-slim

   # 或从源码运行
   # git clone https://github.com/ET06731/opencode-im-bridge-slim.git
   # cd opencode-im-bridge-slim && bun install
   ```

2. 在一个终端启动 opencode server：
   ```bash
   # macOS / Linux
   OPENCODE_SERVER_PORT=4096 opencode serve
   
   # Windows (PowerShell)
   $env:OPENCODE_SERVER_PORT=4096; opencode serve
   ```

3. 在另一个终端启动 opencode-im-bridge-slim：
   ```bash
   opencode-im-bridge-slim
   ```
   交互式向导会引导你输入凭证并验证服务器连接。如从源码运行：`bun run dev`

   保持运行，然后继续下一步配置事件订阅。

> **提示**：要在 TUI 中实时查看消息，打开第三个终端并 attach 到 session：
> ```bash
> opencode attach http://127.0.0.1:4096 --session {session_id}
> ```
> `session_id` 会在 opencode-im-bridge-slim 启动日志中显示（如 `Bound to TUI session: ... → ses_xxxxx`）。

### 7. 订阅事件

进入**开发配置 → 事件订阅**，操作如下：

1. 选择**长连接**模式 — 无需公网 IP
2. 添加以下事件：

| 事件名称 | 事件标识 | 用途 | 必需 |
|---|---|---|---|
| 接收消息 | `im.message.receive_v1` | 接收用户消息 | ✅ |

> ⚠️ **重要**：保存长连接模式前 opencode-im-bridge-slim 必须处于运行状态（步骤 6）。如果看到"应用未建立长连接"错误，请返回步骤 6 确认应用已启动。

### 8. 订阅回调（交互式卡片）

进入**开发配置 → 事件与回调 → 回调订阅** — 这是与上方"事件订阅"**独立的配置项**。

1. 选择**长连接**模式
2. 添加以下回调：

| 回调名称 | 回调标识 | 用途 | 必需 |
|---|---|---|---|
| 卡片回传交互 | `card.action.trigger` | 接收卡片按钮点击（提问回答、权限审批） | ✅ |

> ⚠️ **重要**：这是交互式卡片（提问和权限审批）正常工作的必要配置。未配置时，点击卡片按钮会报错 `200340`。
>
> 事件订阅和回调订阅是**两个独立的设置**，必须分别配置。

### 故障排除

| 现象 | 可能原因 | 解决方案 |
|---|---|---|
| 机器人收不到消息 | 未开启长连接或事件未订阅 | 检查事件订阅，确认选择长连接模式 |
| 凭证错误 | `.env` 中凭证有误 | 从步骤 3 重新确认 App ID 和 App Secret |
| 收到消息但无回复 | opencode server 未启动 | 确保先启动 opencode server：`OPENCODE_SERVER_PORT=4096 opencode serve` |
| 卡片不实时更新 | 频率限制或防抖延迟 | 正常行为，防抖处理避免触发频率限制 |
| 点击卡片按钮报错 `200340` | 回调订阅未配置 | 进入**回调订阅** → 选择长连接 → 添加 `card.action.trigger` |
| 保存长连接模式时报"应用未建立长连接" | 应用未启动，飞书要求先建立连接 | 先完成步骤 6 启动 opencode-im-bridge-slim，再回飞书后台保存设置 |

---

## QQ 机器人配置
## 微信机器人配置

微信使用腾讯官方 **iLink Bot API**，认证方式与其他平台不同。

### 1. 启用微信

**方式一：环境变量**
```bash
export WECHAT_ENABLED=true
```

**方式二：配置文件**
```jsonc
"wechat": {
  "enabled": true,
  "sessionFile": "./data/wechat-session.json"
}
```

### 2. 登录流程

1. 首次运行时会自动显示二维码
2. 在微信中打开 **ClawBot 插件**（设置 → ClawBot）
3. 点击"连接"扫描二维码
4. 确认后自动登录，登录态保存到配置的文件路径

### 3. 技术特点

- 使用 HTTP 长轮询（35秒超时）接收消息
- `context_token` 用于消息关联和回复
- 支持文本、图片、语音（带文字识别）、文件

### 4. 注意事项

- 需要微信版本支持 ClawBot 插件
- 登录态有效期受腾讯政策限制
- 群聊支持需要额外配置

---


