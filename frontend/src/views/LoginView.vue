<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { signIn } from '../auth'
const username = ref(''), password = ref(''), busy = ref(false), error = ref('')
const route = useRoute(), router = useRouter()
async function submit() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    await signIn(username.value, password.value)
    const target = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') && !route.query.redirect.startsWith('//') ? route.query.redirect : '/'
    router.replace(target)
  } catch (cause) { error.value = cause.message } finally { busy.value = false; password.value = '' }
}
</script>
<template><div class="catalog-page"><h1>관리자 로그인</h1><form class="dashboard-panel login-form" @submit.prevent="submit"><label>아이디<input v-model="username" autocomplete="username" required maxlength="100" /></label><label>비밀번호<input v-model="password" type="password" autocomplete="current-password" required maxlength="256" /></label><p v-if="error" role="alert">{{ error }}</p><button class="primary-button" :disabled="busy">{{ busy ? '로그인 중…' : '로그인' }}</button></form></div></template>
<style scoped>.login-form { max-width: 440px; display: grid; gap: 18px; }label { display: grid; gap: 8px; }input { padding: 12px; border: 1px solid #ccd7e4; border-radius: 5px; }[role='alert'] { color: #b93434; }</style>
