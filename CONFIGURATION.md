# Bot Configuration Guide

## Feishu App Setup

### 1. Create an Internal App

1. Open [Feishu Open Platform](https://open.feishu.cn/app)
2. Click **Create App** → **Create Internal App**
3. Fill in app name and description, then confirm

### 2. Enable Bot Capability

Navigate to **App Features → Bot** and enable the bot capability.

### 3. Get Credentials

Navigate to **Credentials & Basic Info** to find:

- **App ID** → set as `FEISHU_APP_ID`
- **App Secret** → set as `FEISHU_APP_SECRET`

You'll need these in Step 6 to configure opencode-im-bridge.

### 4. Configure Permissions

Navigate to **Development Config → Permissions & Scopes** and add the following:

| Permission | Scope Identifier | Purpose | Required |
|---|---|---|---|
| 获取与发送单聊、群组消息 | `im:message` | Send messages & update cards | ✅ |
| 获取用户发给机器人的单聊消息 | `im:message.p2p_msg:readonly` | Receive direct messages | ✅ |
| 获取群组中所有消息 | `im:message.group_msg` | Receive all group messages | ✅ |
| 获取群组中 @机器人的消息 | `im:message.group_at_msg:readonly` | Receive group messages that @mention the bot | ✅ |
| 获取与上传图片或文件资源 | `im:resource` | Handle message attachments | ✅ |
| 创建并发布卡片 | `cardkit:card:write` | Render interactive cards (questions, permissions) | ✅ |

### 5. Publish the App

Navigate to **App Release → Version Management & Release**, create a version and submit for review. After approval, add the bot to your workspace.

> **Note**: Internal apps in trial status can be used by app administrators immediately without review for testing.

### 6. Configure & Start opencode-im-bridge

Before configuring event subscriptions, start opencode-im-bridge so Feishu can detect the WebSocket connection.

1. Install and configure:
   ```bash
   # Install globally
   bun add -g opencode-im-bridge
   # or: npm install -g opencode-im-bridge

   # Or run from source
   # git clone https://github.com/ET06731/opencode-im-bridge.git
   # cd opencode-im-bridge && bun install
   ```

2. Start opencode server in one terminal:
   ```bash
   OPENCODE_SERVER_PORT=4096 opencode serve
   ```

3. Start opencode-im-bridge in another terminal:
   ```bash
   opencode-im-bridge
   ```
   The interactive setup wizard will guide you through entering credentials and validating the server connection. If running from source: `bun run dev`

   Keep this running while you configure event subscriptions in the next step.

> **Tip**: To see messages in real-time in the TUI, open a third terminal and attach to the session:
> ```bash
> opencode attach http://127.0.0.1:4096 --session {session_id}
> ```
> The `session_id` is shown in opencode-im-bridge's startup logs (e.g. `Bound to TUI session: ... → ses_xxxxx`).

### 7. Subscribe to Events

Navigate to **Development Config → Event Subscriptions** and:

1. Select **Long Connection** (WebSocket) mode — no public IP required
2. Add the following event:

| Event Name | Event Identifier | Purpose | Required |
|---|---|---|---|
| 接收消息 | `im.message.receive_v1` | Receive all user messages | ✅ |

> ⚠️ **Important**: opencode-im-bridge must be running (Step 6) before you can save Long Connection mode. If you see "应用未建立长连接", go back to Step 6 and ensure the app is running.

### 8. Subscribe to Callbacks (Interactive Cards)

Navigate to **Development Config → Event Subscriptions → Callback Subscription** (回调订阅) — this is a **separate section** from Event Subscription above.

1. Select **Long Connection** (WebSocket) mode
2. Add the following callback:

| Callback Name | Callback Identifier | Purpose | Required |
|---|---|---|---|
| 卡片回传交互 | `card.action.trigger` | Receive card button clicks (question answers, permission replies) | ✅ |

> ⚠️ **Important**: This is required for interactive cards (questions & permissions). Without it, clicking card buttons shows error `200340`.
>
> Event Subscription and Callback Subscription are **two separate settings**. You must configure both.

### Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Bot doesn't receive messages | WebSocket not enabled or wrong subscription | Check event subscription, ensure Long Connection mode is selected |
| "Invalid App ID or Secret" | Wrong credentials in .env | Double-check App ID and App Secret from Step 3 |
| Messages received but no reply | opencode server not running | Ensure opencode server is running: `OPENCODE_SERVER_PORT=4096 opencode serve` |
| Card not updating in real-time | Rate limit or debounce delay | Normal behavior — updates are debounced to stay within Feishu rate limits |
| Error `200340` when clicking card buttons | Callback subscription not configured | Go to **Callback Subscription** (回调订阅) → select Long Connection → add `card.action.trigger` |
| "应用未建立长连接" when saving Long Connection mode | App not running — Feishu requires an active WebSocket connection before saving | Start opencode-im-bridge first (Step 6), then save the setting in Feishu console |

---

## QQ Bot Setup

This section covers how to create and connect a QQ Official Bot.

### 1. Create a Bot
1. Visit [QQ Open Platform](https://q.qq.com/bot/#/home).
2. Create a "QQ Bot".
3. In **Development Settings**, obtain:
   - **App ID** (mapped to `QQ_APP_ID`)
   - **App Secret** (mapped to `QQ_SECRET`)

### 2. Configure Permissions
In the dashboard, ensure you've enabled:
- Public/Private message callbacks.
- Text/Image message receiving mechanisms.

### 3. Configure opencode-im-bridge
Run `opencode-im-bridge init` and select the `qq` channel, or fill in `QQ_APP_ID` and `QQ_SECRET` in your `.env`.


## Telegram Bot Setup

1. Search for `@BotFather` in Telegram.
2. Send `/newbot` to create a bot and get the **Bot Token**.
3. Configure this token in opencode-im-bridge.

---

## Discord Bot Setup

1. Visit the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** and give your bot a name.
3. Navigate to the **Bot** tab on the left menu.
4. Under the **Privileged Gateway Intents** section, you MUST enable:
   - **Message Content Intent** (Required to read messages)
5. Click **Reset Token** to get your **Bot Token** (maps to `DISCORD_BOT_TOKEN`).
6. Navigate to **OAuth2 -> URL Generator**, select `bot` scope, and `Send Messages`, `Read Message History` permissions to invite the bot to your server.
7. Configure this token in `opencode-im-bridge` via the interactive setup or `.env`.

> **Note**: You can optionally configure `DISCORD_ALLOWED_CHANNEL_IDS` (comma-separated) to restrict the bot to only reply in specific channels.
