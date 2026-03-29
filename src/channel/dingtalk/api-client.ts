/**
 * DingTalk API client with token caching and auto-refresh
 */

import crypto from "node:crypto"
import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import {
  DINGTALK_API_BASE,
  DINGTALK_OAPI_BASE,
  type DingTalkConfig,
  type DingTalkAccessToken,
  type DingTalkAPIResponse,
  type DingTalkSendMessageRequest,
  type DingTalkMediaUploadResponse,
  type DingTalkCard,
} from "./types.js"

interface TokenState {
  token: string
  expiresAt: number
}

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

export interface DingTalkApiClient {
  getToken(): Promise<string>
  sendMessage(request: DingTalkSendMessageRequest): Promise<void>
  uploadImage(fileData: Buffer, fileName?: string): Promise<string>
  uploadFile(fileData: Buffer, fileName: string): Promise<string>
  uploadAudio(fileData: Buffer, fileName: string): Promise<string>
  uploadVideo(fileData: Buffer, fileName: string): Promise<string>
  getUserInfo(userId: string): Promise<{ name?: string; avatar?: string }>
}

export function createDingTalkApiClient(config: DingTalkConfig): DingTalkApiClient {
  const { appKey, appSecret } = config

  let tokenState: TokenState | null = null
  let refreshPromise: Promise<string> | null = null

  async function getToken(): Promise<string> {
    const now = Date.now()

    if (tokenState && tokenState.expiresAt - now > TOKEN_REFRESH_BUFFER_MS) {
      return tokenState.token
    }

    if (refreshPromise) {
      return refreshPromise
    }

    refreshPromise = refreshToken()
    try {
      return await refreshPromise
    } finally {
      refreshPromise = null
    }
  }

  async function refreshToken(): Promise<string> {
    const url = `${DINGTALK_OAPI_BASE}/gettoken`
    const params = new URLSearchParams({ appkey: appKey, appsecret: appSecret })

    const response = await fetch(`${url}?${params}`)
    if (!response.ok) {
      throw new Error(`Failed to get DingTalk access token: ${response.status}`)
    }

    const data = await response.json() as DingTalkAPIResponse<DingTalkAccessToken>

    if (data.errcode && data.errcode !== 0) {
      throw new Error(`DingTalk API error getting token: ${data.errcode} - ${data.errmsg}`)
    }

    const result = data.result!
    tokenState = {
      token: result.access_token,
      expiresAt: Date.now() + result.expires_in * 1000,
    }

    return tokenState.token
  }

  async function apiRequest<T>(
    method: "GET" | "POST",
    urlPath: string,
    body?: unknown,
    retryCount = 0,
  ): Promise<T> {
    const token = await getToken()
    const url = `${DINGTALK_API_BASE}${urlPath}`

    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }

    if (body) {
      options.body = JSON.stringify(body)
    }

    const response = await fetch(url, options)
    const data = await response.json() as DingTalkAPIResponse<T>

    if (data.errcode === 40001 && retryCount < 1) {
      tokenState = null
      return apiRequest(method, urlPath, body, retryCount + 1)
    }

    if (data.errcode && data.errcode !== 0) {
      throw new Error(`DingTalk API error: ${data.errcode} - ${data.errmsg}`)
    }

    return data as T
  }

  async function sendMessage(request: DingTalkSendMessageRequest): Promise<void> {
    await apiRequest("POST", "/v1.0/im/messages", request)
  }

  async function uploadMedia(
    fileData: Buffer,
    fileName: string,
    mediaType: "image" | "file" | "audio" | "video",
  ): Promise<string> {
    const token = await getToken()
    const form = new FormData()

    let mimeType: string
    switch (mediaType) {
      case "image":
        mimeType = "image/png"
        break
      case "audio":
        mimeType = "audio/mpeg"
        break
      case "video":
        mimeType = "video/mp4"
        break
      default:
        mimeType = "application/octet-stream"
    }

    form.append("media", new Blob([fileData], { type: mimeType }), fileName)

    const uploadType = mediaType === "image" ? "image" : mediaType === "audio" ? "voice" : "file"

    const response = await fetch(
      `${DINGTALK_API_BASE}/v1.0/im/uploadFile?isTemp=${mediaType === "file" ? "false" : "true"}&uploadType=${uploadType}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      },
    )

    const data = await response.json() as DingTalkAPIResponse<DingTalkMediaUploadResponse>

    if (data.errcode && data.errcode !== 0) {
      throw new Error(`DingTalk media upload error: ${data.errcode} - ${data.errmsg}`)
    }

    return data.result!.media_id
  }

  async function uploadImage(fileData: Buffer, _fileName?: string): Promise<string> {
    return uploadMedia(fileData, "image.png", "image")
  }

  async function uploadFile(fileData: Buffer, fileName: string): Promise<string> {
    return uploadMedia(fileData, fileName, "file")
  }

  async function uploadAudio(fileData: Buffer, fileName: string): Promise<string> {
    return uploadMedia(fileData, fileName, "audio")
  }

  async function uploadVideo(fileData: Buffer, fileName: string): Promise<string> {
    return uploadMedia(fileData, fileName, "video")
  }

  async function getUserInfo(userId: string): Promise<{ name?: string; avatar?: string }> {
    try {
      const data = await apiRequest<{ result?: { name?: string; avatar?: string } }>(
        "GET",
        `/v1.0/contact/users/${userId}`,
      )
      return {
        name: data.result?.name,
        avatar: data.result?.avatar,
      }
    } catch {
      return {}
    }
  }

  return {
    getToken,
    sendMessage,
    uploadImage,
    uploadFile,
    uploadAudio,
    uploadVideo,
    getUserInfo,
  }
}

export async function sendDingTalkMessage(
  config: DingTalkConfig,
  request: DingTalkSendMessageRequest,
): Promise<void> {
  const client = createDingTalkApiClient(config)
  await client.sendMessage(request)
}
