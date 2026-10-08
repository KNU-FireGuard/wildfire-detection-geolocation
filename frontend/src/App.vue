<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import DashboardIcon from './components/DashboardIcon.vue'
import EventList from './components/EventList.vue'
import MonitoringMap from './components/MonitoringMap.vue'
import EventDetail from './components/EventDetail.vue'
import { fetchCameras, fetchEvents } from './api/catalog'
import { cameras as mockCameras } from './mocks/cameras'
import { events as mockEvents } from './mocks/events'

// 데이터 공급 모드를 명시적으로 선택합니다. API 실패 시 mock으로 자동 대체하지 않습니다.
const dataSource = import.meta.env.VITE_DATA_SOURCE ?? 'mock'
const cameras = ref([])
const events = ref([])
const selectedEventId = ref(null)
const isLoading = ref(true)
const loadError = ref('')
const now = ref(new Date())
let requestController
let clockInterval
const clock = computed(() => now.value.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }))
const selectedEvent = computed(() => events.value.find(event => event.id === selectedEventId.value) ?? null)
const selectedCamera = computed(() => cameras.value.find(camera => camera.id === selectedEvent.value?.cameraId) ?? null)
const onlineCount = computed(() => cameras.value.some(camera => camera.status != null)
  ? cameras.value.filter(camera => camera.status === 'ONLINE').length : '—')
const locatedCount = computed(() => events.value.filter(event => event.estimatedLocation != null).length)
const pendingCount = computed(() => events.value.some(event => event.status != null)
  ? events.value.filter(event => event.status === 'UNCONFIRMED').length : '—')
function selectEvent(id) {
  selectedEventId.value = id
}
function applyData(nextCameras, nextEvents) {
  cameras.value = nextCameras
  events.value = nextEvents
  selectedEventId.value = nextEvents.some(event => event.id === selectedEventId.value)
    ? selectedEventId.value : nextEvents[0]?.id ?? null
}
async function loadData() {
  isLoading.value = true
  loadError.value = ''
  if (dataSource === 'mock') {
    applyData(mockCameras, mockEvents)
    isLoading.value = false
    return
  }
  if (dataSource !== 'api') {
    loadError.value = 'VITE_DATA_SOURCE는 mock 또는 api로 설정해주세요.'
    isLoading.value = false
    return
  }
  const controller = new AbortController()
  requestController = controller
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const [nextCameras, nextEvents] = await Promise.all([
      fetchCameras({ signal: controller.signal }),
      fetchEvents({ signal: controller.signal }),
    ])
    applyData(nextCameras, nextEvents)
  } catch (error) {
    loadError.value = controller.signal.aborted
      ? '조회 시간이 초과되었습니다. Backend 서버 연결을 확인하고 다시 시도해주세요.'
      : error.message
    controller.abort()
    cameras.value = []
    events.value = []
    selectedEventId.value = null
  } finally {
    clearTimeout(timeout)
    isLoading.value = false
  }
}
onMounted(() => {
  loadData()
  clockInterval = setInterval(() => { now.value = new Date() }, 1000)
})
onBeforeUnmount(() => {
  requestController?.abort()
  clearInterval(clockInterval)
})
</script>

