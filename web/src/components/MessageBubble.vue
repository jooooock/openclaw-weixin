<script setup lang="ts">
import type { ChatMessage } from "../types";

defineProps<{
  message: ChatMessage;
  isSelf: boolean;
}>();

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
</script>

<template>
  <div class="msg-row" :class="{ self: isSelf }">
    <div class="avatar" :class="isSelf ? 'avatar-bot' : 'avatar-user'">
      <svg v-if="isSelf" class="avatar-icon" viewBox="0 0 24 24" fill="none">
        <!-- 机器人图标 -->
        <rect x="4" y="8" width="16" height="12" rx="3" stroke="currentColor" stroke-width="1.8"/>
        <circle cx="9" cy="14" r="1.5" fill="currentColor"/>
        <circle cx="15" cy="14" r="1.5" fill="currentColor"/>
        <path d="M12 3V8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <circle cx="12" cy="3" r="1.5" fill="currentColor"/>
      </svg>
      <svg v-else class="avatar-icon" viewBox="0 0 24 24" fill="none">
        <!-- 微信用户图标 -->
        <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.8"/>
        <path d="M4 20C4 16.6863 7.58172 14 12 14C16.4183 14 20 16.6863 20 20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    </div>
    <div class="bubble-wrap">
      <div class="bubble" :class="{ 'bubble-self': isSelf, 'bubble-other': !isSelf }">
        <span class="text">{{ message.text }}</span>
      </div>
      <div class="time">{{ formatTime(message.createTimeMs) }}</div>
    </div>
  </div>
</template>

<style scoped>
.msg-row {
  display: flex;
  align-items: flex-start;
  padding: 8px 16px;
  gap: 8px;
}
.msg-row.self {
  flex-direction: row-reverse;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.avatar-icon {
  width: 20px;
  height: 20px;
}
.avatar-bot {
  background: #5b9bd5;
  color: #fff;
}
.avatar-user {
  background: #07c160;
  color: #fff;
}

.bubble-wrap {
  max-width: 65%;
  min-width: 0;
}

.bubble {
  display: inline-block;
  padding: 9px 12px;
  border-radius: 4px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}
.bubble-self {
  background: #95ec69;
  color: #000;
}
.bubble-other {
  background: #fff;
  color: #000;
}

.msg-row.self .bubble-wrap {
  text-align: right;
}
.msg-row.self .bubble {
  text-align: left;
}

.time {
  font-size: 11px;
  color: #b0b0b0;
  margin-top: 3px;
}
.msg-row.self .time {
  text-align: right;
}
</style>
