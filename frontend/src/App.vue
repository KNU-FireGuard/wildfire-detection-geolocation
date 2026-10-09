<script setup>
import DashboardIcon from './components/DashboardIcon.vue'
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { accessToken, admin, logout } from './auth'
const route = useRoute(), router = useRouter()
watch(accessToken, token => {
  if (!token && route.meta.requiresAuth) router.replace({ path: '/login', query: { redirect: route.fullPath } })
})
const links = [
  { to: '/', label: '대시보드', icon: 'home' },
  { to: '/cameras', label: '카메라 목록', icon: 'camera' },
  { to: '/videos', label: '영상 목록', icon: 'monitor' },
  { to: '/events', label: '탐지 이벤트', icon: 'bell' },
  { to: '/sms-recipients', label: 'SMS 수신자', icon: 'user' },
]
</script>
<template>
  <a class="skip-link" href="#main-content">본문으로 이동</a>
  <div class="app-shell">
    <aside class="sidebar" aria-label="주 메뉴">
      <RouterLink class="brand" to="/"><DashboardIcon name="fire" :size="36" /><span><strong>FireGuard AI</strong><small>산불 탐지 관제 시스템</small></span></RouterLink>
      <nav><RouterLink v-for="link in links" :key="link.to" :to="link.to" class="nav-item" :class="{ active: link.to === '/' ? $route.path === '/' : $route.path.startsWith(link.to) }"><DashboardIcon :name="link.icon" /><span>{{ link.label }}</span></RouterLink></nav>
      <div class="account"><template v-if="admin"><p>{{ admin.username }}</p><button class="nav-item" @click="logout" aria-label="로그아웃"><DashboardIcon name="user" /><span>로그아웃</span></button></template><RouterLink v-else to="/login" class="nav-item" aria-label="관리자 로그인"><DashboardIcon name="user" /><span>관리자 로그인</span></RouterLink></div>
    </aside>
    <main id="main-content" class="page-content"><RouterView /></main>
  </div>
</template>
<style scoped>
.app-shell { min-height: 100vh; display: grid; grid-template-columns: 220px minmax(0, 1fr); }
.sidebar { background: #202c38; color: #e6edf5; padding: 24px 12px; position: sticky; top: 0; height: 100vh; }
.brand { display: flex; align-items: center; gap: 10px; color: white; text-decoration: none; margin-bottom: 40px; }
.brand svg { color: #ff5145; }.brand strong { font-size: 20px; }.brand small { display: block; margin-top: 6px; font-size: 12px; color: #b9c5d3; }
nav { display: grid; gap: 9px; }.nav-item { display: flex; align-items: center; gap: 14px; padding: 16px 14px; border-radius: 6px; text-decoration: none; }
.account { margin-top: 24px; border-top: 1px solid #ffffff22; padding-top: 12px; }.account p { overflow-wrap: anywhere; font-size: 12px; }.account button { width: 100%; background: transparent; border: 0; color: inherit; font: inherit; cursor: pointer; }
.nav-item.active, .nav-item:hover { background: #294762; }.nav-item.active { box-shadow: inset 3px 0 #4196ef; }
.page-content { min-width: 0; }.page-content :deep(.catalog-page) { padding: 26px 28px; max-width: 1740px; margin: auto; }
@media (max-width: 960px) { .app-shell { grid-template-columns: 72px minmax(0, 1fr); }.brand span, .nav-item span { display: none; }.brand, .nav-item { justify-content: center; }.nav-item { padding: 15px 0; } }
@media (max-width: 600px) { .page-content :deep(.catalog-page) { padding: 18px 12px; } }
</style>
