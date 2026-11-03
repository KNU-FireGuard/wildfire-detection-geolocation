<script setup>
import DashboardIcon from './components/DashboardIcon.vue'
const links = [
  { to: '/', label: '대시보드', icon: 'home' },
  { to: '/cameras', label: '카메라 목록', icon: 'camera' },
  { to: '/videos', label: '영상 목록', icon: 'monitor' },
  { to: '/events', label: '탐지 이벤트', icon: 'bell' },
  { to: '/admin', label: '관리자', icon: 'settings' },
]
</script>
<template>
  <a class="skip-link" href="#main-content">본문으로 이동</a>
  <div class="app-shell">
    <aside class="sidebar" aria-label="주 메뉴">
      <RouterLink class="brand" to="/"><DashboardIcon name="fire" :size="36" /><span><strong>FireGuard AI</strong><small>산불 탐지 관제 시스템</small></span></RouterLink>
      <nav><RouterLink v-for="link in links" :key="link.to" :to="link.to" class="nav-item" :class="{ active: link.to === '/' ? $route.path === '/' : $route.path.startsWith(link.to) }"><DashboardIcon :name="link.icon" /><span>{{ link.label }}</span></RouterLink></nav>
    </aside>
    <main id="main-content" class="page-content"><RouterView /></main>
  </div>
</template>
<style scoped>
.app-shell { min-height: 100vh; display: grid; grid-template-columns: 220px minmax(0, 1fr); }
.sidebar { position: sticky; top: 0; height: 100vh; overflow: hidden; padding: 26px 14px; color: var(--text); background: linear-gradient(180deg, #0b131c, #070b11 72%); border-right: 1px solid var(--line); }
.sidebar::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 240px; background: radial-gradient(180px 130px at 30% 100%, rgba(255, 106, 87, 0.13), transparent 72%); pointer-events: none; }
.brand { display: flex; align-items: center; gap: 12px; padding: 0 6px; margin-bottom: 36px; color: var(--text); text-decoration: none; }
.brand svg { color: var(--fire); filter: drop-shadow(0 0 10px rgba(255, 106, 87, 0.55)); }
.brand strong { font-size: 18px; font-weight: 750; letter-spacing: -0.4px; }
.brand small { display: block; margin-top: 4px; font-size: 11px; color: var(--text-3); letter-spacing: 0.2px; }
nav { display: grid; gap: 6px; }
.nav-item { position: relative; display: flex; align-items: center; gap: 13px; padding: 12px 14px; border-radius: 10px; color: var(--text-2); font-size: 14px; font-weight: 500; text-decoration: none; transition: background 0.15s, color 0.15s; }
.nav-item:hover { background: var(--surface-2); color: var(--text); }
.nav-item.active { background: linear-gradient(90deg, rgba(85, 169, 255, 0.2), rgba(85, 169, 255, 0.03)); color: var(--text); }
.nav-item.active::before { content: ''; position: absolute; left: -14px; top: 10px; bottom: 10px; width: 3px; border-radius: 0 3px 3px 0; background: var(--accent); box-shadow: 0 0 14px var(--accent); }
.nav-item.active svg { color: var(--accent); }
.page-content { min-width: 0; }.page-content :deep(.catalog-page) { padding: 28px 30px; max-width: 1740px; margin: auto; }
@media (max-width: 960px) { .app-shell { grid-template-columns: 72px minmax(0, 1fr); }.brand span, .nav-item span { display: none; }.brand, .nav-item { justify-content: center; }.nav-item { padding: 14px 0; }.nav-item.active::before { left: -14px; } }
@media (max-width: 600px) { .page-content :deep(.catalog-page) { padding: 18px 12px; } }
</style>
