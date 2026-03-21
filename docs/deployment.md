# 部署指南 (Deployment)

`opencode-im-bridge` 可以在多种环境下运行，支持 PM2、Docker，直接运行等多种部署方式，并提供开机自启动配置。

## 1. 使用 PM2 部署 (推荐)

PM2 可以确保服务在崩溃或重启后自动恢复。

### 前置要求
- 已安装 [Bun](https://bun.sh)
- 已安装 PM2: `npm install -g pm2`

### 脚本说明
项目根目录提供了 `start.sh`，内部已包含环境变量处理逻辑。

```bash
# 启动服务
pm2 start ./start.sh --name opencode-lark

# 查看日志
pm2 logs opencode-lark

# 停止服务
pm2 stop opencode-lark

# 重启服务
pm2 restart opencode-lark
```

---

## 2. 开机自启动配置

### 可选配置命令速查

以下命令可按实际部署方式任选其一：

```powershell
# Windows + PM2
pm2 startup windows
pm2 save

# Windows + 任务计划程序（管理员 PowerShell）
schtasks /Create /TN "opencode-im-bridge" /SC ONSTART /RL HIGHEST /F /TR "\"C:\\path\\to\\bun.exe\" run \".\\opencode-im-bridge\\src\\index.ts\""
```

```bash
# Linux + systemd
sudo systemctl enable opencode-im-bridge
sudo systemctl start opencode-im-bridge

# macOS + launchd
launchctl load ~/Library/LaunchAgents/com.opencode.imbridge.plist

# Docker
docker run -d --restart unless-stopped --name opencode-im-bridge opencode-im-bridge
```

建议：
- 已使用 PM2 的场景优先选择 `pm2 startup` + `pm2 save`
- Windows 原生部署且不依赖 PM2 时，可使用 `schtasks`
- 服务器部署优先使用 `systemd` 或 Docker 的 `--restart unless-stopped`

### Windows 一键脚本

仓库内置了一个 Windows 自启动配置脚本，推荐直接使用：

```powershell
# 注册“当前用户登录后自动启动”
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1

# 注册“系统启动时自动启动”
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1 -Trigger Startup

# 绑定多份配置中的指定配置以跳过终端交互
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1 -ConfigId my_config_name

# 指定 bun 路径
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1 -BunPath "C:\Users\YourUser\.bun\bin\bun.exe"

# 移除自启动
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1 -Remove
```

说明：
- `scripts/setup-autostart.ps1` 负责注册/移除 Windows 计划任务
- `scripts/windows-start-bridge.ps1` 负责在正确的仓库目录中启动 `bun run src/index.ts`
- 默认使用 `Logon` 触发器，更适合依赖当前用户环境的本地部署

### Windows — 使用 PM2 Startup

```bash
# 生成启动脚本
pm2 startup windows

# 保存当前进程列表
pm2 save

# 现在 PM2 会自动在开机时启动服务
```

### Windows — 使用任务计划程序

1. 打开「任务计划程序」
2. 创建基本任务 → 命名为 `opencode-im-bridge`
3. 触发器：计算机启动时
4. 操作：启动程序
   - 程序：`C:\Users\YourUser\.bun\bin\bun.exe`
   - 参数：`run "C:\\path\\to\\your\\project\\opencode-im-bridge\\src\\index.ts"`
5. 完成

### Linux — 使用 systemd

创建服务文件 `/etc/systemd/system/opencode-im-bridge.service`:

```ini
[Unit]
Description=OpenCode IM Bridge Service
After=network.target

[Service]
Type=simple
User=your_username
WorkingDirectory=/home/your_username/Projects/opencode-im-bridge
ExecStart=/home/your_username/.bun/bin/bun run src/index.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

然后启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable opencode-im-bridge
sudo systemctl start opencode-im-bridge
sudo systemctl status opencode-im-bridge
```

### macOS — 使用 launchd

创建 `~/Library/LaunchAgents/com.opencode.imbridge.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.opencode.imbridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/your_user/.bun/bin/bun</string>
        <string>run</string>
        <string>/Users/your_user/Projects/opencode-im-bridge/src/index.ts</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>/Users/your_user/Projects/opencode-im-bridge</string>
</dict>
</plist>
```

加载服务：

```bash
launchctl load ~/Library/LaunchAgents/com.opencode.imbridge.plist
```

---

## 3. 使用 Docker 部署

### 构建并运行

```bash
# 构建镜像
docker build -t opencode-im-bridge .

# 运行容器
docker run -d \
  --name opencode-im-bridge \
  -e FEISHU_APP_ID=xxx \
  -e FEISHU_APP_SECRET=xxx \
  -e OPENCODE_SERVER_URL=http://host.docker.internal:4096 \
  -v /path/to/data:/app/data \
  opencode-im-bridge
```

### Docker Compose (推荐)

创建 `docker-compose.yml`:

```yaml
version: '3.8'
services:
  opencode-im-bridge:
    build: .
    container_name: opencode-im-bridge
    restart: unless-stopped
    environment:
      - FEISHU_APP_ID=${FEISHU_APP_ID}
      - FEISHU_APP_SECRET=${FEISHU_APP_SECRET}
      - OPENCODE_SERVER_URL=http://host.docker.internal:4096
    volumes:
      - ./data:/app/data
    network_mode: host
```

启动：

```bash
docker-compose up -d
docker-compose logs -f
```

### Docker 开机自启动

```bash
# 重启策略: unless-stopped 确保容器在 Docker 启动时自动运行
docker run -d --restart unless-stopped opencode-im-bridge
```

---

## 4. 直接源码运行

适用于开发及预览环境。

```bash
# 全局安装模式
opencode-im-bridge

# 源码开发模式
bun install
bun run dev
```

---

## 5. 最佳实践

- **CWD 设置**: 如果您在不同的目录下管理多个 `opencode` 工程，请在启动时通过 `OPENCODE_CWD` 显式指定目录，以确保 Session 发现准确。
- **端口映射**: 如果使用 Webhook 模式，请确保 `FEISHU_WEBHOOK_PORT` (默认 3001) 已在防火墙中开启或通过反向代理（如 Nginx）暴露。
- **日志管理**: 使用 PM2 时，可配置日志轮转：
  ```bash
  pm2 install pm2-logrotate
  pm2 set pm2-logrotate:max_size 10M
  pm2 set pm2-logrotate:retain 7
  ```
- **健康检查**: 配置健康检查端点确保服务正常运行：
  ```jsonc
  {
    "healthCheck": {
      "enabled": true,
      "port": 3002
    }
  }
  ```
