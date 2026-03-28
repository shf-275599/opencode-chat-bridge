import { readFile } from "node:fs/promises"
import { basename } from "node:path"

const TELEGRAM_API_BASE = "https://api.telegram.org"

async function sendFileTest() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    console.error("请设置 TELEGRAM_BOT_TOKEN 环境变量")
    process.exit(1)
  }

  const chatId = process.argv[2]
  const filePath = process.argv[3]

  if (!chatId || !filePath) {
    console.error("用法: node test-send-file.js <chat_id> <file_path>")
    console.error("示例: node test-send-file.js 123456789 F:/Picture/test.jpg")
    process.exit(1)
  }

  console.log(`Sending file: ${filePath} to chat: ${chatId}`)

  const fileData = await readFile(filePath)
  const fileName = basename(filePath)

  const url = `${TELEGRAM_API_BASE}/bot${botToken}/sendDocument`
  const form = new FormData()
  form.append("chat_id", chatId)
  form.append("document", new Blob([fileData]), fileName)

  const res = await fetch(url, { method: "POST", body: form })
  const data = await res.json()

  if (data.ok) {
    console.log("✅ 文件发送成功!")
  } else {
    console.error("❌ 发送失败:", data.description)
  }
}

sendFileTest()