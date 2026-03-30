import { Hono } from "hono";
import {
  fetchQRCode,
  pollQRStatus,
  getUpdates,
  sendTextMessage,
  MessageItemType,
  type WeixinMessage,
  type GetUpdatesResp,
} from "./weixin-api";

// ---------------------------------------------------------------------------
// 模块级状态（在同一 isolate 内跨请求持久化）
// ---------------------------------------------------------------------------

interface StoredMessage {
  id: number;
  fromUserId: string;
  toUserId: string;
  text: string;
  messageType: number;
  createTimeMs: number;
  messageId?: number;
}

interface Session {
  token: string;
  baseUrl: string;
  accountId: string;
  getUpdatesBuf: string;
  /** userId -> contextToken */
  contextTokens: Map<string, string>;
  /** userId -> 最后消息时间 */
  lastMessageTime: Map<string, number>;
  /** 已见过的微信 message_id，用于去重 */
  seenMessageIds: Set<number>;
  /** 内部自增 ID */
  nextId: number;
  /** 消息缓冲区 */
  messages: StoredMessage[];
}

let session: Session | null = null;

const MAX_MESSAGES = 500;

function extractText(msg: WeixinMessage): string {
  if (!msg.item_list?.length) return "";
  for (const item of msg.item_list) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) return item.text_item.text;
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) return `[语音] ${item.voice_item.text}`;
    if (item.type === MessageItemType.IMAGE) return "[图片]";
    if (item.type === MessageItemType.VIDEO) return "[视频]";
    if (item.type === MessageItemType.FILE) return `[文件] ${item.file_item?.file_name ?? ""}`;
  }
  return "";
}

function processMessages(resp: GetUpdatesResp): void {
  if (!session) return;

  if (resp.get_updates_buf) {
    session.getUpdatesBuf = resp.get_updates_buf;
  }

  if (!resp.msgs?.length) return;

  for (const msg of resp.msgs) {
    // 用 message_id 去重
    if (msg.message_id && session.seenMessageIds.has(msg.message_id)) continue;
    if (msg.message_id) session.seenMessageIds.add(msg.message_id);

    const fromUser = msg.from_user_id ?? "";
    const toUser = msg.to_user_id ?? "";

    if (msg.message_type === 1 && fromUser && msg.context_token) {
      session.contextTokens.set(fromUser, msg.context_token);
      session.lastMessageTime.set(fromUser, Date.now());
    }

    session.messages.push({
      id: session.nextId++,
      fromUserId: fromUser,
      toUserId: toUser,
      text: extractText(msg),
      messageType: msg.message_type ?? 0,
      createTimeMs: msg.create_time_ms ?? Date.now(),
      messageId: msg.message_id,
    });
  }

  if (session.messages.length > MAX_MESSAGES) {
    session.messages = session.messages.slice(-MAX_MESSAGES);
  }
}

// ---------------------------------------------------------------------------
// Hono 路由
// ---------------------------------------------------------------------------

const app = new Hono();

app.post("/api/qrcode", async (c) => {
  try {
    const qr = await fetchQRCode();
    return c.json(qr);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.get("/api/qrcode/status", async (c) => {
  const qrcode = c.req.query("qrcode");
  if (!qrcode) return c.json({ error: "缺少 qrcode 参数" }, 400);

  try {
    const status = await pollQRStatus("https://ilinkai.weixin.qq.com", qrcode);

    if (status.status === "confirmed" && status.bot_token) {
      session = {
        token: status.bot_token,
        baseUrl: status.baseurl || "https://ilinkai.weixin.qq.com",
        accountId: status.ilink_bot_id ?? "",
        getUpdatesBuf: "",
        contextTokens: new Map(),
        lastMessageTime: new Map(),
        seenMessageIds: new Set(),
        nextId: 1,
        messages: [],
      };
    }

    return c.json({
      status: status.status,
      accountId: status.ilink_bot_id,
      userId: status.ilink_user_id,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.get("/api/session", (c) => {
  if (!session) return c.json({ loggedIn: false });
  return c.json({
    loggedIn: true,
    accountId: session.accountId,
  });
});

app.get("/api/messages", async (c) => {
  if (!session) return c.json({ error: "未登录" }, 401);

  const sinceStr = c.req.query("since");
  const since = sinceStr ? parseInt(sinceStr, 10) : 0;

  // 先检查缓冲区是否有新消息
  const cached = session.messages.filter((m) => m.id > since);
  if (cached.length > 0) {
    return c.json({ messages: cached });
  }

  // 没有新消息，发起一次 getUpdates 长轮询
  try {
    const resp = await getUpdates({
      baseUrl: session.baseUrl,
      token: session.token,
      getUpdatesBuf: session.getUpdatesBuf,
      timeoutMs: 25_000,
    });

    if (resp.errcode === -14) {
      session = null;
      return c.json({ error: "会话已过期", expired: true }, 401);
    }

    processMessages(resp);

    const newMsgs = session.messages.filter((m) => m.id > since);
    return c.json({ messages: newMsgs });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.post("/api/send", async (c) => {
  if (!session) return c.json({ error: "未登录" }, 401);

  const body = await c.req.json<{ userId: string; text: string }>();
  if (!body.userId || !body.text) {
    return c.json({ error: "缺少 userId 或 text" }, 400);
  }

  const contextToken = session.contextTokens.get(body.userId);
  if (!contextToken) {
    return c.json({ error: "该用户尚未发送过消息，无法回复" }, 400);
  }

  try {
    await sendTextMessage({
      baseUrl: session.baseUrl,
      token: session.token,
      toUserId: body.userId,
      text: body.text,
      contextToken,
    });

    const sentMsg: StoredMessage = {
      id: session.nextId++,
      fromUserId: session.accountId,
      toUserId: body.userId,
      text: body.text,
      messageType: 2,
      createTimeMs: Date.now(),
    };
    session.messages.push(sentMsg);

    return c.json({ ok: true, message: sentMsg });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.get("/api/users", (c) => {
  if (!session) return c.json({ error: "未登录" }, 401);

  const users = [...session.contextTokens.keys()].map((userId) => ({
    userId,
    lastMessageTime: session!.lastMessageTime.get(userId) ?? 0,
  }));

  return c.json({ users });
});

export default app;
