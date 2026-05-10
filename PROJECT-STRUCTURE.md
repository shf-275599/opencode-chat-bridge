# opencode-im-bridge 项目结构

```
opencode-im-bridge/
├── 📄 入口与配置
│   ├── package.json              # 项目依赖与脚本
│   ├── tsconfig.json             # TypeScript 配置
│   ├── vitest.config.ts          # 测试配置
│   ├── start.sh                  # 一体化启动脚本
│   └── opencode-im.jsonc         # 主配置文件
│
├── 📂 src/                       # 源码目录
│   │
│   ├── 📄 核心文件
│   │   ├── index.ts              # 入口：9阶段启动 + 优雅关闭
│   │   └── types.ts              # 共享类型定义
│   │
│   ├── 📂 channel/               # 📡 渠道插件层（6个平台）
│   │   ├── types.ts              # ChannelPlugin 接口定义
│   │   ├── manager.ts            # 插件管理器
│   │   ├── base-plugin.ts        # 抽象基类
│   │   │
│   │   ├── 📂 feishu/            # 飞书
│   │   │   ├── feishu-plugin.ts  # 插件实现
│   │   │   └── index.ts
│   │   │
│   │   ├── 📂 wechat/            # 微信
│   │   │   ├── wechat-plugin.ts  # 插件实现
│   │   │   ├── auth.ts           # 扫码登录
│   │   │   ├── client.ts         # iLink API 客户端
│   │   │   ├── types.ts          # 类型定义
│   │   │   └── index.ts
│   │   │
│   │   ├── 📂 qq/                # QQ
│   │   │   ├── qq-plugin.ts      # 插件实现
│   │   │   ├── qq-api-client.ts  # API 客户端
│   │   │   └── index.ts
│   │   │
│   │   ├── 📂 telegram/          # Telegram
│   │   │   ├── telegram-plugin.ts      # 插件实现
│   │   │   ├── telegram-interactive.ts # 交互卡片
│   │   │   └── index.ts
│   │   │
│   │   ├── 📂 discord/           # Discord
│   │   │   ├── discord-plugin.ts # 插件实现
│   │   │   └── index.ts
│   │   │
│   │   ├── 📂 dingtalk/          # 钉钉
│   │   │   ├── dingtalk-plugin.ts # 插件实现
│   │   │   ├── api-client.ts     # API 客户端
│   │   │   ├── types.ts          # 类型定义
│   │   │   └── index.ts
│   │   │
│   │   └── 📂 mock/              # Mock（测试用）
│   │       └── mock-plugin.ts
│   │
│   ├── 📂 handler/               # 🔄 消息处理层
│   │   ├── message-handler.ts     # 入站管道（去重→路由→POST）
│   │   ├── streaming-integration.ts # SSE → IM 流式桥接
│   │   ├── command-handler.ts     # 斜杠命令（/new, /model 等）
│   │   ├── interactive-handler.ts # 交互卡片动作处理
│   │   ├── interactive-poller.ts  # 交互轮询降级
│   │   ├── outbound-media.ts     # 文件路径检测+上传
│   │   └── message-debounce.ts   # 消息防抖（图片+文字合并）
│   │
│   ├── 📂 streaming/             # 📊 流式处理层
│   │   ├── event-processor.ts     # SSE 事件解析器
│   │   ├── session-observer.ts    # Session 观察者
│   │   ├── subagent-tracker.ts    # Sub-Agent 生命周期追踪
│   │   ├── subagent-card.ts       # Sub-Agent 卡片构建
│   │   └── streaming-card.ts      # 流式卡片管理
│   │
│   ├── 📂 session/               # 🗂️ Session 管理层
│   │   ├── session-manager.ts     # 自动发现、映射持久化
│   │   └── progress-tracker.ts    # 进度追踪（思考中卡片）
│   │
│   ├── 📂 feishu/                # 🐦 飞书底层模块
│   │   ├── api-client.ts          # REST 客户端
│   │   ├── ws-client.ts           # WebSocket 长连接
│   │   ├── cardkit-client.ts      # CardKit API
│   │   ├── card-builder.ts        # 卡片构建器
│   │   ├── message-dedup.ts       # 消息去重（SQLite）
│   │   └── webhook-server.ts      # Express Webhook
│   │
│   ├── 📂 scheduled-task/        # ⏰ 定时任务
│   │   ├── runtime.ts             # CronJob 调度
│   │   ├── store.ts               # 持久化（JSON）
│   │   ├── executor.ts            # 任务执行器
│   │   ├── creation-manager.ts    # 交互式创建流程
│   │   ├── llm-schedule-parser.ts # LLM 自然语言解析
│   │   ├── schedule-parser.ts     # Cron 表达式解析
│   │   ├── next-run.ts            # 下次运行时间计算
│   │   ├── display.ts             # 展示卡片构建
│   │   └── types.ts               # 类型定义
│   │
│   ├── 📂 cron/                  # 💓 心跳服务
│   │   └── heartbeat.ts           # 系统健康检查
│   │
│   ├── 📂 cli/                   # 🛠️ CLI 工具
│   │   └── setup-wizard.ts        # 交互式配置向导
│   │
│   ├── 📂 i18n/                  # 🌐 国际化
│   │   ├── index.ts
│   │   └── 📂 locales/
│   │       ├── en.ts              # 英文
│   │       └── zh-CN.ts           # 中文
│   │
│   ├── 📂 utils/                 # 🔧 工具函数
│   │   ├── config.ts              # Zod 验证配置加载
│   │   ├── db.ts                  # SQLite 初始化
│   │   ├── logger.ts              # 结构化日志
│   │   ├── env-loader.ts          # .env 文件加载
│   │   ├── paths.ts               # 附件路径工具
│   │   └── event-listeners.ts     # 事件监听器注册表
│   │
│   └── 📂 __tests__/             # 🧪 测试
│       ├── setup.ts
│       ├── example.test.ts
│       ├── channel-integration.test.ts
│       ├── qq-api-client.test.ts
│       └── 📂 e2e/
│           └── smoke.test.ts
│
├── 📂 docs/                      # 📚 文档
│   ├── README.md
│   ├── CONFIGURATION.md
│   ├── CONFIGURATION.zh-CN.md
│   ├── CONTRIBUTING.md
│   ├── CHANGELOG.md
│   ├── architecture.md
│   ├── deployment.md
│   ├── environment.md
│   ├── commands.md
│   ├── feishu-config.md
│   ├── implementation.md
│   ├── reliability.md
│   ├── qa-cards.md
│   └── task-plans.md
│
├── 📂 spec/                      # 📋 设计规格
│   ├── spec-architecture-channel-manager.md
│   ├── spec-architecture-event-processor.md
│   ├── spec-architecture-message-handler.md
│   ├── spec-architecture-session-management.md
│   ├── spec-architecture-streaming-bridge.md
│   ├── spec-file-sending-implementation.md
│   └── spec-tool-dingtalk-channel.md
│
└── 📂 scripts/                   # 📜 脚本
    ├── setup-autostart.sh         # Linux/macOS 开机自启
    ├── setup-autostart.ps1        # Windows 开机自启
    ├── unix-start-bridge.sh       # Unix 启动脚本
    └── windows-start-bridge.ps1   # Windows 启动脚本
```

