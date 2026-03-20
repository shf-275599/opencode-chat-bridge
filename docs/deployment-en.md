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

---

## 4. Best Practices

- **CWD Override**: If managing multiple `opencode` projects, use `OPENCODE_CWD` to ensure the bridge discovers the correct sessions.
- **Port Mapping**: For Webhook mode, ensure `FEISHU_WEBHOOK_PORT` (default: 3001) is accessible or proxied via Nginx.
