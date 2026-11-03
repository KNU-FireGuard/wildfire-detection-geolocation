<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import DashboardIcon from '../components/DashboardIcon.vue'
import EventList from '../components/EventList.vue'
import MonitoringMap from '../components/MonitoringMap.vue'
import FireAlertBanner from '../components/FireAlertBanner.vue'
import EventDetail from '../components/EventDetail.vue'
import LiveCctvWall from '../components/LiveCctvWall.vue'
import { fetchCameras, fetchEvents, fetchVideos, fetchLiveCctvs, fetchLiveMonitorStatus, loginAdmin, refreshLiveCctvs, acknowledgeEvent } from '../api/catalog'
import { ensureAdminToken, useAdminSession } from '../composables/useAdminSession'
import { cameras as mockCameras } from '../mocks/cameras'
import { events as mockEvents } from '../mocks/events'
import { retainSelection } from '../utils/dashboardSelection'
import { summarizeOperatingCameras } from '../utils/cameraSummary'
import { findRequestedCameraId } from '../utils/cameraLink'
import { activeFireCameraIds, findNewFireEvents } from '../utils/fireAlert'
import { playAlertTone } from '../utils/alertSound'

// 데이터 공급 모드를 명시적으로 선택합니다. API 실패 시 mock으로 자동 대체하지 않습니다.
const dataSource = import.meta.env.VITE_DATA_SOURCE ?? 'api'
const route = useRoute()
const cameras = ref([])
const events = ref([])
const videos = ref([])
const selectedEventId = ref(null)
const selectedCameraId = ref(null)
const mapVisible = ref(true)
const isLoading = ref(true)
const loadError = ref('')
const refreshError = ref('')
const { token: adminToken, isLoggedIn, signOut } = useAdminSession()
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
let linkApplied = false
let knownEventIds = null
const fireAlerts = ref([])
// 확인하지 않은 화재 카메라가 바뀔 때만 지도를 다시 그리도록 문자열 키를 거쳐 집합을 만듦
const fireKey = computed(() => [...activeFireCameraIds(events.value)].sort((a, b) => a - b).join(','))
const fireCameraIds = computed(() => new Set(fireKey.value ? fireKey.value.split(',').map(Number) : []))
function openFireAlert(id) {
  selectEvent(id)
  fireAlerts.value = []
}
// 이벤트 확인은 관리자만 할 수 있어 로그인하지 않았다면 로그인 입력을 먼저 보여줌
const ackWaitingIds = ref([])
const ackBusy = ref(false)
const ackError = ref('')
function acknowledge(ids) {
  ackError.value = ''
  const list = Array.isArray(ids) ? ids : [ids]
  if (dataSource === 'mock' || isLoggedIn.value) runAcknowledge(list)
  else ackWaitingIds.value = list
}
async function submitAckLogin() {
  if (ackBusy.value) return
  ackBusy.value = true
  ackError.value = ''
  try {
    await ensureAdminToken(loginAdmin, adminUsername.value, adminPassword.value)
  } catch (error) {
    ackError.value = error.message
    ackBusy.value = false
    adminPassword.value = ''
    return
  }
  adminPassword.value = ''
  ackBusy.value = false
  await runAcknowledge(ackWaitingIds.value)
}
async function runAcknowledge(ids) {
  ackBusy.value = true
  try {
    if (dataSource === 'api') for (const id of ids) await acknowledgeEvent(id, adminToken.value)
    events.value = events.value.map(event => ids.includes(event.id) ? { ...event, status: 'CONFIRMED' } : event)
    fireAlerts.value = fireAlerts.value.filter(event => !ids.includes(event.id))
    ackWaitingIds.value = []
    if (dataSource === 'api') await loadData({ silent: true })
  } catch (error) {
    ackError.value = error.message
    if (error.code === 'unauthorized') { signOut(); ackWaitingIds.value = ids }
  } finally {
    ackBusy.value = false
  }
}
const clock = computed(() => now.value.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }))
const selectedEvent = computed(() => events.value.find(event => event.id === selectedEventId.value) ?? null)
const selectedCamera = computed(() => cameras.value.find(camera => camera.id === selectedCameraId.value)
  ?? cameras.value.find(camera => camera.id === selectedEvent.value?.cameraId) ?? null)
