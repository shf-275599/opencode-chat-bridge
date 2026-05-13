# opencode-im-bridge

> 将飞书 / QQ / 微信 / 钉钉机器人与 opencode 打通，实现双向实时消息转发。

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## 功能特性

- **实时桥接** — IM 消息即时出现在 opencode，agent 回复以动态卡片形式推送回 IM
- **多渠道支持** — 飞书、QQ、微信、钉钉，统一插件架构
- **交互式卡片** — Agent 的提问和权限请求以可点击卡片呈现，直接在聊天中回答或审批
- **SSE 流式输出** — 订阅 opencode SSE 事件流，实时更新回复内容（飞书支持 CardKit v2 流式卡片）
- **文件与图片** — 支持图片、文档、音频、视频消息的收发，带路径安全检查
- **定时任务** — 自然语言创建周期性任务（`/cron 每天19:00提醒我吃饭`），自动执行并回传结果
- **多账号管理** — 支持多个飞书应用并行运行，通过 `--config` 或 `OPENCODE_IM_CONFIG` 切换

---

## 支持的平台

### 平台对比

| 维度 | 飞书 | QQ | 微信 | 钉钉 |
|------|------|----|----|------|
| **连接协议** | WebSocket (SDK) | WebSocket (SDK) | HTTP 长轮询 (SDK) | HTTP 长轮询 |
| **认证方式** | App ID + Secret | App ID + Secret | **QR 码扫码登录** | App Key + Secret |
| **流式输出** | ✅ CardKit v2 流式卡片 | ❌ 累积后一次发送 | ❌ 累积后一次发送 | ⚠️ 基础流式 |
| **文件收发** | ✅ 图/文/音/视 | ✅ 两步上传 | ✅ CDN 加密上传 | ✅ 多媒体上传 |
| **交互卡片** | ✅ 按钮交互 | ❌ 纯文本 | ❌ 纯文本 | ⚠️ 基础卡片 |
| **群聊支持** | ✅ @提及过滤 | ❌ 仅 C2C | ❌ 仅 C2C | ❌ 仅 C2C |
| **消息去重** | ✅ SQLite 去重 | ❌ | ❌ | ❌ |
| **思考中指示** | ✅ 表情反应 + 输入态 | ❌ | ✅ 正在输入 | ❌ |

### 平台操作流程

#### 飞书

