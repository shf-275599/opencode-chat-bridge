# Deployment Guide

`opencode-lark` can run in various environments. For production, we recommend using PM2 or Docker.

## 1. Deployment with PM2 (Recommended)

PM2 ensures the service automatically restarts if it crashes or the server reboots.

### Prerequisites
- [Bun](https://bun.sh) installed
- PM2 installed: `npm install -g pm2`

### Usage
The project includes a `start.sh` script that handles environment variables.

```bash
# Start the service
pm2 start ./start.sh --name opencode-lark

# View logs
pm2 logs opencode-lark

# Stop the service
pm2 stop opencode-lark
```

## 2. Deployment with Docker

1. **Build Image**:
   ```bash
   docker build -t opencode-lark .
   ```

2. **Run Container**:
   ```bash
   docker run -d \
     --name opencode-lark \
     -e FEISHU_APP_ID=your_id \
     -e FEISHU_APP_SECRET=your_secret \
     -e OPENCODE_SERVER_URL=http://your_ip:4096 \
     opencode-lark
   ```

## 3. Running from Source

Best for development and quick testing.

```bash
# Global installation mode
opencode-im-bridge

# Source development mode
bun install
bun run dev
```

## 4. Autostart Scripts

The repository includes ready-to-run autostart helpers for all platforms.

### Windows One-Click Script

The repository includes a built-in Windows autostart configuration script. This is the recommended approach for Windows:

```powershell
# Register to start automatically upon current user login
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1

# Register to start automatically when the system boots
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1 -Trigger Startup

# Register with a specific configuration profile (bypasses terminal prompt when multiple configs exist)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1 -ConfigId my_config_name

# Specify the explicit path to bun executable
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1 -BunPath "C:\Users\YourUser\.bun\bin\bun.exe"

# Remove the autostart task
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1 -Remove
```

Notes:
- `scripts/setup-autostart.ps1` is responsible for registering/removing Windows scheduled tasks.
- `scripts/windows-start-bridge.ps1` ensures `bun run src/index.ts` is launched in the correct repository directory.
- By default, it uses the `Logon` trigger, which is best for local deployments relying on the current user's environment.

```bash
# Linux/macOS
chmod +x ./scripts/setup-autostart.sh ./scripts/unix-start-bridge.sh
./scripts/setup-autostart.sh

# Register with a specific config
./scripts/setup-autostart.sh --config-id my_config_name

# Remove
./scripts/setup-autostart.sh --remove
```

Platform behavior:
- Windows: registers a Scheduled Task for the current user
- Linux: installs a user-level `systemd` service in `~/.config/systemd/user/`
- macOS: installs a `launchd` agent in `~/Library/LaunchAgents/`

---

## 5. Best Practices

- **CWD Override**: If managing multiple `opencode` projects, use `OPENCODE_CWD` to ensure the bridge discovers the correct sessions.
- **Port Mapping**: For Webhook mode, ensure `FEISHU_WEBHOOK_PORT` (default: 3001) is accessible or proxied via Nginx.
