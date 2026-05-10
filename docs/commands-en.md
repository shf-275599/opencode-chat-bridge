# Command Reference

`opencode-lark` supports varios interaction commands. Type these directly into your IM chat to manage sessions and the bridge status.

## 1. Session Management

| Command | Description | Example |
|---|---|---|
| `/new` | Force-start a new opencode session and bind it to the current chat | `/new` |
| `/sessions` | List recent TUI sessions and their binding status | `/sessions` |
| `/connect` | Manually bind the current chat to a specific Session ID | `/connect ses_abc123` |
| `/abort` | Terminate the agent's current task (e.g., stuck tool calls) | `/abort` |

## 2. Utilities

| Command | Description | Example |
|---|---|---|
| `/help` | Show the help menu | `/help` |
| `/share` | Generate and return a sharing link for the current session | `/share` |
| `/compact` | Force context compaction to clean up conversation history | `/compact` |

## 3. Reliability (Admin Only)

| Command | Description | Example |
|---|---|---|
| `/cron` | List currently active scheduled jobs | `/cron` |
| `/heartbeat` | View heartbeat probe stats (success/fail counts) | `/heartbeat` |

## 4. Platform Differences

- **Feishu**: All commands return beautiful **interactive cards** with clickable buttons.
- **QQ / Telegram**: Commands return results in **plain text** format.
