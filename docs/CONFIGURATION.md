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

> **Tip**: You can copy the JSON below and use the **Batch Import/Export** -> **Import** feature in the Feishu **Permissions & Scopes** page to quickly add all required permissions:
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


## DingTalk Bot Setup

This section covers how to create a DingTalk enterprise internal app and connect it as a bot.

### 1. Create an Enterprise Internal App

1. Open [DingTalk Open Platform](https://open.dingtalk.com/)
2. Click **Application Development → Enterprise Internal Development**, then click **Create Application**
3. Fill in app name and description, select your enterprise
4. After creation, get the following from the app details page:
   - **App Key** → set as `DINGTALK_APP_KEY`
   - **App Secret** → set as `DINGTALK_APP_SECRET`

### 2. Enable Bot Capability

Navigate to **App Features → Bot** and enable the bot capability.

### 3. Configure Permissions

Navigate to **Permissions & Scopes** and add the following:

| Permission | Scope Identifier | Purpose | Required |
|---|---|---|---|
| Get and send p2p/group messages | `企微机器人>获取与发送单聊消息` | Send messages | ✅ |
| Get user info within enterprise | `企业内用户身份-basic:userid:read` | Get user information | ✅ |
| Upload media files | `微应用>上传媒体文件` | Upload images, files, etc. | ✅ |

### 4. Configure Event Subscription (Long Connection Mode)

1. Navigate to **Development Config → Events & Callbacks**
2. Select **Long Connection** mode
3. Add the following event subscription:
   - Receive Message (`im.message.receive_v1`)

> **Note**: Long Connection mode doesn't require a public server, but opencode-im-bridge must be running to establish the connection.

### 5. Configure opencode-im-bridge

#### Option 1: Environment Variables

```bash
export DINGTALK_APP_KEY=your_app_key
export DINGTALK_APP_SECRET=your_app_secret
export DINGTALK_AGENT_ID=your_agent_id  # Optional
```

#### Option 2: Configuration File

```jsonc
{
  "dingtalk": {
    "appKey": "your_app_key",
    "appSecret": "your_app_secret",
    "agentId": "your_agent_id"  // Optional
  }
}
```

### 6. Start the Service

1. Start opencode server first:
   ```bash
   opencode serve
   ```

2. Then start opencode-im-bridge:
   ```bash
   opencode-im-bridge
   ```

### 7. Verify Configuration

After successful startup, you should see logs similar to:
```
[DingTalkPlugin] Starting DingTalk long polling...
[DingTalkPlugin] Connected as Bot: xxx
```

Send a message to the bot to test if it's working.

### Technical Features

- Uses HTTP long polling to receive messages (~25 second timeout)
- Supports text, images, files, audio, and video messages
- Interactive cards support questions and permission approvals
- access_token is automatically cached and refreshed

### Notes

- Ensure the DingTalk app is published and the bot is added to group/p2p chat
- In long connection mode, opencode-im-bridge must remain running
- In group chats, the bot responds only when @mentioned
