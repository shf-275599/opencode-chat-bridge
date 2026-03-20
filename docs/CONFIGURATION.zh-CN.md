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

步骤 6 配置 opencode-im-bridge 时需要这些凭证。

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

### 6. 配置并启动 opencode-im-bridge

在配置事件订阅之前，需要先启动 opencode-im-bridge，飞书才能检测到 WebSocket 连接。

1. 安装并配置：
   ```bash
   # 全局安装
   bun add -g opencode-im-bridge
   # 或：npm install -g opencode-im-bridge

   # 或从源码运行
   # git clone https://github.com/ET06731/opencode-im-bridge.git
   # cd opencode-im-bridge && bun install
   ```

2. 在一个终端启动 opencode server：
   ```bash
   # macOS / Linux
   OPENCODE_SERVER_PORT=4096 opencode serve
   
   # Windows (PowerShell)
   $env:OPENCODE_SERVER_PORT=4096; opencode serve
   ```

3. 在另一个终端启动 opencode-im-bridge：
   ```bash
   opencode-im-bridge
   ```
   交互式向导会引导你输入凭证并验证服务器连接。如从源码运行：`bun run dev`

   保持运行，然后继续下一步配置事件订阅。

> **提示**：要在 TUI 中实时查看消息，打开第三个终端并 attach 到 session：
> ```bash
> opencode attach http://127.0.0.1:4096 --session {session_id}
> ```
> `session_id` 会在 opencode-im-bridge 启动日志中显示（如 `Bound to TUI session: ... → ses_xxxxx`）。

### 7. 订阅事件

进入**开发配置 → 事件订阅**，操作如下：

1. 选择**长连接**模式 — 无需公网 IP
2. 添加以下事件：

| 事件名称 | 事件标识 | 用途 | 必需 |
|---|---|---|---|
| 接收消息 | `im.message.receive_v1` | 接收用户消息 | ✅ |

> ⚠️ **重要**：保存长连接模式前 opencode-im-bridge 必须处于运行状态（步骤 6）。如果看到"应用未建立长连接"错误，请返回步骤 6 确认应用已启动。

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
| 保存长连接模式时报"应用未建立长连接" | 应用未启动，飞书要求先建立连接 | 先完成步骤 6 启动 opencode-im-bridge，再回飞书后台保存设置 |

---

## QQ 机器人配置

本节介绍如何创建 QQ 官方机器人并接入。

### 1. 创建机器人
1. 访问 [QQ 开放平台](https://q.qq.com/bot/#/home)。
2. 创建一个“QQ 机器人”。
3. 在**开发设置**中获取：
   - **App ID** (即 `QQ_APP_ID`)
   - **App Secret** (即 `QQ_SECRET`)

### 2. 配置权限
在开放平台后台，确保开启了以下基础权限：
- 公域/私域消息回调。
- 文本/图片消息接收机制。

### 3. 配置 opencode-im-bridge
运行 `opencode-im-bridge init` 时选择 `qq` 渠道，或直接在 `.env` 中填写 `QQ_APP_ID` 和 `QQ_SECRET`。


## Telegram 机器人配置

1. 在 Telegram 搜索 `@BotFather`。
2. 发送 `/newbot` 创建机器人并获取 **Bot Token**。
3. 在 opencode-im-bridge 中配置该 Token。

---

## Discord 机器人配置

1. 访问 [Discord Developer Portal](https://discord.com/developers/applications)。
2. 点击 **New Application** 创建应用并命名。
3. 进入左侧的 **Bot** 菜单。
4. 在 **Privileged Gateway Intents** 部分，**必须开启**以下选项：
   - **Message Content Intent** (用于读取用户发送的消息内容)
5. 点击 **Reset Token** 获取 **Token** (对应 `DISCORD_BOT_TOKEN`)。
6. 进入 **OAuth2 -> URL Generator**，勾选 `bot` 作用域，以及 `Send Messages` 和 `Read Message History` 权限，生成链接并邀请机器人到你的服务器。
7. 在 opencode-im-bridge 中（或 `.env` 文件）配置该 Token。

> **提示**：你可以通过配置 `DISCORD_ALLOWED_CHANNEL_IDS` (逗号分隔的频道ID列表) 来限制机器人只在特定的频道中回复消息。
