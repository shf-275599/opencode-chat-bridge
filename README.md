# opencode-im-bridge-slim

> 将飞书 / QQ / 微信机器人与 opencode TUI session 打通，实现双向实时消息转发。

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## 功能特性

- **实时桥接** — IM 消息即时出现在 opencode TUI，agent 回复以动态卡片形式推送回 IM。支持 **Markdown 格式渲染**（标题、列表、代码块）
- **多渠道支持** — 飞书、QQ、微信，统一插件架构，`ChannelPlugin` 接口设计
- **交互式卡片** — Agent 的提问和权限请求以可点击卡片呈现，直接在聊天中回答或审批（飞书支持）
- **SSE 流式输出** — 订阅 opencode SSE 事件流，实时更新回复内容（飞书支持 CardKit v2 流式卡片）
- **文件与图片** — 支持图片、文档、音频、视频消息的收发，带路径安全检查，50MB 下载限制，100MB 上传限制
- **文件自动发送** — Agent 将文件保存到 attachments 目录后，系统通过 snapshot 机制自动检测并发送给用户
- **定时任务** — 自然语言创建周期性任务（`/cron 每天19:00提醒我吃饭`），自动执行并回传结果
- **多账号管理** — 支持多个飞书应用并行运行，通过 `--config` 或 `OPENCODE_IM_CONFIG` 切换
- **Session 自动发现** — 自动发现并绑定当前目录的最新 TUI session，重启后映射关系 SQLite 持久保存
- **优雅重连** — 启动时指数退避重连 opencode server，最多重试 10 次

---

## 支持的平台

### 平台对比

| 维度 | 飞书 | QQ | 微信 |
|------|------|----|----|
| **连接协议** | WebSocket (SDK) | WebSocket (SDK) | HTTP 长轮询 (SDK) |
| **认证方式** | App ID + Secret | App ID + Secret | **QR 码扫码登录** |
| **流式输出** | ✅ CardKit v2 流式卡片 | ❌ 累积后一次发送 | ❌ 累积后一次发送 |
| **文件收发** | ✅ 图/文/音/视 | ✅ 两步上传 | ✅ CDN 加密上传 |
| **交互卡片** | ✅ 按钮交互 | ❌ 纯文本 | ❌ 纯文本 |
| **群聊支持** | ✅ @提及过滤 | ❌ 仅 C2C | ❌ 仅 C2C |
| **消息去重** | ✅ SQLite 去重 | ❌ | ❌ |
| **思考中指示** | ✅ 表情反应 + 输入态 | ❌ | ✅ 正在输入 |

---

## 快速开始

### 前置要求

