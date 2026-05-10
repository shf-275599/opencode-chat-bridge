# 可靠性：心跳、计划任务与故障恢复

`opencode-lark` 内核集成了多项生产级可靠性机制，确保桥接服务在各种网络、进程或 Agent 异常情况下能够自我发现、预警并恢复。

## 1. 自动重连 (Automatic Reconnection)

在系统启动阶段（Phase 2），程序会主动探查 `opencode server`。

- **算法**: 指数退避（Exponential Backoff）。
- **参数**: 初始间隔 1s，最大重试 10 次。
- **作用**: 解决了桥接服务先于 TUI/Server 启动导致的连接失败问题，无需人工干预。

## 2. 定时任务：CronService

`CronService` 允许用户定义周期性的“主动触发”任务。

- **动态配置**: 支持通过 HTTP API (`/cron/add`, `/cron/remove`) 或 IM 界面动态管理任务，无需重启服务。
- **持久化**: 任务存储在本地 JSON 文件中（由 `config.jobsFile` 指定），重启后自动恢复。
- **语法支持**:
    - 标准 Cron 表达式（如 `0 0 * * *`）。
    - 友好语法（如 `every 30 m`, `daily 09:00`）。
- **数据流**: Cron 任务触发时，会模拟系统消息发送给 `opencode`，Agent 执行完成后通过绑定的 IM 渠道回传结果。

## 3. 心跳服务：HeartbeatService

主动心跳机制用于实时监控 `opencode` 服务的健康度。

- **探针机制**: 每隔固定时间（`intervalMs`）向 Agent 发送一段检测指令。
- **自定义指令**: 默认读取项目根目录下的 `HEARTBEAT.md` 内容作为探针 Prompt。
- **智能判断**: Agent 需要返回特定的 `HEARTBEAT_OK` 字符串才视为正常。
- **告警响应**: 
    - 连续失败将触发告警。
    - 告警通过飞书机器人发送到指定的 `statusChatId` 或 `alertChats` 列表。

## 4. 数据持久化与故障恢复

- **会话映射**: 所有的 `Thread ID <-> Session ID` 绑定关系存储在 `data/lark-im.db` (SQLite) 中。即使进程崩溃，用户在再次发送消息时，服务也能瞬间记起之前的上下文。
- **SSE 流断线重连**: 即使 SSE 流因为网络波动中断，系统也会在下次交互或定时检查时尝试重连。
- **优雅关闭**: 监听系统信号，在退出前关闭所有数据库连接、停止 Cron 调度器并上报状态。

---

## 典型配置示例

在 `opencode-lark.jsonc` 中：

```jsonc
{
  "cron": {
    "enabled": true,
    "apiEnabled": true,
    "apiPort": 3005,
    "jobsFile": "./data/cron-jobs.json"
  },
  "reliability": {
    "proactiveHeartbeatEnabled": true,
    "intervalMs": 300000, // 5分钟一次
    "alertChats": ["oc_xxxxxx"]
  }
}
```
