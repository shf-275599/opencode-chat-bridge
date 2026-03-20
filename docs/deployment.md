# 部署指南 (Deployment)

`opencode-lark` 可以在多种环境下运行，推荐使用 PM2 或 Docker 进行生产部署。

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
```

## 2. 使用 Docker 部署

1. **构建镜像**:
   ```bash
   docker build -t opencode-lark .
   ```

2. **运行容器**:
   ```bash
   docker run -d \
     --name opencode-lark \
     -e FEISHU_APP_ID=xxx \
     -e FEISHU_APP_SECRET=xxx \
     -e OPENCODE_SERVER_URL=http://host.docker.internal:4096 \
     opencode-lark
   ```

## 3. 直接源码运行

适用于开发及预览环境。

```bash
# 全局安装模式
opencode-im-bridge

# 源码开发模式
bun install
bun run dev
```

---

## 4. 最佳实践

- **CWD 设置**: 如果您在不同的目录下管理多个 `opencode` 工程，请在启动时通过 `OPENCODE_CWD` 显式指定目录，以确保 Session 发现准确。
- **端口映射**: 如果使用 Webhook 模式，请确保 `FEISHU_WEBHOOK_PORT` (默认 3001) 已在防火墙中开启或通过反向代理（如 Nginx）暴露。