- **[Bun](https://bun.sh)**（必需，项目使用 `bun:sqlite`）
- **[opencode](https://opencode.ai)** 已安装
- 至少一个平台的机器人凭证（参见下方各平台配置步骤）

### 安装与启动

项目支持两种运行方式：**全局安装** 或 **从源码运行**。

#### 方式一：全局安装（推荐）

```bash
npm install -g opencode-im-bridge-slim
```

启动时只需一个命令，配置通过环境变量或交互式向导完成：

```bash
# 第一次运行（交互式配置向导）
opencode-im-bridge-slim

# 指定配置文件（多账号切换）
opencode-im-bridge-slim --config cli_xxxxxxxx

# 重新运行配置向导
opencode-im-bridge-slim init
```

#### 方式二：从源码运行

```bash
git clone https://github.com/ET06731/opencode-im-bridge-slim.git
cd opencode-im-bridge-slim
bun install
```

启动前需要先设置环境变量（或使用交互式向导自动创建 `.env` 文件）：

```bash
# 设置凭证
export FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
export FEISHU_APP_SECRET=your_app_secret_here

# 启动（开发模式，热重载）
bun run dev

# 或启动（生产模式）
bun run start
```

> `dev` 与 `start` 的功能完全相同，唯一区别是 `dev` 加了 `bun --watch`，代码改动后自动重启进程，适合本地调试。生产环境建议用 `start` 或配合 PM2 管理进程。使用 `bun run test:run` 而非 `bun test`，后者会同时扫描 `src/` 和 `dist/` 下的测试文件。

首次从源码运行时如果没有配置任何环境变量，也会启动交互式配置向导。

#### 每次运行都需要两个进程

**终端 1 — opencode server：**

```bash
# macOS / Linux
OPENCODE_SERVER_PORT=4096 opencode serve

# Windows (PowerShell)
$env:OPENCODE_SERVER_PORT=4096; opencode serve
```

**终端 2 — bridge：**

```bash
opencode-im-bridge-slim
# 或从源码：cd opencode-im-bridge-slim && bun run dev
```

> 两者**启动顺序无关**（bridge 有指数退避重连，最多重试 10 次），但都必须在运行状态。

#### 验证启动成功

bridge 启动成功后，日志中应出现：

```
[feishu-api] Token refreshed, expires in 7200s
[feishu-ws] Feishu WebSocket client started
opencode-im-bridge-slim started — channels active
```

然后发送测试消息（见下方）。

#### 多账号管理

如果管理多个飞书应用，在 `config/` 目录下创建 `.env.{appId}` 文件：

```bash
# 配置账号 A
# 文件：config/.env.cli_abc123
FEISHU_APP_ID=cli_abc123
FEISHU_APP_SECRET=secret_a

# 配置账号 B
# 文件：config/.env.cli_def456
FEISHU_APP_ID=cli_def456
FEISHU_APP_SECRET=secret_b
```

启动时选择：

```bash
# 自动列出所有配置，交互式选择
opencode-im-bridge-slim

# 或直接指定
opencode-im-bridge-slim --config cli_abc123

# 或通过环境变量指定
OPENCODE_IM_CONFIG=cli_abc123 opencode-im-bridge-slim
```

### 发送测试消息

向机器人发送任意消息。首次联系时自动发现最新 TUI session 并回复：

> 已连接 session: ses_xxxxx

要在 TUI 中查看该会话（终端 3）：

```bash
opencode attach http://127.0.0.1:4096 --session {session_id}
```

`session_id` 会在 bridge 启动日志中显示。

---

## 命令参考

在聊天窗口中输入斜杠命令可直接进行会话管理：

### 会话管理

| 命令 | 说明 | 示例 |
|------|------|------|
| `/new` | 新建 opencode 会话并绑定到当前聊天 | `/new` |
| `/sessions` | 列出最近的 TUI 会话（飞书返回交互式卡片，其他返回文本） | `/sessions` |
| `/connect {id}` | 绑定当前聊天到指定会话 | `/connect ses_abc123` |
| `/abort` | 中止 Agent 当前任务 | `/abort` |

### 状态与管理

| 命令 | 说明 | 示例 |
|------|------|------|
| `/help` 或 `/` | 显示帮助菜单（飞书返回交互式卡片） | `/help` |
| `/status` | 查看服务器状态和当前会话信息（含 Context 用量） | `/status` |
| `/share` | 生成当前会话的分享链接 | `/share` |
| `/compact` | 强制压缩上下文历史 | `/compact` |
| `/agent {name}` | 切换 Agent（飞书返回交互式卡片） | `/agent build` |
| `/models {id}` | 切换模型（飞书返回交互式卡片，支持下拉菜单翻页） | `/models anthropic/claude-sonnet-4` |
| `/variants {id}` | 切换模型变体 | `/variants turbo` |
| `/projects {name}` | 切换项目 | `/projects my-project` |
| `/rename {name}` | 重命名当前会话 | `/rename 新名称` |
| `/unshare` | 取消分享当前会话 | `/unshare` |

### 定时任务

| 命令 | 说明 | 示例 |
|------|------|------|
| `/cron` 或 `/cron list` | 查看定时任务列表 | `/cron` |
| `/cron {自然语言}` | 自然语言创建定时任务 | `/cron 每天19:00提醒我吃饭` |
| `/cron add` | 启动交互式任务创建向导 | `/cron add` |
| `/cron remove {id}` | 删除指定任务（飞书返回交互式卡片） | `/cron remove abc1234` |

### 平台差异

| 平台 | 命令返回形式 |
|------|-------------|
| **飞书** | 交互式卡片，支持点击按钮操作 |
| **QQ** | 纯文本 Markdown 格式 |
| **微信** | 纯文本格式 |

---

## 平台配置详细步骤

---

### 飞书配置

飞书是功能最完整的平台，支持流式卡片、交互按钮和多媒体收发。

#### 第一步：创建企业自建应用

1. 打开 [飞书开放平台](https://open.feishu.cn/app)
2. 点击**创建应用** → **创建企业自建应用**
3. 填写应用名称（例如 "opencode-bridge"）和描述后，点击**确认创建**
4. 创建完成后你会进入应用详情页

#### 第二步：获取凭证

1. 在左侧菜单点击**凭证与基础信息**
2. 找到以下两个值并记下：
   - **App ID** — 通常以 `cli_` 开头，例如 `cli_a1234567890abcdef`
   - **App Secret** — 点击「显示」获取，例如 `ABCDefgh1234567890`
3. 这两个值对应环境变量 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`

#### 第三步：开启机器人能力

1. 在左侧菜单点击**应用功能 → 机器人**
2. 点击**开启**机器人能力
3. 可以自定义机器人名称、头像和描述（这些会在飞书聊天中显示）

#### 第四步：配置权限

1. 在左侧菜单点击**开发配置 → 权限管理**
2. 你需要申请以下权限。点击**批量导入/导出 → 导入**，粘贴以下 JSON 可以一次性导入：

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

3. 如果批量导入不可用，手动搜索并开通以下权限：

| 权限名称 | 权限标识 | 用途 | 必需 |
|----------|----------|------|------|
| 获取与发送单聊、群组消息 | `im:message` | 发送消息、更新卡片 | ✅ |
| 获取用户发给机器人的单聊消息 | `im:message.p2p_msg:readonly` | 接收私聊消息 | ✅ |
| 获取群组中所有消息 | `im:message.group_msg` | 接收群聊中的所有消息（用于监听 @提及） | ✅ |
| 获取群组中 @机器人的消息 | `im:message.group_at_msg:readonly` | 接收群聊中 @机器人的消息 | ✅ |
| 获取与上传图片或文件资源 | `im:resource` | 下载用户发送的图片和文件 | ✅ |
| 创建并发布卡片 | `cardkit:card:write` | 渲染流式卡片和交互式卡片 | ✅ |

4. 所有权限状态变为「已开通」后，点击右上角的**批量开通**（如果飞书版本显示此按钮）
5. 权限开通后需要**管理员审批**，联系企业管理员在飞书管理后台通过你的权限申请

#### 第五步：启动 opencode-im-bridge-slim（必须在配置事件订阅之前）

⚠️ **重要：飞书要求在保存长连接配置之前，应用必须已在运行。**

1. 先在一个终端启动 opencode server：

```bash
OPENCODE_SERVER_PORT=4096 opencode serve
```

2. 在另一个终端启动 opencode-im-bridge-slim：

```bash
# 设置环境变量
export FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
export FEISHU_APP_SECRET=your_app_secret_here

# 启动
opencode-im-bridge-slim
```

3. 确认日志中出现类似内容：

```
[feishu-api] Token refreshed, expires in 7200s
[feishu-ws] Starting Feishu WebSocket connection...
[feishu-ws] Feishu WebSocket client started
```

**保持 bridge 运行状态，然后继续下一步。**

#### 第六步：订阅事件（WebSocket 长连接模式）

1. 在飞书开放平台，进入左侧菜单**开发配置 → 事件订阅**
2. 在**请求网址**处，选择**长连接**模式（无需公网 IP，bridge 会主动连接飞书服务器）
3. 在**添加事件**处，搜索并添加：

| 事件名称 | 事件标识 | 用途 |
|----------|----------|------|
| 接收消息 | `im.message.receive_v1` | 接收用户发送的所有消息 |

4. 点击**保存**
5. 如果提示"应用未建立长连接"，说明 bridge 还未启动或连接丢失，回到第五步确认 bridge 正在运行

#### 第七步：订阅回调（交互式卡片必须）

⚠️ **这是最关键的一步。不配置回调订阅，交互式卡片（提问、权限审批）将无法点击，飞书会报错 `200340`。**

事件订阅和回调订阅是**两个独立的配置项**，必须**分别配置**。

1. 在飞书开放平台，进入左侧菜单**开发配置 → 事件与回调 → 回调订阅**
2. 选择**长连接**模式
3. 添加以下回调：

| 回调名称 | 回调标识 | 用途 |
|----------|----------|------|
| 卡片回传交互 | `card.action.trigger` | 接收卡片按钮点击事件（提问回答、权限审批） |

4. 点击**保存**

#### 第八步：发布应用

1. 在左侧菜单点击**应用发布 → 版本管理与发布**
2. 点击**创建版本**
3. 填写版本号（如 `1.0.0`）和更新说明，点击**保存**
4. 点击**申请线上发布**
5. 审批通过后，应用状态变为「已发布」

> **提示**：如果只是自己测试，应用管理员可以直接使用，无需等待审核。在飞书客户端搜索你的应用名称，即可发起私聊测试。

#### 第九步：验证配置

1. 在飞书中搜索你的机器人名称，发起私聊
2. 发送一条测试消息（如"你好"）
3. 你应该收到回复：`已连接 session: ses_xxxxx`
4. 再发送一条消息，应该能收到 AI 的回复

#### 故障排除

| 现象 | 可能原因 | 解决方案 |
|------|----------|----------|
| 机器人收不到消息 | 未开启长连接或事件未订阅 | 检查事件订阅，确认选择长连接模式，确认 `im.message.receive_v1` 已添加 |
| 凭证错误 | `.env` 中凭证有误 | 重新确认 App ID 和 App Secret，注意不要有多余空格 |
| 收到消息但无回复 | opencode server 未启动 | 确保先启动：`OPENCODE_SERVER_PORT=4096 opencode serve` |
| 卡片不实时更新 | 正常行为 | 防抖处理避免触发飞书频率限制 |
| 点击卡片按钮报错 `200340` | 回调订阅未配置 | 进入**回调订阅** → 选择长连接 → 添加 `card.action.trigger`（见第七步） |
| 保存长连接模式时报"应用未建立长连接" | bridge 未启动 | 先完成第五步启动 bridge，再回飞书保存设置 |
| 权限不足报错 | 权限未申请或未审批 | 检查第四步中所有权限是否已开通并审批 |
| 群聊中机器人不回复 | 未 @提及机器人 或 botOpenId 获取失败 | 在群聊中发送消息时必须 @机器人；检查启动日志确认 botOpenId 已获取 |

---

### QQ 配置

QQ 机器人通过 WebSocket 连接，支持 Markdown 消息、文件和 C2C 私聊。

#### 第一步：创建 QQ 机器人

1. 访问 [QQ 开放平台](https://q.qq.com/bot/#/home)
2. 登录后点击**创建机器人**
3. 填写机器人名称、头像、简介等信息
4. 创建成功后进入机器人详情页

#### 第二步：获取凭证

1. 在机器人详情页，点击**开发设置**
2. 找到以下信息：
   - **App ID（机器人 ID）** — 例如 `102xxxxxx`
   - **App Secret（机器人密钥）** — 点击「查看」获取
3. 这两个值对应环境变量 `QQ_APP_ID` 和 `QQ_SECRET`

#### 第三步：配置 WebSocket 连接

1. 在**开发设置**页面，找到**连接模式**
2. 选择 **WebSocket** 模式
3. 配置以下参数：
   - **消息接收 URL** — 留空（WebSocket 模式不需要）
   - **WebSocket 地址** — 使用默认值

#### 第四步：配置权限和事件

1. 在**开发设置**页面，找到**事件订阅**
2. 确保以下事件已开启：
   - **C2C 消息事件** — `C2C_MESSAGE_CREATE`（私聊消息）
3. 在**权限管理**页面确认以下权限：
   - 消息收发权限
   - 文件上传权限

#### 第五步：配置沙箱模式（可选）

- QQ 开放平台支持**沙箱模式**：在沙箱中测试无需审核，但只有添加的测试人员可以使用
- 如果不需要沙箱，确保你的机器人已提交审核并通过

#### 第六步：配置环境变量并启动

```bash
export QQ_APP_ID=你的QQ_APP_ID
export QQ_SECRET=你的QQ_SECRET

# 可选：启用沙箱模式
export QQ_SANDBOX=true

opencode-im-bridge-slim
```

启动成功后日志中会出现：
```
[QQPlugin] QQ Gateway received message from xxx
[QQPlugin] Installed WebSocket invalid-session hotfix
```

#### 第七步：测试验证

1. 使用配置了测试权限的 QQ 号
2. 向机器人发送一条私聊消息（如"你好"）
3. 应该收到绑定通知和 AI 回复

#### QQ 平台限制

- QQ 仅支持 **C2C 私聊**，不支持群聊
- QQ 文件发送因平台限制，文件名会被修改，发送后会自动提示原始文件名
- 消息格式为 Markdown（不支持交互式卡片）
- QQ 不支持流式输出，AI 回复会等全部生成完毕后一次性发送

---

### 微信配置

微信使用腾讯官方 iLink Bot API，通过**扫码登录**认证，无需申请 App ID 和 Secret。

#### 第一步：前置条件

- 微信版本需支持 **ClawBot 插件**（在微信设置中查找）
- opencode-im-bridge-slim 运行在可访问互联网的环境中

#### 第二步：启用微信渠道

**方式一：环境变量**

```bash
export WECHAT_ENABLED=true
# 可选：指定登录态保存路径（默认 ./data/wechat-session.json）
export WECHAT_SESSION_FILE=./data/wechat-session.json
```

**方式二：JSONC 配置文件**

编辑 `config/opencode-im.jsonc`：

```jsonc
{
  "wechat": {
    "enabled": true,
    "sessionFile": "./data/wechat-session.json"
  }
}
```

#### 第三步：启动并扫码登录

1. 先启动 opencode server：

```bash
OPENCODE_SERVER_PORT=4096 opencode serve
```

2. 启动 opencode-im-bridge-slim：

```bash
opencode-im-bridge-slim
```

3. 终端中会显示二维码链接：

```
[WechatPlugin] QR Code URL: https://ilinkai.weixin.qq.com/...
```

4. 在微信中操作：
   - 打开微信 → 设置 → **ClawBot**
   - 点击**连接**
   - 扫描终端中的二维码（或将 URL 复制到浏览器中查看二维码）
   - 点击确认登录

5. 登录成功后日志中会出现：

```
[WechatPlugin] Login successful
[WechatPlugin] Message polling started
```

6. 登录态会自动保存到 `wechat-session.json`，下次启动会自动恢复，无需重复扫码

#### 第四步：测试验证

1. 在微信中向机器人发送一条消息（如"你好"）
2. 应该收到绑定通知和 AI 回复
3. 后续消息即可双向交互

#### 微信平台特性

- 使用 HTTP 长轮询（35秒超时）接收消息
- `context_token` 用于消息关联和回复，bridge 自动处理
- 支持文本、图片、语音（带文字识别）、文件
- 支持「正在输入」状态指示
- 群聊支持需额外配置

#### 注意事项

- 登录态有效期受腾讯政策限制，过期后需重新扫码
- 机器人仅能响应 C2C 私聊
- 微信不支持交互式卡片，所有回复为纯文本格式
- 如果二维码扫描异常，可直接访问控制台打印的 URL 链接完成绑定

---

---

## 配置说明

### 环境变量

#### 基础配置

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `OPENCODE_SERVER_URL` | 否 | `http://localhost:4096` | opencode server 地址 |
| `OPENCODE_CWD` | 否 | `process.cwd()` | Session 自动发现的工作目录 |
| `OPENCODE_DEFAULT_AGENT` | 否 | `build` | 默认 Agent 名称 |

#### 飞书

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `FEISHU_APP_ID` | 是* | | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 是* | | 飞书应用 App Secret |
| `FEISHU_WEBHOOK_PORT` | 否 | `3001` | HTTP webhook 回退端口 |
| `FEISHU_VERIFICATION_TOKEN` | 否 | | 事件订阅验证 Token |
| `FEISHU_ENCRYPT_KEY` | 否 | | 事件加密密钥 |

#### QQ

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `QQ_APP_ID` | 是* | | QQ 机器人 App ID |
| `QQ_SECRET` | 是* | | QQ 机器人 App Secret |
| `QQ_SANDBOX` | 否 | `false` | 是否启用沙箱模式 |

#### 微信

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `WECHAT_ENABLED` | 是* | | 设为 `true` 启用微信 |
| `WECHAT_SESSION_FILE` | 否 | `./data/wechat-session.json` | 登录态保存路径 |

> \* 至少需要配置一个渠道。

### JSONC 配置文件

复制模板并创建 `config/opencode-im.jsonc`：

```bash
cp config/opencode-im.example.jsonc config/opencode-im.jsonc
```

编辑配置文件：

```jsonc
{
  "feishu": {
    "appId": "${FEISHU_APP_ID}",
    "appSecret": "${FEISHU_APP_SECRET}",
    "verificationToken": "${FEISHU_VERIFICATION_TOKEN}",
    "webhookPort": 3001,
    "encryptKey": "${FEISHU_ENCRYPT_KEY}"
  },
  "qq": {
    "appId": "${QQ_APP_ID}",
    "secret": "${QQ_SECRET}",
    "sandbox": false
  },
  "wechat": {
    "enabled": true,
    "sessionFile": "./data/wechat-session.json"
  },
  "defaultAgent": "build",
  "dataDir": "./data",
  "progress": {
    "debounceMs": 500,
    "maxDebounceMs": 3000
  },
  "messageDebounceMs": 10000
}
```

支持 `${ENV_VAR}` 环境变量插值和 `//` 注释。配置文件在项目内 `config/` 目录统一管理。

---

## Bot 行为规范

### 响应逻辑

- **默认模式**：机器人表现为 opencode 的影子，所有输入被视为在 TUI 中键入
- **自动绑定**：机器人会「接续」最近的 TUI 活动，减少配置负担
- **上下文隔离**：每个聊天 Thread 拥有独立记忆，互不干扰（除非显式绑定同一 Session）
- **首次上下文注入**：每个 session 首次消息会注入平台上下文签名，告知 AI 文件保存路径和定时任务功能

### 交互原则

- **流式优先**：始终尝试展示即时的文字流（飞书 CardKit v2）
- **可见的工具调用**：Agent 使用工具时有明确的 UI 反馈（飞书卡片中的工具状态）
- **格式友好**：默认渲染 Markdown，代码块和列表排版自然

### 超时处理

| 场景 | 超时 | 处理方式 |
|------|------|----------|
| SSE 首次事件 | 5 分钟 | 回退到同步响应 |
| SSE 连接断开 | 30 秒 | 指数退避重连（1s → 2s → 4s ... → 30s） |
| 文件下载 | 50MB 上限 | 超额直接拒绝 |
| 文件上传 | 100MB 上限 | 超额跳过并通知用户 |
| 消息去重 TTL | 60 秒 | SQLite 存储，30 秒清理一次 |

---

## 项目结构

```
config/                 # 用户配置文件（凭证、渠道、调度等）
├── opencode-im.jsonc   # 主配置（从 .example.jsonc 复制）
├── .env.example        # 环境变量模板
└── .env.bot            # 首次运行向导生成的凭证文件
src/
├── index.ts            # 入口，9 阶段启动 + 优雅关闭
├── types.ts            # 共享类型定义
├── channel/            # 渠道插件（飞书、QQ、微信）+ 统一接口
│   ├── types.ts        # ChannelPlugin 核心契约
│   ├── manager.ts      # ChannelManager 注册/启动/停止
│   ├── base-plugin.ts  # BaseChannelPlugin 抽象基类
│   └── feishu|qq|wechat/  # 各平台插件实现
├── handler/            # 消息处理（去重→路由→POST→流式桥接）
│   ├── message-handler.ts      # 核心入站管道
│   ├── command-handler.ts      # 斜杠命令处理
│   ├── streaming-integration.ts # SSE→CardKit 流式桥接
│   ├── interactive-handler.ts  # 交互卡片处理
│   ├── interactive-poller.ts   # 交互式轮询器
│   ├── outbound-media.ts       # 出站媒体检测和上传
│   └── message-debounce.ts     # 消息防抖缓冲区
├── streaming/          # SSE 事件解析 + 流式卡片 + 子代理追踪
│   ├── event-processor.ts     # SSE 事件→类型化 Action
│   ├── session-observer.ts    # Session 观察器
│   ├── streaming-card.ts      # CardKit v2 流式卡片会话
│   ├── subagent-tracker.ts    # 子 Agent REST API 追踪
│   └── subagent-card.ts       # 子 Agent 卡片
├── session/            # Session 自动发现 + SQLite 持久化
│   ├── session-manager.ts     # Thread→Session 映射管理
│   └── progress-tracker.ts    # 进度卡片管理
├── feishu/             # 飞书底层模块（API、WebSocket、CardKit）
│   ├── api-client.ts          # REST API（Token 自动刷新）
│   ├── ws-client.ts           # WebSocket 长连接
│   ├── cardkit-client.ts      # CardKit v2 客户端
│   ├── card-builder.ts        # 卡片构建器
│   ├── message-dedup.ts       # SQLite 消息去重
│   └── webhook-server.ts      # HTTP Webhook 服务
├── scheduled-task/     # 自然语言定时任务（LLM 解析 + CronJob 执行）
│   ├── runtime.ts             # 定时任务运行时
│   ├── executor.ts            # 任务执行器
│   ├── store.ts               # JSON 文件持久化
│   ├── creation-manager.ts    # 创建状态机
│   ├── llm-schedule-parser.ts # LLM 自然语言解析
│   ├── schedule-parser.ts     # 正则+中文调度解析
│   └── display.ts             # 任务卡片/文本展示
├── cron/               # 心跳探针服务
├── cli/                # CLI 交互式向导
├── i18n/               # 国际化（中文/英文）
└── utils/              # 配置、日志、数据库、事件监听器
```

## 开发

```bash
bun install            # 安装依赖
bun run dev            # 开发模式（文件监听，修改代码自动重启）
bun run start          # 生产模式（直接运行，无监听，省资源）
bun run test:run       # 运行测试
bun run build          # 编译 TypeScript
```

---

## License

[MIT](LICENSE)
