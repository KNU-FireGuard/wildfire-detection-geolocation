<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AUTH_ERROR_EVENT, loadNaverMaps } from '../maps/naverLoader'
import { createNaverScene, errorRangeDisplay, focusLocationsForRequest, hasCoordinates, isVisibleEstimatedEvent } from '../maps/naverScene'

const props = defineProps({
  cameras: { type: Array, default: () => [] }, events: { type: Array, default: () => [] },
  selectedEvent: { type: Object, default: null }, selectedCamera: { type: Object, default: null },
  focusRequest: { type: Object, default: null },
  fireCameraIds: { type: Object, default: () => new Set() },
})
const emit = defineEmits(['select-camera', 'focus-applied'])
const container = ref(null)
const loading = ref(true)
const error = ref('')
const ready = ref(false)
const mode = ref('HYBRID')
const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID
const validFire = computed(() => isVisibleEstimatedEvent(props.selectedEvent))
const rangeDisplay = computed(() => errorRangeDisplay(props.selectedEvent?.estimatedLocation))
const unlocated = computed(() => props.cameras.filter(camera => !hasCoordinates(camera)).length)
const cameraGroups = computed(() => [
  { key: 'test', label: 'Test용 CCTV', cameras: props.cameras.filter(camera => camera.sourceType === 'test') },
  { key: 'live', label: '실시간 CCTV', cameras: props.cameras.filter(camera => camera.sourceType === 'live') },
  { key: 'other', label: '기타 CCTV', cameras: props.cameras.filter(camera => !['test', 'live'].includes(camera.sourceType)) },
].filter(group => group.cameras.length))
let maps, map, scene, observer
let focusFrame = null
let disposed = false
let attempt = 0

function selectCamera(camera) {
  emit('select-camera', camera.id)
}
function render() { scene?.render(props) }
function focusRequested(request) {
  if (focusFrame !== null) cancelAnimationFrame(focusFrame)
  focusFrame = null
  if (!scene || !request) return
  focusFrame = requestAnimationFrame(() => {
    focusFrame = null
    if (!scene || props.focusRequest?.sequence !== request.sequence) return
    map?.autoResize()
    const locations = focusLocationsForRequest(request, props.cameras, props.events)
    if (locations.length) scene.focus(locations)
    emit('focus-applied', request.sequence)
  })
}
function cleanup() {
  if (focusFrame !== null) cancelAnimationFrame(focusFrame)
  focusFrame = null
  observer?.disconnect()
  observer = null
  scene?.clear()
  scene = null
  map?.destroy()
  map = null
  ready.value = false
}
function authError() {
  error.value = '네이버 지도 인증에 실패했습니다. 지도 서비스 설정을 확인해주세요.'
  loading.value = false
  cleanup()
}
async function initialize() {
  const current = ++attempt
  cleanup()
  loading.value = true
  error.value = ''
  try {
    maps = await loadNaverMaps(clientId)
    if (disposed || current !== attempt || error.value) return
    map = new maps.Map(container.value, {
      center: new maps.LatLng(36, 127.8), zoom: 7,
      mapTypeId: maps.MapTypeId[mode.value], zoomControl: true,
      zoomControlOptions: { position: maps.Position.RIGHT_CENTER },
    })
    scene = createNaverScene(maps, map, selectCamera)
    render()
    focusRequested(props.focusRequest)
    observer = new ResizeObserver(() => map?.autoResize())
    observer.observe(container.value)
    ready.value = true
  } catch (cause) {
    if (!disposed && current === attempt) { cleanup(); error.value = cause.message }
  } finally {
    if (!disposed && current === attempt) loading.value = false
  }
}
watch(mode, value => map?.setMapTypeId(maps.MapTypeId[value]))
watch(() => props.fireCameraIds, render)
watch(() => [props.cameras, props.events], render, { deep: true })
watch(() => [props.selectedEvent?.id, props.selectedCamera?.id], render)
watch(() => props.focusRequest, focusRequested)
onMounted(() => { window.addEventListener(AUTH_ERROR_EVENT, authError); initialize() })
onBeforeUnmount(() => {
  disposed = true
  attempt++
  window.removeEventListener(AUTH_ERROR_EVENT, authError)
  cleanup()
})
</script>

