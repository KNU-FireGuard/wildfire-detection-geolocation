<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import DashboardIcon from '../components/DashboardIcon.vue'
import EventList from '../components/EventList.vue'
import MonitoringMap from '../components/MonitoringMap.vue'
import EventDetail from '../components/EventDetail.vue'
import { fetchCameras, fetchEvents, fetchVideos, fetchLiveCctvs, fetchLiveMonitorStatus, refreshLiveCctvs } from '../api/catalog'
import { cameras as mockCameras } from '../mocks/cameras'
import { events as mockEvents } from '../mocks/events'
import { retainSelection } from '../utils/dashboardSelection'

// 데이터 공급 모드를 명시적으로 선택합니다. API 실패 시 mock으로 자동 대체하지 않습니다.
const dataSource = import.meta.env.VITE_DATA_SOURCE ?? 'api'
const cameras = ref([])
const events = ref([])
const videos = ref([])
const selectedEventId = ref(null)
const selectedCameraId = ref(null)
const mapVisible = ref(true)
const isLoading = ref(true)
const loadError = ref('')
const refreshError = ref('')
const showCctvRefreshForm = ref(false)
const cctvRefreshBusy = ref(false)
const cctvRefreshMessage = ref('')
const cctvRefreshError = ref('')
const adminUsername = ref('')
const adminPassword = ref('')
const now = ref(new Date())
let requestController
let clockInterval
let refreshInterval
let loading = false
const clock = computed(() => now.value.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }))
const selectedEvent = computed(() => events.value.find(event => event.id === selectedEventId.value) ?? null)
const selectedCamera = computed(() => cameras.value.find(camera => camera.id === selectedCameraId.value)
  ?? cameras.value.find(camera => camera.id === selectedEvent.value?.cameraId) ?? null)
const onlineCount = computed(() => cameras.value.some(camera => camera.status != null)
  ? cameras.value.filter(camera => camera.status === 'ONLINE').length : '—')
const locatedCount = computed(() => events.value.filter(event => event.estimatedLocation != null).length)
const pendingCount = computed(() => events.value.some(event => event.status != null)
  ? events.value.filter(event => event.status === 'UNCONFIRMED').length : '—')
function selectEvent(id) {
  selectedCameraId.value = null
  selectedEventId.value = id
}
function selectCamera(id) {
  selectedCameraId.value = id
  const latest = events.value.filter(event => event.cameraId === id)
    .reduce((current, event) => !current || Date.parse(event.detectedAt) > Date.parse(current.detectedAt) ? event : current, null)
  selectedEventId.value = latest?.id ?? null
}
function applyData(nextCameras, nextEvents, nextVideos = []) {
  const selection = retainSelection(selectedCameraId.value, selectedEventId.value, nextCameras, nextEvents)
  cameras.value = nextCameras
  events.value = nextEvents
  videos.value = nextVideos
  selectedCameraId.value = selection.cameraId
  selectedEventId.value = selection.eventId
}
async function loadData({ silent = false } = {}) {
  if (loading) return
  loading = true
  if (!silent) {
    isLoading.value = true
    loadError.value = ''
  }
  if (dataSource === 'mock') {
    applyData(mockCameras, mockEvents)
    isLoading.value = false
    loading = false
    return
  }
  if (dataSource !== 'api') {
    loadError.value = 'VITE_DATA_SOURCE는 mock 또는 api로 설정해주세요.'
    isLoading.value = false
    loading = false
    return
  }
  const controller = new AbortController()
  requestController = controller
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const [nextCameras, nextEvents, nextVideos, live, monitor] = await Promise.all([
      fetchCameras({ signal: controller.signal }),
      fetchEvents({ signal: controller.signal }),
      fetchVideos({ signal: controller.signal }),
      fetchLiveCctvs({ signal: controller.signal }),
      fetchLiveMonitorStatus({ signal: controller.signal }),
    ])
    const states = new Map(monitor.cameras.map(item => [item.camera_id, item]))
    const liveCameras = live.cameras.map(camera => ({
      ...camera,
      monitorState: states.get(camera.id)?.state ?? 'unknown',
      lastFrameAt: states.get(camera.id)?.last_frame_at ?? null,
    }))
    applyData([...nextCameras.filter(camera => camera.sourceType !== 'live'), ...liveCameras], nextEvents, nextVideos)
    refreshError.value = ''
  } catch (error) {
    const message = controller.signal.aborted
      ? '조회 시간이 초과되었습니다. Backend 서버 연결을 확인하고 다시 시도해주세요.'
      : error.message
    controller.abort()
    if (silent) refreshError.value = `최신 상태를 가져오지 못했습니다. ${message}`
    else {
      loadError.value = message
      cameras.value = []
      events.value = []
      videos.value = []
      selectedEventId.value = null
      selectedCameraId.value = null
    }
  } finally {
    clearTimeout(timeout)
    isLoading.value = false
    loading = false
  }
}
async function refreshCctv() {
  if (cctvRefreshBusy.value) return
  cctvRefreshBusy.value = true
  cctvRefreshError.value = ''
  cctvRefreshMessage.value = ''
  try {
    await refreshLiveCctvs(adminUsername.value, adminPassword.value)
    showCctvRefreshForm.value = false
    cctvRefreshMessage.value = 'CCTV 주소를 갱신했습니다.'
    await loadData({ silent: true })
  } catch (error) {
    cctvRefreshError.value = error.message
  } finally {
    adminPassword.value = ''
    cctvRefreshBusy.value = false
  }
}
onMounted(() => {
  loadData()
  clockInterval = setInterval(() => { now.value = new Date() }, 1000)
  if (dataSource === 'api') refreshInterval = setInterval(() => {
    if (!document.hidden) loadData({ silent: true })
  }, 30000)
})
onBeforeUnmount(() => {
  requestController?.abort()
  clearInterval(clockInterval)
  clearInterval(refreshInterval)
})
</script>

