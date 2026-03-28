# Changelog

## 0.43.0 - 2026-03-28

### Features
- Add interactive confirm/reject cards for Feishu task preview
- Add Telegram inline keyboard support for /cron remove
- Add Discord button rows for /cron remove
- Add rich task info display in remove cards (name, ID, schedule, status, timestamps)

### Improvements
- Improve Chinese number parsing in schedule parser ("每五分钟" now works)
- Improve LLM prompt to correctly extract taskPrompt from natural language
- Inject IM context and file attachment instructions in scheduled task executor
- Add snapshotAttachments before task execution for automatic file detection and sending

### Fixes
- Fix action.nodes structure in Feishu cards (buttons should be in body.elements)
- Fix prefix stripping in schedule parser ("创建任务", "请", "帮我" now properly ignored)
