/**
 * DingTalk API type definitions
 */

export const DINGTALK_API_BASE = "https://api.dingtalk.com"
export const DINGTALK_OAPI_BASE = "https://oapi.dingtalk.com"

export interface DingTalkConfig {
  appKey: string
  appSecret: string
  agentId?: string
  botName?: string
}

export interface DingTalkAccessToken {
  access_token: string
  expires_in: number
  refresh_token?: string
}

export interface DingTalkAPIResponse<T = unknown> {
  errcode?: number
  errmsg?: string
  result?: T
}

export interface DingTalkMessage {
  msgtype: DingTalkMessageType
  text?: { content: string }
  markdown?: { title: string; text: string }
  interactive?: { card: DingTalkCard }
  image?: { mediaId: string }
  file?: { mediaId: string }
  audio?: { mediaId: string }
  video?: { mediaId: string; title: string; duration: number }
}

export type DingTalkMessageType = "text" | "markdown" | "interactive" | "image" | "file" | "audio" | "video"

export interface DingTalkCard {
  config?: { wide_screen_mode?: boolean }
  header?: {
    title: { tag: "plain_text"; content: string }
    template?: string
  }
  body?: { elements: DingTalkCardElement[] }
}

export interface DingTalkCardElement {
  tag: "markdown" | "text" | "hr" | "actions" | "button"
  content?: string
  text?: { tag: "plain_text"; content: string }
  actions?: DingTalkCardAction[]
}

export interface DingTalkCardAction {
  tag: "button"
  text: { tag: "plain_text"; content: string }
  type: "primary" | "default" | "danger"
  value: Record<string, unknown>
}

export interface DingTalkSendMessageRequest {
  agent_id?: string
  userid_list?: string
  open_conversation_id?: string
  conversation_type?: number
  msg: DingTalkMessage
}

export interface DingTalkMediaUploadResponse {
  media_id: string
}

export interface DingTalkStreamEvent {
  eventType: string
  streamId?: string
  topic?: string
  data?: unknown
}

export interface DingTalkCallbackEvent {
  eventType?: string
  conversationId?: string
  chatbotCorpId?: string
  chatbotCode?: string
  isMention?: boolean
  senderNick?: string
  senderStaffId?: string
  sessionWebhook?: string
  sessionWebhookExpireTime?: number
  createAt?: number
  senderCorpId?: string
  conversationType?: string
  senderId?: string
  msgId?: string
  msgtype?: string
  text?: { content: string }
  robotCode?: string
  topic?: string
  chatBotCorpId?: string
  token?: string
  isFinish?: boolean
}
