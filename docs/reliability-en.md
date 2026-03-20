# Reliability: Heartbeat, Cron, and Fault Tolerance

`opencode-lark` integrates several production-grade reliability features to ensure the bridge stays healthy and alerts administrators when things go wrong.

## 1. Automatic Reconnection

During the startup (Phase 2), the service actively probes the `opencode server`.

- **Algorithm**: Exponential Backoff.
- **Parameters**: 1s initial delay, max 10 retries.
- **Purpose**: Prevents startup failures if the bridge starts before the TUI/Server is ready.

## 2. Scheduled Jobs: CronService

The `CronService` allows for periodic "proactive" tasks.

- **Dynamic Management**: Jobs can be added or removed via HTTP API (`/cron/add`, `/cron/remove`) or IM commands without restarting.
- **Persistence**: Jobs are saved in a local JSON file (defined by `config.jobsFile`) and reloaded on boot.
- **Schedules**:
    - Standard Cron expressions (e.g., `0 0 * * *`).
    - Human-friendly shortcodes (e.g., `every 30 m`, `daily 09:00`).
- **Logic**: When a job fires, it sends a system prompt to `opencode`. The agent's response is then sent back to the configured IM chat.

## 3. Proactive Monitoring: HeartbeatService

The `HeartbeatService` monitors the end-to-end health of the agent.

- **Probing**: Sends a check prompt at fixed intervals (`intervalMs`).
- **Custom Logic**: Uses the content of `HEARTBEAT.md` as the check instruction.
- **Verification**: The agent must reply with exactly `HEARTBEAT_OK` to pass.
- **Alerting**: 
    - Consecutive failures trigger alerts.
    - Alerts are sent to specified Feishu `statusChatId` or `alertChats`.

## 4. Persistence and Recovery

- **Session Mapping**: All `Thread ID <-> Session ID` mappings are stored in `data/lark-im.db` (SQLite). The bridge "remembers" conversation context even after process restarts.
- **SSE Resilience**: The system attempts to restore SSE stream connections if they drop due to network issues.
- **Graceful Shutdown**: Listens for system signals (SIGTERM/SIGINT) to close database handles and stop schedulers cleanly.

---

## Configuration Example

In `opencode-lark.jsonc`:

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
    "intervalMs": 300000, // Every 5 minutes
    "alertChats": ["oc_xxxxxx"]
  }
}
```
