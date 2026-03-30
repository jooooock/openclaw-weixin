<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getSession } from "./api/client";
import QRLogin from "./components/QRLogin.vue";
import ChatView from "./components/ChatView.vue";

const loggedIn = ref(false);
const accountId = ref("");

onMounted(async () => {
  try {
    const s = await getSession();
    if (s.loggedIn) {
      loggedIn.value = true;
      accountId.value = s.accountId ?? "";
    }
  } catch {
    // 未登录
  }
});

function onLoginSuccess(id: string) {
  accountId.value = id;
  loggedIn.value = true;
}
</script>

<template>
  <div class="app">
    <ChatView v-if="loggedIn" :accountId="accountId" />
    <QRLogin v-else @success="onLoginSuccess" />
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
}
</style>