<template>
  <a class="skip-link" href="#dashboard-main">본문으로 이동</a>
  <div class="app-shell">
    <aside class="sidebar" aria-label="주 메뉴">
      <a class="brand" href="#dashboard-main">
        <DashboardIcon name="fire" :size="42" />
        <span><strong>FireGuard AI</strong><small>산불 탐지 관제 시스템</small></span>
      </a>
      <nav class="navigation">
        <a href="#dashboard-main" class="nav-item active" aria-current="page"><DashboardIcon name="home" /><span>대시보드</span></a>
        <button class="nav-item" disabled title="추후 제공 예정"><DashboardIcon name="camera" /><span>실시간 모니터링</span></button>
        <a href="#events-panel" class="nav-item"><DashboardIcon name="bell" /><span>탐지 이벤트</span></a>
        <button class="nav-item" disabled title="추후 제공 예정"><DashboardIcon name="monitor" /><span>CCTV 관리</span></button>
        <button class="nav-item" disabled title="추후 제공 예정"><DashboardIcon name="chart" /><span>통계 분석</span></button>
        <button class="nav-item" disabled title="추후 제공 예정"><DashboardIcon name="settings" /><span>관리자 설정</span></button>
      </nav>
      <div class="sidebar-footer">
        <span class="area-label">MONITORING AREA</span>
        <strong>팔공산 관제 구역</strong>
        <span><i class="status-dot" />{{ dataSource === 'mock' ? '데모 모드' : 'API 모드' }}</span>
      </div>
    </aside>

    <div id="dashboard-main" class="dashboard-content">
      <header class="dashboard-header">
        <div><h1>산불로부터 안전한 대한민국</h1><p>AI가 더 빠르게, 더 안전하게 지켜줍니다.</p></div>
        <div class="header-tools">
          <time class="live-clock" :datetime="now.toISOString()">{{ clock }}</time>
          <span class="user-profile"><span class="avatar"><DashboardIcon name="user" :size="20" /></span>admin</span>
        </div>
      </header>
      <div class="workspace-heading"><span>실시간 관제 현황</span><span class="mode-badge">{{ dataSource === 'mock' ? '데모 데이터' : 'Backend 데이터' }}</span></div>
      <p v-if="isLoading" class="load-status" role="status">카메라와 탐지 이벤트를 불러오는 중입니다.</p>
      <div v-else-if="loadError" class="load-status" role="alert"><p>{{ loadError }}</p><button class="primary-button" @click="loadData">다시 시도</button></div>
      <template v-else>
        <section class="summary-grid" aria-label="관제 요약">
          <article class="summary-card"><span class="summary-icon red"><DashboardIcon name="fire" :size="29" /></span><div><p>탐지 이벤트</p><strong>{{ events.length }}<small>건</small></strong></div></article>
          <article class="summary-card"><span class="summary-icon blue"><DashboardIcon name="camera" :size="29" /></span><div><p>운영 중인 CCTV</p><strong>{{ onlineCount }}<small>대 <span class="metric-total">/ {{ cameras.length }}</span></small></strong></div></article>
          <article class="summary-card"><span class="summary-icon amber"><DashboardIcon name="target" :size="29" /></span><div><p>위치 추정 완료</p><strong>{{ locatedCount }}<small>건</small></strong></div></article>
          <article class="summary-card"><span class="summary-icon green"><DashboardIcon name="clock" :size="29" /></span><div><p>확인 대기 이벤트</p><strong>{{ pendingCount }}<small>건</small></strong></div></article>
        </section>
        <main class="dashboard-grid">
          <MonitoringMap class="map-panel" :cameras="cameras" :events="events" :selected-event="selectedEvent" :selected-camera="selectedCamera" @select="selectEvent" />
          <EventDetail class="detail-panel" :event="selectedEvent" :camera="selectedCamera" />
          <EventList id="events-panel" class="events-panel" :events="events" :cameras="cameras" :selected-id="selectedEventId" @select="selectEvent" />
        </main>
      </template>
      <footer class="dashboard-footer"><span>FireGuard AI · 산불 탐지 및 위치 추정</span><span>{{ dataSource === 'mock' ? '화면의 좌표와 탐지 결과는 개발용 예시입니다.' : 'Backend 조회 데이터 기준' }}</span></footer>
    </div>
  </div>
</template>

