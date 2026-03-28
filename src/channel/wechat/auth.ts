import fs from "node:fs"
import path from "node:path"
import QRCode from "qrcode"
import {
  ILINK_BASE_URL,
  type WechatSession,
} from "./types.js"
import { getQrcode, getQrcodeStatus } from "./client.js"
import { createLogger } from "../../utils/logger.js"

const log = createLogger("wechat-auth")

export function getDefaultSessionFile(): string {
  const cwdBase = process.env["OPENCODE_CWD"] ?? process.cwd()
  return path.resolve(cwdBase, ".opencode-lark", "wechat-session.json")
}

export function getDefaultDataDir(): string {
  const cwdBase = process.env["OPENCODE_CWD"] ?? process.cwd()
  return path.resolve(cwdBase, ".opencode-lark")
}

export function getDefaultQrcodeFile(): string {
  return path.resolve(getDefaultDataDir(), "wechat-qrcode.png")
}

export function loadSession(sessionFile?: string): WechatSession | null {
  const file = sessionFile ?? getDefaultSessionFile()
  if (!fs.existsSync(file)) return null
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as WechatSession
    if (!data.token || !data.baseUrl) return null
    return data
  } catch {
    return null
  }
}

export function saveSession(session: WechatSession, sessionFile?: string): void {
  const file = sessionFile ?? getDefaultSessionFile()
  const dir = path.dirname(file)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(file, JSON.stringify(session, null, 2), "utf-8")
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // chmod not supported on Windows
  }
}

export function clearSession(sessionFile?: string): void {
  const file = sessionFile ?? getDefaultSessionFile()
  try {
    fs.unlinkSync(file)
  } catch {
    // Ignore if file doesn't exist
  }
}

export interface LoginCallbacks {
  onQrcode?: (qrcodeDataUrl: string) => void
  onStatus?: (message: string) => void
}

async function renderQrToTerminal(qrString: string): Promise<void> {
  try {
    const str = await QRCode.toString(qrString, { type: "terminal", small: true })
    process.stdout.write("\n" + str + "\n")
  } catch {
    // If terminal rendering fails, skip
  }
}

const MIN_QRCODE_SIZE = 100 // 最小有效二维码图片大小（字节）

/**
 * 判断字符串是否为 URL
 */
function isUrl(str: string): boolean {
  return str.startsWith("http://") || str.startsWith("https://")
}

async function saveQrcodeImage(content: string, filePath: string): Promise<boolean> {
  try {
    // 如果 content 是 URL，下载图片
    if (isUrl(content)) {
      log.info(`[DEBUG] qrcode_img_content 是 URL，正在下载: ${content}`)
      const res = await fetch(content)
      if (!res.ok) {
        log.warn(`下载二维码图片失败: HTTP ${res.status}`)
        return false
      }
      const imageBuffer = Buffer.from(await res.arrayBuffer())
      if (imageBuffer.length < MIN_QRCODE_SIZE) {
        log.warn(`二维码图片数据过小 (${imageBuffer.length} 字节)，可能无效`)
        return false
      }
      fs.writeFileSync(filePath, imageBuffer)
      return true
    }

    // 否则当作 base64 解码
    const imageBuffer = Buffer.from(content, "base64")
    // 验证解码后的数据是否像有效的 PNG 图片
    if (imageBuffer.length < MIN_QRCODE_SIZE) {
      log.warn(`二维码图片数据过小 (${imageBuffer.length} 字节)，可能无效`)
      return false
    }
    // PNG 文件以 0x89 50 4E 47 开头
    const isPng = imageBuffer[0] === 0x89 &&
      imageBuffer[1] === 0x50 &&
      imageBuffer[2] === 0x4e &&
      imageBuffer[3] === 0x47
    if (!isPng) {
      log.warn("二维码图片数据不是有效的 PNG 格式")
      return false
    }
    fs.writeFileSync(filePath, imageBuffer)
    return true
  } catch (err) {
    log.warn(`保存二维码图片失败: ${err}`)
    return false
  }
}