<template>
  <section class="dashboard-panel monitoring-map" aria-label="지도와 CCTV 선택">
    <div class="map-area">
      <div ref="container" class="naver-map" aria-label="CCTV 및 추정 산불 위치 지도" />
      <div v-if="loading || error" class="map-message" :role="error ? 'alert' : 'status'">
        <p>{{ error || '네이버 지도를 불러오는 중입니다.' }}</p>
        <button v-if="error && clientId" class="primary-button" @click="initialize">다시 시도</button>
      </div>
      <template v-if="ready">
        <div class="map-toolbar" aria-label="지도 유형 선택">
          <button v-for="item in [{ id: 'NORMAL', label: '일반' }, { id: 'SATELLITE', label: '위성' }, { id: 'HYBRID', label: '위성·지명' }]" :key="item.id" :aria-pressed="mode === item.id" @click="mode = item.id">{{ item.label }}</button>
        </div>
        <div class="map-legend"><span class="camera-key">● CCTV</span><span class="fire-key">● 화재 탐지 CCTV</span><span class="fire-key">● 추정 산불 위치</span></div>
      </template>
    </div>
    <div class="map-selection" aria-live="polite">
      <p v-if="unlocated" class="empty-message">좌표가 없거나 유효하지 않은 카메라 {{ unlocated }}대는 지도에 표시할 수 없습니다.</p>
      <div class="camera-groups">
        <div v-for="group in cameraGroups" :key="group.key" class="camera-group">
          <h3>{{ group.label }}</h3>
          <div class="camera-buttons" :aria-label="`${group.label} 선택`"><button v-for="camera in group.cameras" :key="camera.id" :aria-pressed="camera.id === selectedCamera?.id" @click="selectCamera(camera)">{{ camera.name }}</button></div>
        </div>
      </div>
      <p v-if="selectedCamera && hasCoordinates(selectedCamera)" class="coordinates">{{ selectedCamera.sourceType === 'live' ? 'ITS 제공 좌표' : '등록된 카메라 좌표' }} · 위도 {{ selectedCamera.latitude.toFixed(6) }} · 경도 {{ selectedCamera.longitude.toFixed(6) }}</p>
      <p v-if="selectedCamera && !events.some(event => event.cameraId === selectedCamera.id)" class="empty-message">{{ selectedCamera.name }}: 탐지 이벤트가 없습니다.</p>
      <template v-if="selectedEvent">
        <p>이벤트 #{{ selectedEvent.id }} · {{ selectedCamera?.name ?? '카메라 정보 없음' }} <RouterLink :to="`/events/${selectedEvent.id}`">상세 보기</RouterLink></p>
        <p v-if="validFire" class="coordinates">위도 {{ selectedEvent.estimatedLocation.latitude.toFixed(6) }} · 경도 {{ selectedEvent.estimatedLocation.longitude.toFixed(6) }}</p>
        <p v-if="validFire" class="coordinates" :class="{ 'low-confidence': rangeDisplay.mode === 'low-confidence' }">{{ rangeDisplay.label }}</p>
        <p v-if="!validFire" class="empty-message">{{ selectedEvent.status === 'CONFIRMED' ? '확인 완료된 이벤트는 지도에 표시하지 않습니다.' : '유효한 추정 위치 정보가 없습니다.' }}</p>
      </template>
      <p v-else-if="!cameras.length" class="empty-message">등록된 카메라가 없습니다.</p>
    </div>
  </section>
</template>

<style scoped>
.monitoring-map { padding: 0; overflow: hidden; }.map-area { position: relative; height: clamp(620px, 74vh, 920px); background: var(--bg-2); }
.naver-map { width: 100%; height: 100%; }.map-message { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; text-align: center; background: var(--bg-2); color: var(--text-2); }
.map-toolbar { position: absolute; top: 12px; left: 12px; display: flex; flex-wrap: wrap; border: 1px solid var(--line-strong); border-radius: 11px; overflow: hidden; background: var(--glass); backdrop-filter: blur(10px); box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45); }.map-toolbar button { padding: 9px 13px; border: 0; background: transparent; color: var(--text-2); font-size: 12px; font-weight: 500; transition: background 0.15s, color 0.15s; }.map-toolbar button:hover { color: var(--text); background: var(--surface-3); }.map-toolbar button[aria-pressed='true'] { color: var(--on-accent); background: var(--accent-strong); }
.map-legend { position: absolute; top: 58px; left: 12px; display: flex; gap: 14px; padding: 8px 13px; border: 1px solid var(--line); border-radius: 11px; background: var(--glass); backdrop-filter: blur(10px); color: var(--text-2); font-size: 11px; }.camera-key { color: var(--accent); }.fire-key { color: var(--fire); }
.map-selection { padding: 16px 18px; font-size: 12px; color: var(--text-2); }.camera-groups { display: grid; gap: 12px; }.camera-group h3 { margin: 0 0 7px; color: var(--text-3); font-size: 12px; font-weight: 600; }.camera-buttons { display: flex; flex-wrap: wrap; gap: 7px; }.camera-buttons button { border: 1px solid var(--line); background: var(--surface-2); color: var(--text-2); border-radius: 999px; padding: 6px 12px; font-size: 11px; transition: border-color 0.15s, color 0.15s; }.camera-buttons button:hover { border-color: var(--accent); color: var(--text); }.camera-buttons button[aria-pressed='true'] { background: var(--accent-strong); color: var(--on-accent); border-color: transparent; }a { color: var(--accent); margin-left: 12px; }.coordinates { color: var(--text-3); font-variant-numeric: tabular-nums; }
.low-confidence { color: var(--warn); }
.map-legend { flex-wrap: wrap; max-width: calc(100% - 24px); box-sizing: border-box; }
@media (max-width: 600px) { .map-area { height: min(76vh, 700px); min-height: 470px; }.map-toolbar button { padding: 8px; font-size: 11px; } }
</style>
