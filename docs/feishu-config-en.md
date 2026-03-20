# Feishu Configuration Guide

This guide walks you through the steps to set up your Feishu Open Platform app for `opencode-lark`.

## 1. Create the App
1. Go to [Feishu Open Platform](https://open.feishu.cn/app).
2. Click **Create Internal App**.
3. Note your **App ID** and **App Secret**.

## 2. Enable Bot Capability
In the app side menu, go to **App Features -> Bot** and enable it.

## 3. Set Permissions
Go to **Development Config -> Permissions & Scopes**. You can batch-import the following list:

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

## 4. Subscribe to Events (WebSocket Mode)
Go to **Development Config -> Event Subscriptions**:
1. Enable **Long Connection (WebSocket)** mode (no public IP required).
2. Add event: `im.message.receive_v1` (Receive Message).

## 5. Subscribe to Card Callbacks (CRITICAL)
Go to **Development Config -> Event Subscriptions -> Callback Subscription**:
1. Enable **Long Connection** mode specifically for callbacks.
2. Add callback: `card.action.trigger` (Card interactions).

> [!WARNING]
> Without this callback subscription, interactive cards (questions/permissions) will fail with error `200340`.

## 6. Publish the App
Create a version in **Version Management & Release** and submit it. For internal apps, administrators can approve it instantly.