---

## 📊 模块依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                        index.ts (入口)                       │
│  9阶段启动：Config → Server → DB → Services → Plugins → ... │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   channel/    │   │   handler/    │   │  streaming/   │
│  渠道插件层    │   │  消息处理层    │   │  流式处理层    │
└───────────────┘   └───────────────┘   └───────────────┘
        │                     │                     │
        │     ┌───────────────┴───────────────┐     │
        │     ▼                               ▼     │
        │  ┌───────────────┐         ┌───────────────┐
        │  │   session/    │         │   feishu/     │
        │  │ Session 管理  │         │ 飞书底层模块   │
        │  └───────────────┘         └───────────────┘
        │           │                       │
        └───────────┴───────────────────────┘
                            │
                    ┌───────┴───────┐
                    ▼               ▼
            ┌───────────────┐ ┌───────────────┐
            │   utils/      │ │  scheduled-   │
            │   工具函数     │ │  task/ 定时   │
            └───────────────┘ └───────────────┘
```

---

## 🔑 核心接口

### ChannelPlugin（渠道插件接口）

```typescript
interface ChannelPlugin {
  id: ChannelId              // "feishu" | "wechat" | "qq" | ...
  meta: ChannelMeta          // 标签 + 描述
  config: ChannelConfigAdapter      // 凭证配置（必需）
  gateway?: ChannelGatewayAdapter   // 连接管理（WebSocket/轮询）
  messaging?: ChannelMessagingAdapter // 消息标准化
  outbound?: ChannelOutboundAdapter   // 发送消息
  streaming?: ChannelStreamingAdapter // 流式输出
  threading?: ChannelThreadingAdapter // 会话映射
}
```

---

## 📈 数据流

### 入站（IM → opencode）

```
用户在 IM 发消息
  → ChannelPlugin.gateway（接收）
    → normalizeInbound（标准化）
      → MessageHandler
        1. MessageDedup（去重）
        2. SessionManager（映射 session）
        3. POST → opencode /session/{id}/message
        4. 注册 SSE 监听
```

### 出站（opencode → IM）

```
opencode SSE 事件
  → EventProcessor（解析）
    → StreamingBridge
      - TextDelta → 累积文本
      - SessionIdle → 发送最终回复
      - ToolStart → 更新进度卡片
```

---

## 📦 技术栈

| 层面 | 技术 |
|------|------|
| 运行时 | Bun |
| 语言 | TypeScript (ES2022) |
| 数据库 | SQLite (bun:sqlite) |
| 配置验证 | Zod |
| Web 框架 | Express |
| 定时任务 | cron |
| 测试 | Vitest |
