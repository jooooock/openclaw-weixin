/**
 * 微信机器人最小可运行 Demo — 支持主动发送消息
 *
 * 用法:
 *   cd demo && npm install && npm start
 *
 * 流程:
 *   1. 生成二维码 → 微信扫码登录
 *   2. 后台长轮询接收用户消息，自动缓存 context_token
 *   3. 终端交互式输入，主动给用户发消息
 *
 * 交互命令:
 *   /list              — 查看所有可发送消息的用户
 *   /send <序号> <消息> — 主动给用户发消息
 *   /reply <消息>      — 回复最近一个发消息给你的用户
 *   /help              — 显示帮助
 *   Ctrl+C             — 退出
 */
import readline from "node:readline";
import qrterm from "qrcode-terminal";
import {
  fetchQRCode,
  pollQRStatus,
  getUpdates,
  sendTextMessage,
  MessageItemType,
  type WeixinMessage,
} from "./weixin-api.js";

const BASE_URL = "https://ilinkai.weixin.qq.com";

// ---------------------------------------------------------------------------
// 全局状态
// ---------------------------------------------------------------------------

/** userId -> contextToken */
const contextTokens = new Map<string, string>();
/** userId -> 最后消息时间 */
const lastMessageTime = new Map<string, number>();
/** 最近发消息的用户 */
let lastFromUser = "";

// ---------------------------------------------------------------------------
// Step 1: 扫码登录
// ---------------------------------------------------------------------------

async function login(): Promise<{ token: string; accountId: string; baseUrl: string }> {
  console.log("正在获取登录二维码...\n");
  const qr = await fetchQRCode(BASE_URL);
    console.log(qr)

  qrterm.generate(qr.qrcode_img_content, { small: true });
  console.log(`\n如果二维码无法显示，请在浏览器打开:\n${qr.qrcode_img_content}\n`);

  console.log("等待微信扫码...");
  while (true) {
    const status = await pollQRStatus(BASE_URL, qr.qrcode);
      console.log(status)
    switch (status.status) {
      case "wait":
        process.stdout.write(".");
        break;
      case "scaned":
        console.log("\n已扫码，请在微信确认...");
        break;
      case "confirmed":
        console.log("\n登录成功!");
        console.log(`  accountId: ${status.ilink_bot_id}`);
        console.log(`  userId:    ${status.ilink_user_id}\n`);
        return {
          token: status.bot_token!,
          accountId: status.ilink_bot_id!,
          baseUrl: status.baseurl || BASE_URL,
        };
      case "expired":
        console.error("\n二维码已过期，请重新运行");
        process.exit(1);
    }
    await sleep(1000);
  }
}

// ---------------------------------------------------------------------------
// Step 2: 后台消息监听（不阻塞主线程）
// ---------------------------------------------------------------------------

async function messageLoop(token: string, baseUrl: string): Promise<void> {
  let buf = "";

  while (true) {
    try {
      const resp = await getUpdates({ baseUrl, token, getUpdatesBuf: buf });

      if (resp.get_updates_buf) buf = resp.get_updates_buf;

      if (resp.errcode === -14) {
        console.error("\nSession 已过期 (errcode -14)，请重新登录");
        process.exit(1);
      }

      if (!resp.msgs?.length) continue;

      for (const msg of resp.msgs) {
        if (msg.message_type !== 1) continue;

        const fromUser = msg.from_user_id;
        if (!fromUser) continue;

        // 缓存 context_token
        if (msg.context_token) {
          contextTokens.set(fromUser, msg.context_token);
        }
        lastMessageTime.set(fromUser, Date.now());
        lastFromUser = fromUser;

        const text = extractText(msg);
        console.log(`\n[收到] from=${fromUser}  text="${text}"`);
        process.stdout.write("> ");
      }
    } catch (err) {
      console.error("\ngetUpdates 出错:", (err as Error).message);
      await sleep(3000);
    }
  }
}

// ---------------------------------------------------------------------------
// Step 3: 交互式终端 — 主动发消息
// ---------------------------------------------------------------------------

