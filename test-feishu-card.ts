/**
 * 测试脚本：发送 Feishu Q&A 卡片到指定 chat_id
 * 运行前请填入下面的配置
 */
const FEISHU_APP_ID = "cli_xxxxxxxxxxxx"
const FEISHU_APP_SECRET = "xxxxxxxxxxxxxxxxxxxx"
const CHAT_ID = "oc_xxxxxxxxxxxxxxxx"  // 接收卡片的飞书会话 ID

const TEST_REQUEST_ID = "test-qa-123"

const card = {
  schema: "2.0",
  config: { wide_screen_mode: true },
  header: {
    title: { tag: "plain_text", content: "❓ 测试问题" },
    template: "orange",
  },
  body: {
    elements: [
      { tag: "markdown", content: "这是一个测试问题，请选择答案：" },
      { tag: "button", text: { tag: "plain_text", content: "✅ 选项 A" }, type: "primary", value: { action: "question_answer", requestId: TEST_REQUEST_ID, answers: JSON.stringify([["A"]]) } },
      { tag: "button", text: { tag: "plain_text", content: "⚡ 选项 B" }, type: "default", value: { action: "question_answer", requestId: TEST_REQUEST_ID, answers: JSON.stringify([["B"]]) } },
      { tag: "button", text: { tag: "plain_text", content: "❌ 拒绝" }, type: "danger", value: { action: "question_answer", requestId: TEST_REQUEST_ID, answers: JSON.stringify([["Reject"]]) } },
    ],
  },
}

async function getToken(): Promise<string> {
  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
  })
  const data = await res.json() as { code: number; tenant_access_token?: string; msg?: string }
  if (data.code !== 0 || !data.tenant_access_token) throw new Error(`Token error: ${data.msg}`)
  return data.tenant_access_token
}

async function sendCard(token: string): Promise<void> {
  const res = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      receive_id: CHAT_ID,
      msg_type: "interactive",
      content: JSON.stringify(card),
    }),
  })
  const data = await res.json() as { code: number; msg: string; data?: { message_id?: string } }
  if (data.code !== 0) throw new Error(`Send error: ${data.code} - ${data.msg}`)
  console.log("✅ 卡片发送成功! message_id:", data.data?.message_id)
  console.log("📋 requestId:", TEST_REQUEST_ID)
  console.log("\n点击卡片按钮后，bridge 应该 POST 到 opencode server:")
  console.log(`   POST /question/${TEST_REQUEST_ID}/reply`)
  console.log(`   Body: { answers: [["A"]] } 或 [["B"]] 等`)
}

async function main() {
  try {
    console.log("🔑 获取 token...")
    const token = await getToken()
    console.log("📤 发送 Q&A 卡片...")
    await sendCard(token)
  } catch (e) {
    console.error("❌ 错误:", e)
  }
}

main()