<style scoped>
.app-shell { min-height: 100vh; display: grid; grid-template-columns: 220px minmax(0, 1fr); }
.sidebar { background: #202c38; color: #e6edf5; padding: 24px 12px; display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; }
.brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: white; padding: 0 7px; margin-bottom: 40px; }
.brand > svg { color: #ff5145; flex-shrink: 0; }
.brand strong { display: block; font-size: 21px; letter-spacing: -.6px; }
.brand small { display: block; margin-top: 5px; color: #b9c5d3; font-size: 12px; }
.navigation { display: grid; gap: 9px; }
.nav-item { display: flex; width: 100%; align-items: center; gap: 15px; padding: 16px 14px; border: 0; border-radius: 6px; background: transparent; color: #dce5ef; text-decoration: none; font-size: 16px; text-align: left; }
.nav-item svg { flex-shrink: 0; }
.nav-item.active { background: #294762; color: #fff; box-shadow: inset 3px 0 #4196ef; }
.nav-item:not(:disabled):hover { background: #294762; }
.nav-item:disabled { cursor: not-allowed; color: #9daab9; }
.sidebar-footer { margin-top: auto; padding: 24px 14px 6px; display: grid; gap: 10px; border-top: 1px solid #ffffff12; font-size: 12px; color: #9fafc1; }
.sidebar-footer strong { font-size: 14px; color: #e6edf5; font-weight: 500; }
.area-label { font-size: 9px; letter-spacing: 1.8px; }
.status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #50ceac; margin-right: 7px; }
.dashboard-content { padding: 26px 28px 18px; max-width: 1740px; width: 100%; margin: 0 auto; }
.dashboard-header { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 22px; }
h1 { margin: 0 0 6px; font-size: clamp(23px, 2vw, 30px); letter-spacing: -1.1px; font-weight: 800; }
.dashboard-header p { margin: 0; color: #65748a; font-size: 15px; }
.header-tools { display: flex; align-items: center; gap: 22px; color: #627087; font-size: 13px; white-space: nowrap; }
.live-clock { font-variant-numeric: tabular-nums; }
.user-profile { display: flex; align-items: center; gap: 10px; border-left: 1px solid #e2e7ef; padding-left: 20px; }
.avatar { display: grid; place-items: center; width: 31px; height: 31px; border-radius: 50%; color: white; background: #627087; }
.workspace-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; color: #68788e; font-size: 12px; }
.mode-badge { border: 1px solid #dce5f0; background: #edf3fa; color: #567597; border-radius: 5px; padding: 4px 8px; font-size: 11px; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
.summary-card { display: flex; gap: 18px; align-items: center; background: white; padding: 21px 20px; border-radius: 8px; box-shadow: 0 3px 14px #20334d04; border: 1px solid #edf1f6; }
.summary-icon { display: grid; place-items: center; width: 57px; height: 57px; flex-shrink: 0; border-radius: 50%; }
.red { color: #ff514b; background: #fff0f0; }.blue { color: #337fc8; background: #eaf4ff; }.amber { color: #e8a423; background: #fff5e2; }.green { color: #20b57a; background: #e6f7ed; }
.summary-card p { font-size: 13px; color: #65738a; margin: 0 0 6px; }
.summary-card strong { display: block; font-size: 29px; letter-spacing: -.9px; font-variant-numeric: tabular-nums; line-height: 1.2; }
.summary-card small { font-size: 16px; margin-left: 7px; }.metric-total { color: #a0adbd; font-weight: 400; font-size: 12px; }
.dashboard-grid { display: grid; grid-template-columns: minmax(0, 1.9fr) minmax(320px, 1fr); gap: 16px; align-items: start; }
.map-panel { grid-column: 1; grid-row: 1; }.events-panel { grid-column: 1; grid-row: 2; scroll-margin-top: 20px; }.detail-panel { grid-column: 2; grid-row: 1 / span 2; }
.dashboard-grid > * { min-width: 0; }
.load-status { padding: 26px; background: white; border-radius: 8px; color: #65748a; }
.dashboard-footer { display: flex; justify-content: space-between; gap: 12px; color: #93a0b1; font-size: 10px; margin-top: 20px; }
@media (min-width: 1600px) { .dashboard-content { padding: 30px 36px; }.sidebar { padding-top: 30px; } }
@media (max-width: 1200px) { .app-shell { grid-template-columns: 188px minmax(0, 1fr); }.brand strong { font-size: 18px; }.brand > svg { width: 32px; }.nav-item { gap: 10px; font-size: 14px; }.dashboard-content { padding: 22px 18px; }.header-tools { gap: 10px; }.live-clock { display: none; }.summary-card { padding: 16px 12px; gap: 10px; }.summary-icon { width: 42px; height: 42px; }.summary-card p { font-size: 11px; }.dashboard-grid { grid-template-columns: minmax(0, 1.5fr) minmax(290px, 1fr); } }
@media (max-width: 960px) { .app-shell { grid-template-columns: 72px minmax(0, 1fr); }.sidebar { padding: 20px 9px; }.brand { padding: 0; justify-content: center; }.brand span, .nav-item span, .sidebar-footer { display: none; }.brand > svg { width: 37px; }.nav-item { padding: 15px; justify-content: center; }.dashboard-grid { grid-template-columns: minmax(0, 1fr); }.map-panel { grid-column: 1; grid-row: 1; }.events-panel { grid-column: 1; grid-row: 2; }.detail-panel { grid-column: 1; grid-row: 3; } }
@media (max-width: 600px) { .dashboard-content { padding: 18px 12px; }.dashboard-header { align-items: start; }.dashboard-header h1 { font-size: 20px; letter-spacing: -.7px; }.dashboard-header p { font-size: 11px; }.user-profile { padding-left: 0; border: 0; font-size: 0; }.summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }.summary-card strong { font-size: 24px; }.summary-card small { font-size: 12px; }.summary-icon { width: 33px; height: 33px; }.summary-icon svg { width: 21px; }.summary-card { padding: 14px 10px; }.summary-card p { font-size: 10px; }.dashboard-footer { flex-direction: column; }.app-shell { grid-template-columns: 58px minmax(0, 1fr); }.sidebar { padding-left: 6px; padding-right: 6px; }.nav-item { padding: 14px 10px; } }
</style>