export async function login(
  baseUrl: string,
  sessionFile: string | undefined,
  callbacks: LoginCallbacks = {},
): Promise<WechatSession> {
  const onStatus = callbacks.onStatus ?? ((msg: string) => log.info(msg))

  onStatus("开始微信扫码登录...")

  const qrResp = await getQrcode(baseUrl)
  log.info(`[DEBUG] getQrcode 响应: qrcode=${qrResp.qrcode?.substring(0, 8)}..., qrcode_img_content 长度=${qrResp.qrcode_img_content?.length ?? 0}`)

  const dataDir = getDefaultDataDir()
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const qrFilePath = getDefaultQrcodeFile()
  let qrcodeFileSaved = false
  let qrcodeUrl: string | undefined

  if (qrResp.qrcode_img_content) {
    // qrcode_img_content 可能是 URL 或 base64 数据
    if (isUrl(qrResp.qrcode_img_content)) {
      qrcodeUrl = qrResp.qrcode_img_content
      qrcodeFileSaved = await saveQrcodeImage(qrResp.qrcode_img_content, qrFilePath)
      if (!qrcodeFileSaved) {
        log.warn("无法下载二维码图片文件，请使用终端二维码")
      }
    } else {
      // base64 格式
      qrcodeFileSaved = await saveQrcodeImage(qrResp.qrcode_img_content, qrFilePath)
      if (!qrcodeFileSaved) {
        log.warn("无法保存二维码图片文件，请使用终端二维码")
      }
    }
  } else {
    log.warn("API 未返回二维码图片数据 (qrcode_img_content 为空)")
  }

  // 终端二维码：优先显示 URL（微信扫码需要），否则显示 qrcode 标识符
  const qrContent = qrcodeUrl ?? qrResp.qrcode
  await renderQrToTerminal(qrContent)
  onStatus("请使用微信扫描上方二维码（5分钟内有效）")
  if (qrcodeFileSaved) {
    onStatus(`二维码图片已保存到: ${qrFilePath}`)
  }

  if (callbacks.onQrcode) {
    if (qrcodeUrl) {
      // 回调传递 URL
      callbacks.onQrcode(qrcodeUrl)
    } else if (qrResp.qrcode_img_content) {
      // base64 格式
      callbacks.onQrcode(`data:image/png;base64,${qrResp.qrcode_img_content}`)
    }
  }

  onStatus("等待扫码确认...")
  const deadline = Date.now() + 5 * 60 * 1000
  let currentQrcode = qrResp.qrcode
  let refreshCount = 0

  while (Date.now() < deadline) {
    const status = await getQrcodeStatus(baseUrl, currentQrcode)

    log.info(`[DEBUG] QR status: ${JSON.stringify(status)}`)

    if (status.status === "confirmed") {
      onStatus("登录成功！")
      const session: WechatSession = {
        token: status.bot_token!,
        baseUrl: status.baseurl || baseUrl,
        accountId: status.ilink_bot_id!,
        userId: status.ilink_user_id!,
        savedAt: new Date().toISOString(),
      }
      saveSession(session, sessionFile)
      log.info(`Bot ID: ${session.accountId}`)
      return session
    }

    switch (status.status) {
      case "wait":
        process.stdout.write(".")
        break
      case "scaned":
        onStatus("已在微信中点击确认，正在登录...")
        break
      case "expired": {
        refreshCount++
        if (refreshCount > 3) {
          throw new Error("二维码多次过期，请重新运行")
        }
        onStatus(`二维码过期，正在刷新 (${refreshCount}/3)...`)
        const newQr = await getQrcode(baseUrl)
        currentQrcode = newQr.qrcode
        if (newQr.qrcode_img_content) {
          const newUrl = isUrl(newQr.qrcode_img_content) ? newQr.qrcode_img_content : undefined
          await saveQrcodeImage(newQr.qrcode_img_content, qrFilePath)
          await renderQrToTerminal(newUrl ?? newQr.qrcode)
          if (callbacks.onQrcode) {
            callbacks.onQrcode(newUrl ?? `data:image/png;base64,${newQr.qrcode_img_content}`)
          }
        } else {
          await renderQrToTerminal(newQr.qrcode)
        }
        onStatus("请重新扫描上方新二维码")
        break
      }
      default:
        log.warn(`[DEBUG] Unknown status: ${status.status}`)
        break
    }

    await new Promise((r) => setTimeout(r, 1000))
  }

  throw new Error("登录超时，请重新运行")
}

export async function ensureSession(
  sessionFile?: string,
  baseUrl = ILINK_BASE_URL,
  forceLogin = false,
  callbacks: LoginCallbacks = {},
): Promise<WechatSession> {
  if (!forceLogin) {
    const existing = loadSession(sessionFile)
    if (existing) {
      log.info(`已加载微信会话 (Bot: ${existing.accountId})`)
      return existing
    }
  }
  return login(baseUrl, sessionFile, callbacks)
}
