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
// 类型定义
// ---------------------------------------------------------------------------

type Env = {
  OPENCLAW_WEIXIN_SESSION: KVNamespace;
};

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

/** KV 中存储的持久化数据（只存关键字段） */
interface PersistedSession {
  token: string;
  baseUrl: string;
  accountId: string;
  getUpdatesBuf: string;
  contextTokens: Record<string, string>;
  nextId: number;
}

// ---------------------------------------------------------------------------
// 模块级状态（在同一 isolate 内跨请求持久化）
// ---------------------------------------------------------------------------

let session: Session | null = null;

const MAX_MESSAGES = 500;

// ---------------------------------------------------------------------------
// KV 持久化工具函数
// ---------------------------------------------------------------------------

async function loadSession(kv: KVNamespace | undefined): Promise<void> {
  if (session || !kv) return;
  try {
    const data = await kv.get<PersistedSession>("session", "json");
    if (data) {
      session = {
        token: data.token,
        baseUrl: data.baseUrl,
        accountId: data.accountId,
        getUpdatesBuf: data.getUpdatesBuf,
        contextTokens: new Map(Object.entries(data.contextTokens ?? {})),
        lastMessageTime: new Map(),
        seenMessageIds: new Set(),
        nextId: data.nextId ?? 1,
        messages: [],
      };
    }
  } catch {
    // KV 不可用时忽略（如本地开发未配置 KV）
  }
}

async function saveSession(kv: KVNamespace | undefined): Promise<void> {
  if (!session || !kv) return;
  const data: PersistedSession = {
    token: session.token,
    baseUrl: session.baseUrl,
    accountId: session.accountId,
    getUpdatesBuf: session.getUpdatesBuf,
    contextTokens: Object.fromEntries(session.contextTokens),
    nextId: session.nextId,
  };
  try {
    await kv.put("session", JSON.stringify(data));
  } catch {
    // 忽略写入失败
  }
}

async function clearSession(kv: KVNamespace | undefined): Promise<void> {
  session = null;
  try {
    await kv?.delete("session");
  } catch {
    // 忽略
  }
}

// ---------------------------------------------------------------------------
// 消息处理
// ---------------------------------------------------------------------------

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

function processMessages(resp: GetUpdatesResp): boolean {
  if (!session) return false;

  let changed = false;

  if (resp.get_updates_buf && resp.get_updates_buf !== session.getUpdatesBuf) {
    session.getUpdatesBuf = resp.get_updates_buf;
    changed = true;
  }

  if (!resp.msgs?.length) return changed;

  for (const msg of resp.msgs) {
    // 用 message_id 去重
    if (msg.message_id && session.seenMessageIds.has(msg.message_id)) continue;
    if (msg.message_id) session.seenMessageIds.add(msg.message_id);

    const fromUser = msg.from_user_id ?? "";
    const toUser = msg.to_user_id ?? "";

    if (msg.message_type === 1 && fromUser && msg.context_token) {
      session.contextTokens.set(fromUser, msg.context_token);
      session.lastMessageTime.set(fromUser, Date.now());
      changed = true;
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

  return changed;
}

// ---------------------------------------------------------------------------
// Hono 路由
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

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
      // 登录成功后立即持久化
      await saveSession(c.env.OPENCLAW_WEIXIN_SESSION);
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

app.get("/api/session", async (c) => {
  await loadSession(c.env.OPENCLAW_WEIXIN_SESSION);
  if (!session) return c.json({ loggedIn: false });
  return c.json({
    loggedIn: true,
    accountId: session.accountId,
  });
});

app.post("/api/logout", async (c) => {
  await clearSession(c.env.OPENCLAW_WEIXIN_SESSION);
  return c.json({ ok: true });
});

app.get("/api/messages", async (c) => {
  await loadSession(c.env.OPENCLAW_WEIXIN_SESSION);
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
      await clearSession(c.env.OPENCLAW_WEIXIN_SESSION);
      return c.json({ error: "会话已过期", expired: true }, 401);
    }

    const changed = processMessages(resp);
    // 有关键数据变更时持久化（getUpdatesBuf 或 contextTokens 更新）
    if (changed) {
      await saveSession(c.env.OPENCLAW_WEIXIN_SESSION);
    }

    const newMsgs = session.messages.filter((m) => m.id > since);
    return c.json({ messages: newMsgs });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.post("/api/send", async (c) => {
  await loadSession(c.env.OPENCLAW_WEIXIN_SESSION);
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

app.get("/api/users", async (c) => {
  await loadSession(c.env.OPENCLAW_WEIXIN_SESSION);
  if (!session) return c.json({ error: "未登录" }, 401);

  const users = [...session.contextTokens.keys()].map((userId) => ({
    userId,
    lastMessageTime: session!.lastMessageTime.get(userId) ?? 0,
  }));

  return c.json({ users });
});

export default app;