1. 在 [飞书开放平台](https://open.feishu.cn/) 创建企业自建应用
2. 获取 **App ID** 和 **App Secret**，开启机器人能力
3. 配置事件订阅（推荐 WebSocket 模式，无需公网 URL）
4. 申请权限：`im:message`、`im:message.p2p_msg:readonly`、`im:message.group_msg`、`im:message.group_at_msg:readonly`
5. 发布应用，配置环境变量后启动 bridge

#### QQ

1. 在 [QQ 开放平台](https://q.qq.com/) 创建机器人应用
2. 配置 **App ID** 和 **App Secret**，开启 WebSocket 连接模式
3. 订阅 C2C 消息事件，配置环境变量后启动 bridge
4. bridge 启动后自动建立 WebSocket 长连接

#### 微信

1. 配置环境变量 `WECHAT_ENABLED=true`
2. 首次运行时会弹出二维码，用 **微信扫码确认登录**
3. 登录态自动保存到 `wechat-session.json`，后续启动自动恢复
4. 微信要求每次回复携带 `context_token`，bridge 自动处理

#### 钉钉

1. 在 [钉钉开放平台](https://open.dingtalk.com/) 创建机器人应用
2. 获取 **App Key** 和 **App Secret**
3. 开启消息接收模式（HTTP 长轮询），配置环境变量后启动 bridge
4. bridge 通过 HTTP 长轮询接收和发送消息

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
```

或从源码运行：

```bash
git clone https://github.com/ET06731/opencode-im-bridge.git
cd opencode-im-bridge
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

> 如需重新配置：`opencode-im-bridge init`
> 多账号切换：`opencode-im-bridge --config cli_xxxxxxxx`

---

## 配置说明

### 环境变量

#### 基础配置

| 变量名 | 必需 | 默认值 | 说明 |
|---|---|---|---|
| `OPENCODE_SERVER_URL` | 否 | `http://localhost:4096` | opencode server 地址 |
| `OPENCODE_CWD` | 否 | `process.cwd()` | Session 自动发现的工作目录 |

#### 飞书

| 变量名 | 必需 | 说明 |
|---|---|---|
| `FEISHU_APP_ID` | 是* | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 是* | 飞书应用 App Secret |
| `FEISHU_WEBHOOK_PORT` | 否 | Webhook 端口（默认 3001） |

#### QQ

| 变量名 | 必需 | 说明 |
|---|---|---|
| `QQ_APP_ID` | 是* | QQ 机器人 App ID |
| `QQ_SECRET` | 是* | QQ 机器人 App Secret |

#### 微信

| 变量名 | 必需 | 说明 |
|---|---|---|
| `WECHAT_ENABLED` | 是* | 设为 `true` 启用微信 |

#### 钉钉

| 变量名 | 必需 | 说明 |
|---|---|---|
| `DINGTALK_APP_KEY` | 是* | 钉钉应用 App Key |
| `DINGTALK_APP_SECRET` | 是* | 钉钉应用 App Secret |

> \* 至少需要配置一个渠道。

### JSONC 配置文件

复制模板并创建 `config/opencode-im.jsonc`：

```bash
cp config/opencode-im.example.jsonc config/opencode-im.jsonc
```

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

支持 `${ENV_VAR}` 环境变量插值和 `//` 注释。配置文件在项目内 `config/` 目录统一管理。

---

## 命令参考

### 会话管理

| 命令 | 说明 | 示例 |
|------|------|------|
| `/new` | 新建 opencode 会话并绑定到当前聊天 | `/new` |
| `/sessions` | 列出最近的 TUI 会话 | `/sessions` |
| `/connect {id}` | 绑定当前聊天到指定会话 | `/connect ses_abc123` |
| `/abort` | 中止 Agent 当前任务 | `/abort` |

### 状态与管理

| 命令 | 说明 | 示例 |
|------|------|------|
| `/help` | 显示帮助菜单 | `/help` |
| `/status` | 查看服务器状态和当前会话信息 | `/status` |
| `/share` | 生成当前会话的分享链接 | `/share` |
| `/compact` | 强制压缩上下文历史 | `/compact` |
| `/agent {name}` | 切换 Agent | `/agent build` |
| `/models {id}` | 切换模型 | `/models anthropic/claude-sonnet-4` |
| `/projects {name}` | 切换项目 | `/projects my-project` |
| `/rename {name}` | 重命名当前会话 | `/rename 新名称` |

### 定时任务

| 命令 | 说明 | 示例 |
|------|------|------|
| `/cron` | 查看定时任务列表 | `/cron` |
| `/cron add` | 启动交互式任务创建向导 | `/cron add` |
| `/cron {自然语言}` | 自然语言创建定时任务 | `/cron 每天19:00提醒我吃饭` |
| `/cron remove {id}` | 删除指定任务 | `/cron remove abc1234` |

### 平台差异

| 平台 | 命令返回形式 |
|------|-------------|
| **飞书** | 交互式卡片，支持点击按钮操作 |
| **QQ** | 纯文本 Markdown 格式 |
| **微信** | 纯文本格式 |
| **钉钉** | 纯文本格式 |

---

## Bot 行为规范

### 响应逻辑

- **默认模式**：机器人表现为 opencode 的影子，所有输入被视为在 TUI 中键入
- **自动绑定**：机器人会「接续」最近的 TUI 活动，减少配置负担
- **上下文隔离**：每个聊天 Thread 拥有独立记忆，互不干扰（除非显式绑定同一 Session）

### 交互原则

- **流式优先**：始终尝试展示即时的文字流
- **可见的工具调用**：Agent 使用工具时有明确的 UI 反馈
- **格式友好**：默认渲染 Markdown，代码块和列表排版自然

### 设计约束

- **文件大小**：附件下载最大 50MB，上传最大 100MB
- **超时处理**：SSE 连接默认 5 分钟超时，超时后自动进入空闲状态或上报错误

---

## 项目结构

```
config/                 # 用户配置文件（凭证、渠道、调度等）
├── opencode-im.jsonc   # 主配置（从 .example.jsonc 复制）
├── .env.example        # 环境变量模板
└── .env.bot            # 首次运行向导生成的凭证文件
src/
├── index.ts           # 入口，9 阶段启动 + 优雅关闭
├── channel/           # 渠道插件（飞书、QQ、微信、钉钉）+ 统一接口
├── handler/           # 消息处理（去重→路由→POST→流式桥接）
├── streaming/         # SSE 事件解析 + 流式卡片 + 子代理追踪
├── session/           # Session 自动发现 + SQLite 持久化
├── feishu/            # 飞书底层模块（API、WebSocket、CardKit）
├── scheduled-task/    # 自然语言定时任务（LLM 解析 + CronJob 执行）
├── cron/              # 心跳探针服务
└── utils/             # 配置、日志、数据库、事件监听器
```

## 开发

```bash
bun install            # 安装依赖
bun run dev            # 开发模式（热重载）
bun run start          # 生产模式
bun run test:run       # 运行测试
bun run build          # 编译 TypeScript
```

---

## License

[MIT](LICENSE)
