<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from "vue";
import QRCode from "qrcode";
import { fetchQRCode, pollQRStatus } from "../api/client";

const emit = defineEmits<{ success: [accountId: string] }>();

const qrcodeReady = ref(false);
const qrcodeCanvas = ref<HTMLCanvasElement>();
const statusText = ref("正在获取二维码...");
const error = ref("");
let polling = true;

async function startLogin() {
  error.value = "";
  statusText.value = "正在获取二维码...";
  qrcodeReady.value = false;

  try {
    const qr = await fetchQRCode();
    qrcodeReady.value = true;
    statusText.value = "请用微信扫描二维码";
    await nextTick();
    if (qrcodeCanvas.value) {
      await QRCode.toCanvas(qrcodeCanvas.value, qr.qrcode_img_content, { width: 240, margin: 2 });
    }

    // 开始轮询
    while (polling) {
      const status = await pollQRStatus(qr.qrcode);
      switch (status.status) {
        case "wait":
          break;
        case "scaned":
          statusText.value = "已扫码，请在微信确认...";
          break;
        case "confirmed":
          statusText.value = "登录成功!";
          emit("success", status.accountId ?? "");
          return;
        case "expired":
          statusText.value = "二维码已过期";
          error.value = "expired";
          return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (err) {
    statusText.value = "获取二维码失败";
    error.value = (err as Error).message;
  }
}

onMounted(() => {
  polling = true;
  startLogin();
});

onUnmounted(() => {
  polling = false;
});
</script>

<template>
  <div class="login-container">
    <div class="login-card">
      <h1 class="title">微信机器人 Demo</h1>
      <div v-if="qrcodeReady" class="qrcode-wrap">
        <canvas ref="qrcodeCanvas"></canvas>
      </div>
      <div v-else class="qrcode-placeholder">
        <div class="spinner"></div>
      </div>
      <p class="status">{{ statusText }}</p>
      <button v-if="error === 'expired'" class="retry-btn" @click="startLogin">
        重新获取二维码
      </button>
    </div>
  </div>
</template>

<style scoped>
.login-container {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ededed;
}
.login-card {
  background: #fff;
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  min-width: 360px;
}
.title {
  font-size: 22px;
  font-weight: 600;
  color: #333;
  margin-bottom: 24px;
}
.qrcode-wrap {
  margin: 0 auto 16px;
}
.qrcode-img {
  width: 240px;
  height: 240px;
  border-radius: 8px;
}
.qrcode-placeholder {
  width: 240px;
  height: 240px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  border-radius: 8px;
}
.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #ddd;
  border-top-color: #07c160;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.status {
  color: #666;
  font-size: 14px;
  margin-bottom: 16px;
}
.retry-btn {
  background: #07c160;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 10px 24px;
  font-size: 14px;
  cursor: pointer;
}
.retry-btn:hover {
  background: #06ad56;
}
</style>
