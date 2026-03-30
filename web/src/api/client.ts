import type { ChatMessage, ChatUser } from "../types";

export async function fetchQRCode(): Promise<{ qrcode: string; qrcode_img_content: string }> {
  const res = await fetch("/api/qrcode", { method: "POST" });
  if (!res.ok) throw new Error("获取二维码失败");
  return res.json();
}

export async function pollQRStatus(qrcode: string): Promise<{
  status: "wait" | "scaned" | "confirmed" | "expired";
  accountId?: string;
  userId?: string;
}> {
  const res = await fetch(`/api/qrcode/status?qrcode=${encodeURIComponent(qrcode)}`);
  if (!res.ok) throw new Error("轮询状态失败");
  return res.json();
}

export async function getSession(): Promise<{ loggedIn: boolean; accountId?: string }> {
  const res = await fetch("/api/session");
  return res.json();
}

export async function getMessages(since = 0): Promise<{ messages: ChatMessage[]; expired?: boolean }> {
  const res = await fetch(`/api/messages?since=${since}`);
  if (res.status === 401) {
    const data = await res.json();
    if (data.expired) return { messages: [], expired: true };
    throw new Error("未登录");
  }
  if (!res.ok) throw new Error("获取消息失败");
  return res.json();
}

export async function sendMessage(userId: string, text: string): Promise<ChatMessage> {
  const res = await fetch("/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, text }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "发送失败");
  }
  const data = await res.json();
  return data.message;
}

export async function getUsers(): Promise<ChatUser[]> {
  const res = await fetch("/api/users");
  if (!res.ok) return [];
  const data = await res.json();
  return data.users ?? [];
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST" });
}