<template>
    <div id="dashboard-main" class="dashboard-content">
      <header class="dashboard-header">
        <div><h1>산불로부터 안전한 대한민국</h1><p>AI가 더 빠르게, 더 안전하게 지켜줍니다.</p></div>
        <div class="header-tools">
          <time class="live-clock" :datetime="now.toISOString()">{{ clock }}</time>
          <span class="user-profile"><span class="avatar"><DashboardIcon name="user" :size="20" /></span>admin</span>
        </div>
      </header>
      <div class="workspace-heading"><span>실시간 관제 현황</span><div class="workspace-actions"><button type="button" class="cctv-refresh-button" :aria-expanded="mapVisible" aria-controls="monitoring-map" @click="mapVisible = !mapVisible">{{ mapVisible ? '지도 닫기' : '지도 열기' }}</button><button v-if="dataSource === 'api'" type="button" class="cctv-refresh-button" :aria-expanded="showCctvRefreshForm" aria-controls="cctv-refresh-form" @click="showCctvRefreshForm = !showCctvRefreshForm">CCTV 주소 갱신</button><span class="mode-badge">{{ dataSource === 'mock' ? '데모 데이터' : 'Backend 데이터' }}</span></div></div>
      <form v-if="showCctvRefreshForm && dataSource === 'api'" id="cctv-refresh-form" class="cctv-refresh-form" @submit.prevent="refreshCctv">
        <p>영상이 나오지 않을 때 관리자 계정으로 ITS CCTV 주소를 다시 조회합니다.</p>
        <label>관리자 ID <input v-model="adminUsername" name="username" autocomplete="username" required></label>
        <label>비밀번호 <input v-model="adminPassword" name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit" class="primary-button" :disabled="cctvRefreshBusy">{{ cctvRefreshBusy ? '갱신 중…' : '주소 다시 조회' }}</button>
      </form>
      <p v-if="cctvRefreshMessage" class="cctv-refresh-result" role="status">{{ cctvRefreshMessage }}</p>
      <p v-if="cctvRefreshError" class="refresh-error" role="alert">{{ cctvRefreshError }}</p>
      <p v-if="isLoading" class="load-status" role="status">카메라와 탐지 이벤트를 불러오는 중입니다.</p>
      <div v-else-if="loadError" class="load-status" role="alert"><p>{{ loadError }}</p><button class="primary-button" @click="loadData">다시 시도</button></div>
      <template v-else>
        <p v-if="refreshError" class="refresh-error" role="alert">{{ refreshError }}</p>
        <section class="dashboard-grid" :class="{ 'with-detail': selectedCamera || selectedEvent, 'map-hidden': !mapVisible }" aria-label="지도 및 탐지 현황">
          <MonitoringMap v-if="mapVisible" id="monitoring-map" class="map-panel" :cameras="cameras" :events="events" :selected-event="selectedEvent" :selected-camera="selectedCamera" @select-camera="selectCamera" />
          <EventDetail v-if="selectedCamera || selectedEvent" class="detail-panel" :event="selectedEvent" :camera="selectedCamera" :videos="videos" />
          <EventList id="events-panel" class="events-panel" :events="events" :cameras="cameras" :selected-id="selectedEventId" @select="selectEvent" />
        </section>
        <section class="summary-grid" aria-label="관제 요약">
          <article class="summary-card"><span class="summary-icon red"><DashboardIcon name="fire" :size="29" /></span><div><p>탐지 이벤트</p><strong>{{ events.length }}<small>건</small></strong></div></article>
          <article class="summary-card"><span class="summary-icon blue"><DashboardIcon name="camera" :size="29" /></span><div><p>운영 중인 CCTV</p><strong>{{ onlineCount }}<small>대 <span class="metric-total">/ {{ cameras.length }}</span></small></strong></div></article>
          <article class="summary-card"><span class="summary-icon amber"><DashboardIcon name="target" :size="29" /></span><div><p>위치 추정 완료</p><strong>{{ locatedCount }}<small>건</small></strong></div></article>
          <article class="summary-card"><span class="summary-icon green"><DashboardIcon name="clock" :size="29" /></span><div><p>확인 대기 이벤트</p><strong>{{ pendingCount }}<small>건</small></strong></div></article>
        </section>
      </template>
      <footer class="dashboard-footer"><span>FireGuard AI · 산불 탐지 및 위치 추정</span><span>{{ dataSource === 'mock' ? '화면의 좌표와 탐지 결과는 개발용 예시입니다.' : 'Backend 조회 데이터 기준' }}</span></footer>
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
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }
.summary-card { display: flex; gap: 10px; align-items: center; background: white; padding: 10px 12px; border-radius: 6px; border: 1px solid #edf1f6; }
.summary-icon { display: grid; place-items: center; width: 32px; height: 32px; flex-shrink: 0; border-radius: 6px; }.summary-icon svg { width: 18px; height: 18px; }
.red { color: #ff514b; background: #fff0f0; }.blue { color: #337fc8; background: #eaf4ff; }.amber { color: #e8a423; background: #fff5e2; }.green { color: #20b57a; background: #e6f7ed; }
.summary-card p { font-size: 11px; color: #65738a; margin: 0 0 3px; }
.summary-card strong { display: block; font-size: 18px; letter-spacing: -.4px; font-variant-numeric: tabular-nums; line-height: 1.2; }
.summary-card small { font-size: 11px; margin-left: 4px; }.metric-total { color: #a0adbd; font-weight: 400; font-size: 10px; }
.dashboard-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
.dashboard-grid.with-detail:not(.map-hidden) { grid-template-columns: minmax(0, 1.6fr) minmax(320px, .9fr); }
.map-panel { grid-column: 1; }.detail-panel { grid-column: 2; position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow-y: auto; }.events-panel { grid-column: 1 / -1; scroll-margin-top: 20px; }
.dashboard-grid.map-hidden .detail-panel { grid-column: 1; }
.dashboard-grid > * { min-width: 0; }
.load-status { padding: 26px; background: white; border-radius: 8px; color: #65748a; }
.refresh-error { margin: 0 0 12px; padding: 10px 12px; border-radius: 6px; background: #fff4e9; color: #915b19; font-size: 12px; }
.workspace-actions { display: flex; align-items: center; gap: 10px; }.cctv-refresh-button { border: 1px solid #cad8e8; border-radius: 5px; background: white; color: #376c9c; padding: 6px 10px; font-size: 12px; }.cctv-refresh-form { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; margin-bottom: 12px; padding: 14px; border: 1px solid #dce5f0; border-radius: 6px; background: white; }.cctv-refresh-form p { width: 100%; margin: 0; font-size: 12px; color: #65748a; }.cctv-refresh-form label { display: grid; gap: 4px; font-size: 12px; color: #536781; }.cctv-refresh-form input { padding: 9px; border: 1px solid #cad8e8; border-radius: 4px; }.cctv-refresh-form .primary-button { padding: 10px 14px; }.cctv-refresh-result { margin: 0 0 12px; padding: 10px 12px; border-radius: 6px; background: #eaf6ee; color: #277647; font-size: 12px; }
.dashboard-footer { display: flex; justify-content: space-between; gap: 12px; color: #93a0b1; font-size: 10px; margin-top: 20px; }
@media (min-width: 1600px) { .dashboard-content { padding: 30px 36px; }.sidebar { padding-top: 30px; } }
@media (max-width: 1200px) { .app-shell { grid-template-columns: 188px minmax(0, 1fr); }.brand strong { font-size: 18px; }.brand > svg { width: 32px; }.nav-item { gap: 10px; font-size: 14px; }.dashboard-content { padding: 22px 18px; }.header-tools { gap: 10px; }.live-clock { display: none; } }
@media (max-width: 960px) { .app-shell { grid-template-columns: 72px minmax(0, 1fr); }.sidebar { padding: 20px 9px; }.brand { padding: 0; justify-content: center; }.brand span, .nav-item span, .sidebar-footer { display: none; }.brand > svg { width: 37px; }.nav-item { padding: 15px; justify-content: center; } }
@media (max-width: 800px) { .dashboard-grid.with-detail:not(.map-hidden) { grid-template-columns: minmax(0, 1fr); }.detail-panel { grid-column: 1; position: static; max-height: none; overflow: visible; } }
@media (max-width: 600px) { .dashboard-content { padding: 18px 12px; }.dashboard-header { align-items: start; }.dashboard-header h1 { font-size: 20px; letter-spacing: -.7px; }.dashboard-header p { font-size: 11px; }.user-profile { padding-left: 0; border: 0; font-size: 0; }.summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }.summary-card { padding: 9px; }.dashboard-footer { flex-direction: column; }.app-shell { grid-template-columns: 58px minmax(0, 1fr); }.sidebar { padding-left: 6px; padding-right: 6px; }.nav-item { padding: 14px 10px; } }
</style>
