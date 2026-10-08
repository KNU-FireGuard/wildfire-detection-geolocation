<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AUTH_ERROR_EVENT, loadNaverMaps } from '../maps/naverLoader'
import { createNaverScene, hasCoordinates } from '../maps/naverScene'

const props = defineProps({
  cameras: { type: Array, default: () => [] }, events: { type: Array, default: () => [] },
  selectedEvent: { type: Object, default: null }, selectedCamera: { type: Object, default: null },
})
const emit = defineEmits(['select'])
const container = ref(null)
const loading = ref(true)
const error = ref('')
const ready = ref(false)
const mode = ref('HYBRID')
const noEventCamera = ref(null)
const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID
const validFire = computed(() => hasCoordinates(props.selectedEvent?.estimatedLocation))
const unlocated = computed(() => props.cameras.filter(camera => !hasCoordinates(camera)).length)
let maps, map, scene, observer
let disposed = false
let attempt = 0

function selectCamera(camera) {
  const latest = props.events.filter(event => event.cameraId === camera.id)
    .reduce((current, event) => !current || Date.parse(event.detectedAt) > Date.parse(current.detectedAt) ? event : current, null)
  noEventCamera.value = latest ? null : camera
  if (latest) emit('select', latest.id)
  else scene?.focus([camera])
}
function render() { scene?.render(props) }
function showAll() {
  const locations = [...props.cameras, ...props.events.map(event => event.estimatedLocation)]
  if (locations.some(hasCoordinates)) scene?.focus(locations)
  else { map?.setCenter(new maps.LatLng(36.0089, 128.7118)); map?.setZoom(13) }
}
function focusSelection() {
  const locations = [props.selectedCamera, props.selectedEvent?.estimatedLocation]
  if (locations.some(hasCoordinates)) scene?.focus(locations)
}
function cleanup() {
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
      center: new maps.LatLng(36.0089, 128.7118), zoom: 13,
      mapTypeId: maps.MapTypeId[mode.value], zoomControl: true,
      zoomControlOptions: { position: maps.Position.RIGHT_CENTER },
    })
    scene = createNaverScene(maps, map, selectCamera)
    render()
    showAll()
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
watch(() => [props.cameras, props.events], () => { render(); showAll() }, { deep: true })
watch(() => [props.selectedEvent, props.selectedCamera], () => {
  noEventCamera.value = null
  render()
  focusSelection()
}, { deep: true })
onMounted(() => { window.addEventListener(AUTH_ERROR_EVENT, authError); initialize() })
onBeforeUnmount(() => {
  disposed = true
  attempt++
  window.removeEventListener(AUTH_ERROR_EVENT, authError)
  cleanup()
})
</script>

<template>
  <section class="dashboard-panel monitoring-map" aria-labelledby="map-title">
    <div class="map-area">
      <div ref="container" class="naver-map" aria-label="CCTV 및 추정 산불 위치 지도" />
      <div v-if="loading || error" class="map-message" :role="error ? 'alert' : 'status'">
        <p>{{ error || '네이버 지도를 불러오는 중입니다.' }}</p>
        <button v-if="error && clientId" class="primary-button" @click="initialize">다시 시도</button>
      </div>
      <template v-if="ready">
        <div class="map-toolbar" aria-label="지도 유형 선택">
          <button v-for="item in [{ id: 'NORMAL', label: '일반' }, { id: 'SATELLITE', label: '위성' }, { id: 'HYBRID', label: '위성·지명' }]" :key="item.id" :aria-pressed="mode === item.id" @click="mode = item.id">{{ item.label }}</button>
          <button @click="showAll">전체 위치</button>
        </div>
        <div class="map-legend"><span class="camera-key">● CCTV</span><span class="fire-key">● 추정 산불 위치</span></div>
      </template>
    </div>
    <div class="map-selection" aria-live="polite">
      <div class="selection-heading"><h2 id="map-title">탐지 위치 현황</h2><span>CCTV {{ cameras.length }}대</span></div>
      <p v-if="unlocated" class="empty-message">좌표가 없거나 유효하지 않은 카메라 {{ unlocated }}대는 지도에 표시할 수 없습니다.</p>
      <div class="camera-buttons" aria-label="카메라 선택"><button v-for="camera in cameras" :key="camera.id" :aria-pressed="camera.id === selectedCamera?.id || camera.id === noEventCamera?.id" @click="selectCamera(camera)">{{ camera.name }}</button></div>
      <p v-if="noEventCamera" class="empty-message">{{ noEventCamera.name }}: 탐지 이벤트가 없습니다.</p>
      <template v-if="selectedEvent">
        <p>이벤트 #{{ selectedEvent.id }} · {{ selectedCamera?.name ?? '카메라 정보 없음' }} <RouterLink :to="`/events/${selectedEvent.id}`">상세 보기</RouterLink></p>
        <p v-if="validFire" class="coordinates">위도 {{ selectedEvent.estimatedLocation.latitude.toFixed(6) }} · 경도 {{ selectedEvent.estimatedLocation.longitude.toFixed(6) }}</p>
        <p v-else class="empty-message">유효한 추정 위치 정보가 없습니다.</p>
      </template>
      <p v-else class="empty-message">{{ cameras.length ? '이벤트를 선택하면 추정 위치를 확인할 수 있습니다.' : '등록된 카메라가 없습니다.' }}</p>
    </div>
  </section>
</template>

<style scoped>
.monitoring-map { padding: 0; overflow: hidden; }.map-area { position: relative; height: clamp(410px, 38vw, 540px); background: #e9eef4; }
.naver-map { width: 100%; height: 100%; }.map-message { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; text-align: center; background: #edf2f8; color: #536781; }
.map-toolbar { position: absolute; top: 12px; left: 12px; display: flex; flex-wrap: wrap; border-radius: 5px; overflow: hidden; box-shadow: 0 2px 8px #0003; }.map-toolbar button { padding: 9px 12px; border: 0; background: white; color: #536781; font-size: 12px; }.map-toolbar button[aria-pressed='true'] { color: white; background: #337fd4; }
.map-legend { position: absolute; top: 60px; left: 12px; display: flex; gap: 14px; padding: 8px 12px; background: #fff; border-radius: 5px; font-size: 11px; }.camera-key { color: #337fd4; }.fire-key { color: #df4036; }
.map-selection { padding: 16px 18px; font-size: 12px; }.selection-heading { display: flex; justify-content: space-between; align-items: center; color: #7d90a8; }.selection-heading h2 { font-size: 14px; color: #536781; }.camera-buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }.camera-buttons button { border: 1px solid #dce5ef; background: #f4f7fb; color: #59708a; border-radius: 5px; padding: 6px 10px; font-size: 11px; }.camera-buttons button[aria-pressed='true'] { background: #337fd4; color: white; }a { color: #337fd4; margin-left: 12px; }.coordinates { color: #64748b; font-variant-numeric: tabular-nums; }
@media (max-width: 600px) { .map-area { height: 410px; }.map-toolbar button { padding: 8px; font-size: 11px; } }
</style>
