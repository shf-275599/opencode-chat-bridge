# opencode-chat-bridge

> 将飞书/QQ/微信/钉钉机器人与 opencode 打通，实现双向实时消息转发。

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## 功能特性

- **实时桥接** — IM 消息即时出现在 opencode，agent 回复以动态卡片形式推送回 IM
- **多渠道支持** — 飞书、QQ、微信、钉钉
- **交互式卡片** — agent 的提问和权限请求以可点击卡片呈现，直接在聊天中回答或审批
- **SSE 流式输出** — 订阅 opencode SSE 事件流，实时更新回复内容
- **文件与图片支持** — 支持图片、文档、音视频消息的收发
- **定时任务** — 支持自然语言创建周期性任务，自动执行并通过 IM 发送结果

---

## 支持的平台

| 平台 | 通信协议 | 认证方式 | 流式输出 |
|------|----------|----------|----------|
| 飞书 | WebSocket | App ID + Secret | ✅ 卡片 |
| QQ | WebSocket | App ID + Secret | ❌ |
| 微信 | HTTP 长轮询 | 扫码登录 | ❌ |
| 钉钉 | HTTP 长轮询 | App Key + Secret | ❌ |

---

## 快速开始

### 前置要求

- **[Bun](https://bun.sh)**（必需，项目使用 `bun:sqlite`）
- **[opencode](https://opencode.ai)** 已安装
- 至少一个平台的机器人凭证

### 安装

```bash
# 全局安装
npm install -g opencode-im-bridge
# 或
bun add -g opencode-im-bridge
```

或从源码运行：

```bash
git clone https://github.com/shf-275599/opencode-chat-bridge.git
cd opencode-chat-bridge
bun install
```

### 启动

**1. 启动 opencode server**

```bash
OPENCODE_SERVER_PORT=4096 opencode serve
```

**2. 启动 bridge（另一个终端）**

```bash
opencode-im-bridge
```

首次运行会启动交互式向导，引导你选择渠道并输入凭证。

> 如需重新配置，运行 `opencode-im-bridge init`

---

## 斜杠命令

在聊天窗口中输入：

| 命令 | 说明 |
|------|------|
| `/new` | 新建会话 |
| `/sessions` | 查看会话列表 |
| `/connect {id}` | 连接到指定会话 |
| `/compact` | 压缩上下文历史 |
| `/abort` | 中止当前任务 |
| `/model` | 切换模型 |
| `/agent` | 切换 Agent |
| `/status` | 查看当前状态 |
| `/help` | 查看帮助 |

---

## 配置说明

### 环境变量

| 变量 | 说明 |
|------|------|
| `FEISHU_APP_ID` | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret |
| `QQ_APP_ID` | QQ 应用 App ID |
| `QQ_SECRET` | QQ 应用 App Secret |
| `WECHAT_ENABLED` | 设为 `true` 启用微信 |
| `DINGTALK_APP_KEY` | 钉钉应用 App Key |
| `DINGTALK_APP_SECRET` | 钉钉应用 App Secret |
| `OPENCODE_SERVER_URL` | opencode server 地址（默认 `http://localhost:4096`）|

### JSONC 配置文件

创建 `opencode-im-bridge.jsonc`：

```jsonc
{
  "feishu": {
    "appId": "${FEISHU_APP_ID}",
    "appSecret": "${FEISHU_APP_SECRET}"
  },
  "qq": {
    "appId": "${QQ_APP_ID}",
    "secret": "${QQ_SECRET}"
  },
  "wechat": {
    "enabled": true
  },
  "dingtalk": {
    "appKey": "${DINGTALK_APP_KEY}",
    "appSecret": "${DINGTALK_APP_SECRET}"
  },
  "defaultAgent": "build"
}
```

---

## 项目结构

```
src/
├── index.ts           # 入口，9 阶段启动
├── channel/           # 渠道插件（飞书、QQ、微信、钉钉）
├── handler/           # 消息处理层
├── streaming/         # 流式输出层
├── session/           # Session 管理
├── feishu/            # 飞书底层模块
├── scheduled-task/    # 定时任务
├── cron/              # 心跳服务
└── utils/             # 工具函数
```

## 开发

```bash
bun run dev          # 开发模式
bun run start        # 生产模式
bun run test:run     # 运行测试
```

---

## License

[MIT](LICENSE)
