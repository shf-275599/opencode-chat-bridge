# wechat/

WeChat iLink Bot API channel integration.

## Overview

WeChat integration uses the official iLink Bot API published by Tencent via OpenClaw framework. This enables bridging WeChat messages with opencode TUI sessions.

## Architecture

```
WeChat Client
    ↓
iLink Bot API (ilinkai.weixin.qq.com)
    ↓
WechatPlugin (src/channel/wechat/)
    ↓
SessionManager + opencode HTTP API
```

## Files

### `wechat-plugin.ts`
- Implements `ChannelPlugin` interface using `@wechatbot/wechatbot` npm package
- Gateway: QR code login + long polling loop for message reception via WeChatBot SDK
- Outbound: Send text/images/files/audio/video messages, typing indicators
- Streaming: basic StreamingSession (no-edits, flush = no-op, close → sendText)
- Threading: C2C thread per user

## Key Differences from Other Channels

| Aspect | Feishu/QQ/DingTalk | WeChat |
|--------|-------------------|--------|
| Protocol | WebSocket | HTTP Long Polling |
| Auth | App credentials | QR code login |
| Message token | message_id | `context_token` (required for reply) |
| Session | Stored in config | Stored in separate session file |

## Configuration

```jsonc
{
  "wechat": {
    "enabled": true,
    "sessionFile": "./data/wechat-session.json"
  }
}
```

Environment variable: `WECHAT_ENABLED=true`

## Gotchas

- WeChat requires QR code login on first run
- `context_token` must be included in every reply
- Long polling timeout is 35 seconds
- Session file stores bot_token and baseUrl