const liveCameras = computed(() => cameras.value.filter(camera => camera.sourceType === 'live'))
const operating = computed(() => summarizeOperatingCameras(cameras.value))
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
function selectLiveTile(id) {
  if (id === null) {
    selectedCameraId.value = null
    selectedEventId.value = null
    return
  }
  selectCamera(id)
}
function applyData(nextCameras, nextEvents, nextVideos = []) {
  const selection = retainSelection(selectedCameraId.value, selectedEventId.value, nextCameras, nextEvents)
  cameras.value = nextCameras
  events.value = nextEvents
  videos.value = nextVideos
  selectedCameraId.value = selection.cameraId
  selectedEventId.value = selection.eventId
  const fresh = findNewFireEvents(knownEventIds, nextEvents)
  knownEventIds = new Set(nextEvents.map(event => event.id))
  if (fresh.length) {
    fireAlerts.value = [...fresh, ...fireAlerts.value]
    playAlertTone()
  }
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
    // 카메라 목록에서 넘어온 경우 첫 조회 뒤 한 번만 해당 카메라를 선택
    if (!linkApplied) {
      linkApplied = true
      const requested = findRequestedCameraId(route.query.camera, cameras.value)
      if (requested !== null) selectCamera(requested)
    }
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
    const token = await ensureAdminToken(loginAdmin, adminUsername.value, adminPassword.value)
    await refreshLiveCctvs(token)
    showCctvRefreshForm.value = false
    cctvRefreshMessage.value = 'CCTV 주소를 갱신했습니다.'
    await loadData({ silent: true })
  } catch (error) {
    cctvRefreshError.value = error.message
    if (error.code === 'unauthorized') signOut()
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
        <h1>대시보드</h1>
        <div class="header-tools">
          <time class="live-clock" :datetime="now.toISOString()">{{ clock }}</time>
          <span class="user-profile"><span class="avatar"><DashboardIcon name="user" :size="20" /></span>admin</span>
        </div>
      </header>
      <div class="workspace-heading"><span>실시간 관제 현황</span><div class="workspace-actions"><button type="button" class="cctv-refresh-button" :aria-expanded="mapVisible" aria-controls="monitoring-map" @click="mapVisible = !mapVisible">{{ mapVisible ? '지도 닫기' : '지도 열기' }}</button><button v-if="dataSource === 'api'" type="button" class="cctv-refresh-button" :aria-expanded="showCctvRefreshForm" aria-controls="cctv-refresh-form" @click="showCctvRefreshForm = !showCctvRefreshForm">CCTV 주소 갱신</button><span class="mode-badge">{{ dataSource === 'mock' ? '데모 데이터' : 'Backend 데이터' }}</span></div></div>
      <form v-if="showCctvRefreshForm && dataSource === 'api'" id="cctv-refresh-form" class="cctv-refresh-form" @submit.prevent="refreshCctv">
        <p>영상이 나오지 않을 때 관리자 계정으로 ITS CCTV 주소를 다시 조회합니다.</p>
        <template v-if="!isLoggedIn">
          <label>관리자 ID <input v-model="adminUsername" name="username" autocomplete="username" required></label>
          <label>비밀번호 <input v-model="adminPassword" name="password" type="password" autocomplete="current-password" required></label>
        </template>
        <button type="submit" class="primary-button" :disabled="cctvRefreshBusy">{{ cctvRefreshBusy ? '갱신 중…' : '주소 다시 조회' }}</button>
      </form>
      <p v-if="cctvRefreshMessage" class="cctv-refresh-result" role="status">{{ cctvRefreshMessage }}</p>
      <p v-if="cctvRefreshError" class="refresh-error" role="alert">{{ cctvRefreshError }}</p>
      <p v-if="isLoading" class="load-status" role="status">카메라와 탐지 이벤트를 불러오는 중입니다.</p>
      <div v-else-if="loadError" class="load-status" role="alert"><p>{{ loadError }}</p><button class="primary-button" @click="loadData">다시 시도</button></div>
      <template v-else>
        <p v-if="refreshError" class="refresh-error" role="alert">{{ refreshError }}</p>
        <FireAlertBanner :events="fireAlerts" :cameras="cameras" @open="openFireAlert" @dismiss="fireAlerts = []" @acknowledge="acknowledge" />
        <form v-if="ackWaitingIds.length" class="cctv-refresh-form" @submit.prevent="submitAckLogin">
          <p>이벤트를 확인하려면 관리자 로그인이 필요합니다.</p>
          <label>관리자 ID <input v-model="adminUsername" name="username" autocomplete="username" required></label>
          <label>비밀번호 <input v-model="adminPassword" name="password" type="password" autocomplete="current-password" required></label>
          <button type="submit" class="primary-button" :disabled="ackBusy">{{ ackBusy ? '확인 중…' : '로그인 후 확인' }}</button>
          <button type="button" class="cctv-refresh-button" @click="ackWaitingIds = []">취소</button>
        </form>
        <p v-if="ackError" class="refresh-error" role="alert">{{ ackError }}</p>
        <section class="dashboard-grid" :class="{ 'with-detail': selectedCamera || selectedEvent, 'map-hidden': !mapVisible }" aria-label="지도 및 탐지 현황">
          <MonitoringMap v-if="mapVisible" id="monitoring-map" class="map-panel" :cameras="cameras" :events="events" :selected-event="selectedEvent" :selected-camera="selectedCamera" :fire-camera-ids="fireCameraIds" @select-camera="selectCamera" />
          <EventDetail v-if="selectedCamera || selectedEvent" class="detail-panel" :event="selectedEvent" :camera="selectedCamera" :videos="videos" mirror />
          <LiveCctvWall v-if="liveCameras.length" id="live-cctv-wall" :cameras="liveCameras" :selected-id="selectedCamera?.sourceType === 'live' ? selectedCamera.id : null" @select="selectLiveTile" />
          <EventList id="events-panel" class="events-panel" :events="events" :cameras="cameras" :selected-id="selectedEventId" @select="selectEvent" @acknowledge="acknowledge" />
        </section>
        <section class="summary-grid" aria-label="관제 요약">
          <article class="summary-card"><span class="summary-icon red"><DashboardIcon name="fire" :size="29" /></span><div><p>탐지 이벤트</p><strong>{{ events.length }}<small>건</small></strong></div></article>
          <article class="summary-card"><span class="summary-icon blue"><DashboardIcon name="camera" :size="29" /></span><div><p>운영 중인 CCTV</p><strong>{{ operating.online }}<small>대 <span class="metric-total">/ {{ operating.total }}</span></small></strong></div></article>
          <article class="summary-card"><span class="summary-icon amber"><DashboardIcon name="target" :size="29" /></span><div><p>위치 추정 완료</p><strong>{{ locatedCount }}<small>건</small></strong></div></article>
          <article class="summary-card"><span class="summary-icon green"><DashboardIcon name="clock" :size="29" /></span><div><p>확인 대기 이벤트</p><strong>{{ pendingCount }}<small>건</small></strong></div></article>
        </section>
      </template>
      <footer class="dashboard-footer"><span>{{ dataSource === 'mock' ? '화면의 좌표와 탐지 결과는 개발용 예시입니다.' : 'Backend 조회 데이터 기준' }}</span></footer>
    </div>
</template>

<style scoped>
.dashboard-content { padding: 28px 30px 20px; max-width: 1740px; width: 100%; margin: 0 auto; }
.dashboard-header { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 24px; }
h1 { margin: 0; font-size: clamp(23px, 2vw, 30px); letter-spacing: -1px; font-weight: 800; color: var(--text); }
.header-tools { display: flex; align-items: center; gap: 14px; color: var(--text-2); font-size: 13px; white-space: nowrap; }
.live-clock { padding: 7px 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); font-variant-numeric: tabular-nums; }
.user-profile { display: flex; align-items: center; gap: 10px; padding: 4px 14px 4px 4px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--text-2); }
.avatar { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; color: var(--on-accent); background: linear-gradient(135deg, #3d8ff0, #1b5fb8); }
.workspace-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; color: var(--text-2); font-size: 12px; font-weight: 600; letter-spacing: 0.4px; }
.workspace-heading > span::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 9px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 10px var(--ok); animation: live-pulse 2.4s ease-in-out infinite; vertical-align: 1px; }
.mode-badge { border: 1px solid var(--line-strong); background: var(--surface-2); color: var(--text-2); border-radius: 999px; padding: 4px 11px; font-size: 11px; font-weight: 500; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
.summary-card { display: flex; gap: 14px; align-items: center; padding: 14px 16px; border-radius: var(--radius); border: 1px solid var(--line); background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0) 70px), var(--surface); box-shadow: var(--shadow); }
.summary-icon { display: grid; place-items: center; width: 40px; height: 40px; flex-shrink: 0; border-radius: 11px; }.summary-icon svg { width: 20px; height: 20px; }
.red { color: var(--fire); background: var(--fire-soft); }.blue { color: var(--accent); background: var(--accent-soft); }.amber { color: var(--warn); background: var(--warn-soft); }.green { color: var(--ok); background: var(--ok-soft); }
.summary-card p { font-size: 12px; color: var(--text-3); margin: 0 0 4px; }
.summary-card strong { display: block; font-size: 24px; font-weight: 750; letter-spacing: -0.6px; font-variant-numeric: tabular-nums; line-height: 1.15; color: var(--text); }
.summary-card small { font-size: 12px; margin-left: 4px; color: var(--text-2); font-weight: 500; }.metric-total { color: var(--text-3); font-weight: 400; font-size: 11px; }
.dashboard-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
.dashboard-grid.with-detail:not(.map-hidden) { grid-template-columns: minmax(0, 1.6fr) minmax(320px, .9fr); }
.map-panel { grid-column: 1; }.detail-panel { grid-column: 2; }.events-panel { grid-column: 1 / -1; scroll-margin-top: 20px; }
.dashboard-grid.map-hidden .detail-panel { grid-column: 1; }
.dashboard-grid > * { min-width: 0; }
.load-status { padding: 26px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); color: var(--text-2); }
.refresh-error { margin: 0 0 12px; padding: 10px 14px; border: 1px solid rgba(246, 189, 74, 0.3); border-radius: var(--radius-sm); background: var(--warn-soft); color: var(--warn); font-size: 12px; }
.workspace-actions { display: flex; align-items: center; gap: 10px; }
.cctv-refresh-button { border: 1px solid var(--line-strong); border-radius: 999px; background: var(--surface); color: var(--text); padding: 6px 13px; font-size: 12px; transition: background 0.15s, border-color 0.15s; }
.cctv-refresh-button:hover { background: var(--surface-3); border-color: var(--accent); }
.cctv-refresh-form { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; margin-bottom: 12px; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.cctv-refresh-form p { width: 100%; margin: 0; font-size: 12px; color: var(--text-2); }
.cctv-refresh-form label { display: grid; gap: 5px; font-size: 12px; color: var(--text-2); }
.cctv-refresh-form .primary-button { padding: 10px 16px; }
.cctv-refresh-result { margin: 0 0 12px; padding: 10px 14px; border: 1px solid rgba(54, 214, 163, 0.3); border-radius: var(--radius-sm); background: var(--ok-soft); color: var(--ok); font-size: 12px; }
.dashboard-footer { display: flex; justify-content: flex-end; gap: 12px; color: var(--text-3); font-size: 11px; margin-top: 22px; }
@media (min-width: 1600px) { .dashboard-content { padding: 32px 38px; } }
@media (max-width: 1200px) { .dashboard-content { padding: 22px 18px; }.header-tools { gap: 10px; }.live-clock { display: none; } }
@media (max-width: 800px) { .dashboard-grid.with-detail:not(.map-hidden) { grid-template-columns: minmax(0, 1fr); }.detail-panel { grid-column: 1; } }
@media (max-width: 600px) { .dashboard-content { padding: 18px 12px; }.dashboard-header { align-items: start; }.dashboard-header h1 { font-size: 20px; letter-spacing: -.7px; }.user-profile { padding: 4px; font-size: 0; }.summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }.summary-card { padding: 10px; }.dashboard-footer { flex-direction: column; } }
</style>
