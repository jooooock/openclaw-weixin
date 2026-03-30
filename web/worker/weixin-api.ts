/**
 * 微信机器人 API 封装 — Workers 兼容版本（无 Node.js 依赖）
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BaseInfo {
  channel_version?: string;
}

export const MessageType = { USER: 1, BOT: 2 } as const;
export const MessageItemType = { TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 } as const;
export const MessageState = { NEW: 0, GENERATING: 1, FINISH: 2 } as const;

export interface TextItem { text?: string }

export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
}

export interface ImageItem { media?: CDNMedia; thumb_media?: CDNMedia; aeskey?: string; url?: string; mid_size?: number }
export interface VoiceItem { media?: CDNMedia; encode_type?: number; playtime?: number; text?: string }
export interface FileItem  { media?: CDNMedia; file_name?: string; md5?: string; len?: string }
export interface VideoItem { media?: CDNMedia; video_size?: number; play_length?: number; thumb_media?: CDNMedia }

export interface MessageItem {
  type?: number;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageReq {
  msg?: WeixinMessage;
}

export interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

export interface QRStatusResponse {
  status: "wait" | "scaned" | "confirmed" | "expired";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_INFO: BaseInfo = { channel_version: "demo-standalone" };

function randomWechatUin(): string {
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  const uint32 = new DataView(arr.buffer).getUint32(0);
  return btoa(String(uint32));
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildHeaders(token?: string, body?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
  };
  if (body) headers["Content-Length"] = String(new TextEncoder().encode(body).byteLength);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function apiFetch(params: {
  baseUrl: string;
  endpoint: string;
  body: string;
  token?: string;
  timeoutMs: number;
}): Promise<string> {
  const base = params.baseUrl.endsWith("/") ? params.baseUrl : `${params.baseUrl}/`;
  const url = new URL(params.endpoint, base).toString();
  const headers = buildHeaders(params.token, params.body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: params.body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) throw new Error(`API ${params.endpoint} ${res.status}: ${text}`);
    return text;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";

/** 获取登录二维码 */
export async function fetchQRCode(baseUrl = DEFAULT_BASE_URL, botType = "3"): Promise<QRCodeResponse> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, base);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`fetchQRCode ${res.status}: ${await res.text()}`);
  return await res.json() as QRCodeResponse;
}

/** 轮询二维码扫码状态 */
export async function pollQRStatus(baseUrl: string, qrcode: string, timeoutMs = 35_000): Promise<QRStatusResponse> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`pollQRStatus ${res.status}`);
    return await res.json() as QRStatusResponse;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") return { status: "wait" };
    throw err;
  }
}

/** 长轮询获取新消息 */
export async function getUpdates(params: {
  baseUrl: string;
  token: string;
  getUpdatesBuf?: string;
  timeoutMs?: number;
}): Promise<GetUpdatesResp> {
  const timeout = params.timeoutMs ?? 25_000;
  try {
    const raw = await apiFetch({
      baseUrl: params.baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({
        get_updates_buf: params.getUpdatesBuf ?? "",
        base_info: BASE_INFO,
      }),
      token: params.token,
      timeoutMs: timeout,
    });
    return JSON.parse(raw) as GetUpdatesResp;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: params.getUpdatesBuf };
    }
    throw err;
  }
}

/** 发送文本消息 */
export async function sendTextMessage(params: {
  baseUrl: string;
  token: string;
  toUserId: string;
  text: string;
  contextToken?: string;
}): Promise<void> {
  const body: SendMessageReq = {
    msg: {
      from_user_id: "",
      to_user_id: params.toUserId,
      client_id: `demo:${Date.now()}-${randomHex(4)}`,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: [{ type: MessageItemType.TEXT, text_item: { text: params.text } }],
      context_token: params.contextToken,
    },
  };
  await apiFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({ ...body, base_info: BASE_INFO }),
    token: params.token,
    timeoutMs: 15_000,
  });
}
