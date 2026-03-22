# 设计方案：飞书发送图片功能

**日期**：2026-03-22
**目标**：给飞书 bridge 增加 `sendImage` 能力，使 Agent 回复中的图片路径能自动发送到飞书

---

## 背景

- `outbound-media.ts` 已实现文件路径检测 + 统一路由
- `ChannelOutboundAdapter` 接口已有 `sendImage?(target, filePath)` 可选方法
- `FeishuApiClient` 已有 `uploadImage(data)` 返回 `image_key`
- **Telegram 已实现** `sendImage`：✅ 实测成功
- **飞书未实现** `sendImage`：❌ 链路断了

---

## 方案

### 改动范围（3 个文件）

| 文件 | 改动 |
|------|------|
| `src/channel/feishu/feishu-plugin.ts` | outbound adapter 增加 `sendImage` 方法 |
| `src/feishu/api-client.ts` | 无改动（API 已就绪） |
| `src/handler/outbound-media.ts` | 无改动（路由已就绪） |

### 核心逻辑

```
Agent 回复包含图片路径（如 /tmp/chart.png）
       ↓
outbound-media.ts 提取路径 + 安全检查
       ↓
adapter.sendImage(target, filePath)
       ↓
FeishuPlugin.sendImage():
  1. fs.readFile(filePath) 读取文件
  2. feishuClient.uploadImage(fileData) → image_key
  3. feishuClient.sendMessage(chatId, {
       msg_type: "image",
       content: JSON.stringify({ image_key })
     })
```

### 详细设计

#### FeishuPlugin.sendImage 实现

```typescript
sendImage: async (target: OutboundTarget, filePath: string): Promise<void> => {
  const fileData = await readFile(filePath)
  const imageKey = await this.feishuClient.uploadImage(fileData)
  await this.feishuClient.sendMessage(target.address, {
    msg_type: "image",
    content: JSON.stringify({ image_key: imageKey }),
  })
}
```

#### 依赖注入

- 已有 `feishuClient: FeishuApiClient` 在 constructor 中
- 需 import `readFile` from `node:fs/promises`
- 需 import `basename` from `node:path`（用于日志）

#### 错误处理

- `uploadImage` 失败 → 抛错，由 `outbound-media.ts` 的 try/catch 捕获并记录 warn
- `sendMessage` 失败 → 同上
- 文件不存在 → 已在 `outbound-media.ts` 的安全检查中过滤

#### 日志

- 发送前：`[FeishuPlugin] Sending image: {filePath} to {chatId}`
- 发送后：`[FeishuPlugin] Image sent: {imageKey}`

---

## 触发方式

| 方式 | 说明 |
|------|------|
| **自动检测** | `outbound-media.ts` 在 `SessionIdle` 时扫描回复文本中的图片路径，触发发送 |
| **用户命令** | 后续可加 `/send <path>` 命令，本 PR 不包含 |

自动检测链路（已存在，本次不改动）：
```
EventProcessor → SessionIdle
       ↓
StreamingBridge → outboundMedia.sendDetectedFiles()
       ↓
outbound-media.ts → extractFilePaths() → filter(isImageFile)
       ↓
adapter.sendImage() ← 这里就是新增的链路
```

---

## 测试计划

1. **手动测试**：Bridge 运行中，向飞书发消息触发 Agent 回复包含图片路径
2. **单元测试**：`feishu-plugin.test.ts` 增加 `sendImage` 测试用例（mock feishuClient）
3. **集成测试**：`e2e/smoke.test.ts` 增加图片发送场景

---

## 风险与限制

- **文件大小**：飞书限制 20MB，已在 `MAX_UPLOAD_BYTES` 中限制
- **图片格式**：飞书支持 png/jpg/gif/webp/bmp，不支持 svg（会当作普通文件发送失败）
- **安全**：路径已在 `outbound-media.ts` 中通过 allowlist + symlink 检查
- **现有代码**：Telegram/QQ 的 `sendImage` 不受影响

---

## 进度

- [x] `feishu-plugin.ts` 增加 `sendImage` 方法
- [x] `setup.ts` 增加 `uploadImage` mock
- [x] 单元测试（19 pass）
- [x] 相关测试（65 pass across 5 files）
- [x] 代码已提交 git
- [ ] 手动验证（重启 bridge 后实际发送）
