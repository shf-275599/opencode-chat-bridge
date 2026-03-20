# Bot Behavior Guidelines

## 1. Response Logic

- **Default Mode**: The bot acts as a mirror to `opencode`. Every message is treated as a terminal entry.
- **Smart Binding**: The bot attempts to "pick up" the most recent TUI activity for new users automatically.
- **Context Isolation**: Each chat thread maintains its own memory and session mapping, preventing cross-talk between different users or topics.

## 2. User Experience Principles

- **Stream First**: Always aim to show real-time text output.
- **Visible Tools**: Provide clear UI feedback when the agent is using tools or sub-agents.
- **Formatting**: Render Markdown by default to ensure code blocks and lists look professional.

## 3. Constraints

- **File Limits**: Platform-imposed maximum file size for attachments is 50MB.
- **Timeouts**: SSE connections default to a 5-minute timeout. If reached, the bridge will finalize the current card and transition to idle.