function startCLI(token: string, baseUrl: string): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  printHelp();
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    if (input === "/help") {
      printHelp();
    } else if (input === "/list") {
      printUserList();
    } else if (input.startsWith("/send ")) {
      await handleSendCommand(input, token, baseUrl);
    } else if (input.startsWith("/reply ")) {
      await handleReplyCommand(input, token, baseUrl);
    } else {
      // 快捷方式：直接输入文本 = /reply 文本
      if (lastFromUser && contextTokens.has(lastFromUser)) {
        await doSend(token, baseUrl, lastFromUser, input);
      } else {
        console.log("暂无可回复的用户，等待用户先发一条消息，或用 /send <序号> <消息>");
      }
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\n再见!");
    process.exit(0);
  });
}

function printHelp(): void {
  console.log(`
╔══════════════════════════════════════════════════╗
║  微信机器人 Demo — 交互命令                       ║
╠══════════════════════════════════════════════════╣
║  /list              查看所有可发送消息的用户        ║
║  /send <序号> <消息> 主动给指定用户发消息           ║
║  /reply <消息>      回复最近一个发消息的用户         ║
║  <直接输入文本>      等同于 /reply                  ║
║  /help              显示此帮助                     ║
║  Ctrl+C             退出                          ║
╚══════════════════════════════════════════════════╝

注意: 只有用户先给你发过消息后，才能主动给 TA 发消息 (需要 context_token)
`);
}

function printUserList(): void {
  if (contextTokens.size === 0) {
    console.log("暂无用户，等待用户发送第一条消息...");
    return;
  }
  console.log("\n可发送消息的用户:");
  let i = 1;
  for (const [userId] of contextTokens) {
    const lastTime = lastMessageTime.get(userId);
    const timeStr = lastTime ? new Date(lastTime).toLocaleTimeString() : "?";
    const marker = userId === lastFromUser ? " ← 最近" : "";
    console.log(`  [${i}] ${userId}  (最后消息: ${timeStr})${marker}`);
    i++;
  }
  console.log();
}

async function handleSendCommand(input: string, token: string, baseUrl: string): Promise<void> {
  // /send 1 你好
  const match = input.match(/^\/send\s+(\d+)\s+(.+)$/);
  if (!match) {
    console.log("格式: /send <序号> <消息>  (先用 /list 查看序号)");
    return;
  }

  const index = parseInt(match[1], 10);
  const text = match[2];
  const users = [...contextTokens.keys()];

  if (index < 1 || index > users.length) {
    console.log(`无效序号，当前共 ${users.length} 个用户`);
    return;
  }

  const userId = users[index - 1];
  await doSend(token, baseUrl, userId, text);
}

async function handleReplyCommand(input: string, token: string, baseUrl: string): Promise<void> {
  const text = input.slice("/reply ".length).trim();
  if (!text) {
    console.log("格式: /reply <消息>");
    return;
  }
  if (!lastFromUser || !contextTokens.has(lastFromUser)) {
    console.log("暂无可回复的用户，等待用户先发一条消息");
    return;
  }
  await doSend(token, baseUrl, lastFromUser, text);
}

async function doSend(token: string, baseUrl: string, userId: string, text: string): Promise<void> {
  const contextToken = contextTokens.get(userId);
  if (!contextToken) {
    console.log(`用户 ${userId} 的 context_token 不存在，无法发送`);
    return;
  }

  try {
    await sendTextMessage({ baseUrl, token, toUserId: userId, text, contextToken });
    console.log(`[已发送] to=${userId}  text="${text}"`);
  } catch (err) {
    console.error(`发送失败: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(msg: WeixinMessage): string {
  if (!msg.item_list?.length) return "";
  for (const item of msg.item_list) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      return item.text_item.text;
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return `[语音] ${item.voice_item.text}`;
    }
    if (item.type === MessageItemType.IMAGE) return "[图片]";
    if (item.type === MessageItemType.VIDEO) return "[视频]";
    if (item.type === MessageItemType.FILE) return `[文件] ${item.file_item?.file_name ?? ""}`;
  }
  return "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { token, baseUrl } = await login();

  // 后台启动消息监听
  messageLoop(token, baseUrl);

  // 前台启动交互式终端
  startCLI(token, baseUrl);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
