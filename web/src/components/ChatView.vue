<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from "vue";
import { getMessages, sendMessage, getUsers } from "../api/client";
import type { ChatMessage, ChatUser } from "../types";
import MessageBubble from "./MessageBubble.vue";

const props = defineProps<{ accountId: string }>();

const messages = ref<ChatMessage[]>([]);
const users = ref<ChatUser[]>([]);
const selectedUserId = ref("");
const inputText = ref("");
const messagesContainer = ref<HTMLElement>();
const sending = ref(false);
const expired = ref(false);
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout>;

function showToast(msg: string) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 3000);
}

let polling = true;
let lastId = 0;

const filteredMessages = computed(() => {
  if (!selectedUserId.value) return messages.value;
  return messages.value.filter(
    (m) => m.fromUserId === selectedUserId.value || m.toUserId === selectedUserId.value
  );
});

async function pollMessages() {
  while (polling) {
    try {
      const data = await getMessages(lastId);
      if (data.expired) {
        expired.value = true;
        return;
      }
      if (data.messages?.length) {
        for (const msg of data.messages) {
          if (msg.id > lastId) lastId = msg.id;
          if (!messages.value.some((m) => m.id === msg.id)) {
            messages.value.push(msg);
          }
        }
        refreshUsers();
        await nextTick();
        scrollToBottom();
      }
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function refreshUsers() {
  try {
    users.value = await getUsers();
    if (!selectedUserId.value && users.value.length > 0) {
      selectedUserId.value = users.value[0].userId;
    }
  } catch {
    // ignore
  }
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

async function handleSend() {
  const text = inputText.value.trim();
  if (!text || !selectedUserId.value || sending.value) return;

  sending.value = true;
  try {
    const msg = await sendMessage(selectedUserId.value, text);
    inputText.value = "";
    if (msg && !messages.value.some((m) => m.id === msg.id)) {
      messages.value.push(msg);
      if (msg.id > lastId) lastId = msg.id;
      await nextTick();
      scrollToBottom();
    }
  } catch (err) {
    showToast((err as Error).message);
  } finally {
    sending.value = false;
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

function formatUserId(id: string): string {
  if (id.length <= 12) return id;
  return id.slice(0, 4) + "..." + id.slice(-6);
}

function formatLastTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getLastMessage(userId: string): string {
  const userMsgs = messages.value.filter(
    (m) => m.fromUserId === userId || m.toUserId === userId
  );
  if (userMsgs.length === 0) return "";
  const last = userMsgs[userMsgs.length - 1];
  const prefix = last.messageType === 2 ? "[我] " : "";
  const text = last.text || "";
  return prefix + (text.length > 20 ? text.slice(0, 20) + "..." : text);
}

watch(selectedUserId, () => {
  nextTick(() => scrollToBottom());
});

onMounted(() => {
  polling = true;
  pollMessages();
  refreshUsers();
});

onUnmounted(() => {
  polling = false;
});
</script>

<template>
  <div class="chat-outer">
    <div class="chat-layout">
      <!-- 侧边栏 -->
      <div class="sidebar">
        <div class="sidebar-header">
          <span class="header-title">消息</span>
        </div>
        <div class="user-list">
          <div v-if="users.length === 0" class="no-users">
            <div class="no-users-icon">💬</div>
            <div>等待用户发送消息...</div>
          </div>
          <div
            v-for="user in users"
            :key="user.userId"
            class="user-item"
            :class="{ active: user.userId === selectedUserId }"
            @click="selectedUserId = user.userId"
          >
            <div class="user-avatar">{{ user.userId.slice(-2).toUpperCase() }}</div>
            <div class="user-detail">
              <div class="user-top-row">
                <span class="user-name">{{ formatUserId(user.userId) }}</span>
                <span class="user-time">{{ formatLastTime(user.lastMessageTime) }}</span>
              </div>
              <div class="user-preview">{{ getLastMessage(user.userId) }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 聊天区域 -->
      <div class="chat-main">
        <div class="chat-header">
          <template v-if="expired">
            <span class="expired-badge">会话已过期</span>
            <span class="expired-hint">请刷新页面重新登录</span>
          </template>
          <template v-else-if="selectedUserId">
            <span class="chat-title">{{ formatUserId(selectedUserId) }}</span>
          </template>
          <template v-else>
            <span class="chat-title">微信机器人 Demo</span>
          </template>
        </div>

        <div class="messages" ref="messagesContainer">
          <div v-if="!selectedUserId" class="empty-state">
            <div class="empty-icon">📱</div>
            <div class="empty-text">用户通过微信向机器人发送消息后<br/>将会在此处显示</div>
          </div>
          <div v-else-if="filteredMessages.length === 0" class="empty-state">
            <div class="empty-text">暂无消息</div>
          </div>
          <MessageBubble
            v-for="msg in filteredMessages"
            :key="msg.id"
            :message="msg"
            :isSelf="msg.messageType === 2"
          />
        </div>

        <div class="input-area" v-if="selectedUserId && !expired">
          <div class="input-wrap">
            <textarea
              v-model="inputText"
              class="input-box"
              placeholder="输入消息，Enter 发送"
              rows="3"
              @keydown="handleKeydown"
            ></textarea>
          </div>
          <div class="input-footer">
            <button class="send-btn" :disabled="!inputText.trim() || sending" @click="handleSend">
              发送(S)
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.chat-outer {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e3e3e3;
  padding: 24px;
}

.chat-layout {
  display: flex;
  width: 100%;
  max-width: 960px;
  height: 100%;
  max-height: 720px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
}

/* ====== 侧边栏 ====== */
.sidebar {
  width: 240px;
  background: #ebebeb;
  border-right: 1px solid #d6d6d6;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.sidebar-header {
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid #d6d6d6;
}
.header-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}
.user-list {
  flex: 1;
  overflow-y: auto;
}
.no-users {
  padding: 40px 16px;
  color: #999;
  font-size: 13px;
  text-align: center;
}
.no-users-icon {
  font-size: 28px;
  margin-bottom: 8px;
}
.user-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  cursor: pointer;
  gap: 10px;
}
.user-item:hover {
  background: #d9d9d9;
}
.user-item.active {
  background: #c4c4c4;
}
.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  background: #07c160;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}
.user-detail {
  flex: 1;
  min-width: 0;
}
.user-top-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 2px;
}
.user-name {
  font-size: 13px;
  color: #333;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-time {
  font-size: 10px;
  color: #b0b0b0;
  flex-shrink: 0;
  margin-left: 8px;
}
.user-preview {
  font-size: 11px;
  color: #999;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ====== 聊天主区 ====== */
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #f5f5f5;
}

.chat-header {
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  background: #f0f0f0;
  border-bottom: 1px solid #ddd;
  flex-shrink: 0;
}
.chat-title {
  font-size: 15px;
  font-weight: 500;
  color: #333;
}
.expired-badge {
  background: #fa5151;
  color: #fff;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 3px;
  margin-right: 8px;
}
.expired-hint {
  font-size: 13px;
  color: #999;
}

/* 消息区 */
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
  background: #ededed;
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #b0b0b0;
  font-size: 13px;
  line-height: 1.8;
  text-align: center;
}
.empty-icon {
  font-size: 36px;
  margin-bottom: 12px;
}

/* 输入区 */
.input-area {
  background: #f5f5f5;
  border-top: 1px solid #ddd;
  padding: 10px 16px 12px;
  flex-shrink: 0;
}
.input-wrap {
  margin-bottom: 8px;
}
.input-box {
  width: 100%;
  border: none;
  background: transparent;
  padding: 4px 0;
  font-size: 14px;
  resize: none;
  outline: none;
  font-family: inherit;
  line-height: 1.5;
  color: #333;
}
.input-box::placeholder {
  color: #c0c0c0;
}
.input-footer {
  display: flex;
  justify-content: flex-end;
}
.send-btn {
  background: #07c160;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 6px 18px;
  font-size: 13px;
  cursor: pointer;
}
.send-btn:hover:not(:disabled) {
  background: #06ae56;
}
.send-btn:disabled {
  background: #95ec69;
  color: rgba(255, 255, 255, 0.6);
  cursor: not-allowed;
}

/* Toast */
.toast {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  padding: 10px 24px;
  border-radius: 6px;
  font-size: 14px;
  z-index: 1000;
  pointer-events: none;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
}
</style>
