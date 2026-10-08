<script setup>
import { computed, ref, watch } from 'vue'
import DashboardIcon from './DashboardIcon.vue'
import TerrainBackdrop from './TerrainBackdrop.vue'
const props = defineProps({
  cameras: { type: Array, default: () => [] }, events: { type: Array, default: () => [] },
  selectedEvent: { type: Object, default: null }, selectedCamera: { type: Object, default: null },
})
const emit = defineEmits(['select'])
// 안내와 화면 확대만 관리하며 이벤트 선택 상태는 App.vue에서 전달받습니다.
const noEventCameraId = ref(null)
const viewMode = ref('terrain')
const zoom = ref(1)
const noEventCamera = computed(() => props.cameras.find(camera => camera.id === noEventCameraId.value) ?? null)
watch(() => props.selectedEvent, () => { noEventCameraId.value = null })
function selectCamera(camera) {
  const latestEvent = props.events.filter(event => event.cameraId === camera.id)
    .reduce((latest, event) => !latest || Date.parse(event.detectedAt) > Date.parse(latest.detectedAt) ? event : latest, null)
  noEventCameraId.value = latestEvent ? null : camera.id
  if (latestEvent) emit('select', latestEvent.id)
}
function hasCoordinates(location) {
  return Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude)
}
const locatedCameras = computed(() => props.cameras.filter(hasCoordinates))
const unlocatedCameras = computed(() => props.cameras.filter(camera => !hasCoordinates(camera)))
const selectedCameraName = computed(() => props.selectedCamera?.name
  ?? (props.selectedEvent?.cameraId == null ? '카메라 정보 없음' : `카메라 ${props.selectedEvent.cameraId}`))
// 실제 지도 투영이 아닙니다. 전체 데이터의 좌표 범위를 고정해 임시 화면에 배치합니다.
const bounds = computed(() => {
  const locations = [...locatedCameras.value, ...props.events.map(event => event.estimatedLocation).filter(hasCoordinates)]
  if (!locations.length) return null
  return { minLat: Math.min(...locations.map(location => location.latitude)), maxLat: Math.max(...locations.map(location => location.latitude)), minLng: Math.min(...locations.map(location => location.longitude)), maxLng: Math.max(...locations.map(location => location.longitude)) }
})
function markerPosition(location) {
  const range = bounds.value
  if (!range) return { left: 50, top: 50 }
  return {
    left: range.maxLng === range.minLng ? 50 : 19 + 62 * (location.longitude - range.minLng) / (range.maxLng - range.minLng),
    top: range.maxLat === range.minLat ? 50 : 80 - 57 * (location.latitude - range.minLat) / (range.maxLat - range.minLat),
  }
}
function markerStyle(location) {
  const position = markerPosition(location)
  return { left: `${position.left}%`, top: `${position.top}%` }
}
const connection = computed(() => hasCoordinates(props.selectedCamera) && hasCoordinates(props.selectedEvent?.estimatedLocation)
  ? { camera: markerPosition(props.selectedCamera), fire: markerPosition(props.selectedEvent.estimatedLocation) } : null)
const stageStyle = computed(() => ({ transform: `scale(${zoom.value})`, transformOrigin: hasCoordinates(props.selectedCamera) ? `${markerPosition(props.selectedCamera).left}% ${markerPosition(props.selectedCamera).top}%` : '50% 50%' }))
function changeZoom(amount) { zoom.value = Math.max(1, Math.min(1.6, Math.round((zoom.value + amount) * 10) / 10)) }
</script>

<template>
  <section class="dashboard-panel monitoring-map" aria-labelledby="map-title">
    <div class="map-area" :class="viewMode" aria-label="CCTV 및 산불 추정 위치 임시 지도">
      <div class="map-stage" :style="stageStyle">
        <TerrainBackdrop v-if="viewMode === 'terrain'" />
        <svg v-if="connection" class="connection-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line :x1="connection.camera.left" :y1="connection.camera.top" :x2="connection.fire.left" :y2="connection.fire.top" /></svg>
        <button v-for="camera in locatedCameras" :key="camera.id" type="button" class="marker camera-marker"
          :class="{ offline: camera.status === 'OFFLINE', selected: camera.id === selectedCamera?.id }" :style="markerStyle(camera)"
          :aria-pressed="camera.id === selectedCamera?.id" :aria-label="`${camera.name} ${camera.status ?? '상태 정보 없음'} 최근 탐지 이벤트 선택`" @click="selectCamera(camera)">
          <span class="camera-pin"><DashboardIcon name="camera" :size="18" /><i v-if="camera.status" :class="{ online: camera.status === 'ONLINE' }" /></span><span class="marker-label">{{ camera.name }}</span>
        </button>
        <button v-if="selectedEvent?.estimatedLocation" type="button" class="marker fire-marker" :style="markerStyle(selectedEvent.estimatedLocation)" aria-label="선택 이벤트의 추정 산불 위치" aria-pressed="true"><span class="fire-glow" /><span class="fire-dot" /><span class="fire-label">추정 산불 위치</span></button>
      </div>
      <div class="map-toolbar" aria-label="임시 지도 배경 선택"><button type="button" :class="{ active: viewMode === 'map' }" :aria-pressed="viewMode === 'map'" @click="viewMode = 'map'">지도</button><button type="button" :class="{ active: viewMode === 'terrain' }" :aria-pressed="viewMode === 'terrain'" @click="viewMode = 'terrain'">지형</button></div>
      <div class="map-legend"><span><span class="legend-camera"><DashboardIcon name="camera" :size="12" /></span>CCTV 위치</span><span><i class="legend-line" />선택 이벤트 연결</span><span><i class="legend-fire" />추정 산불 위치</span></div>
      <div class="map-context"><span class="context-dot" />팔공산 관제 구역<small>임시 지도 · 예시 지형</small></div>
      <div class="map-controls" aria-label="임시 지도 확대 축소"><button type="button" aria-label="기본 배율로 돌아가기" title="기본 배율" @click="zoom = 1"><DashboardIcon name="target" :size="20" /></button><div><button type="button" aria-label="지도 확대" :disabled="zoom >= 1.6" @click="changeZoom(.2)"><DashboardIcon name="plus" :size="22" /></button><button type="button" aria-label="지도 축소" :disabled="zoom <= 1" @click="changeZoom(-.2)"><DashboardIcon name="minus" :size="22" /></button></div></div>
      <span class="map-scale">{{ Math.round(zoom * 100) }}% <i /></span>
    </div>
    <div v-if="unlocatedCameras.length" class="unlocated-cameras"><p>좌표 없는 카메라 (지도 위치 표시 불가)</p><button v-for="camera in unlocatedCameras" :key="camera.id" type="button" :aria-pressed="camera.id === selectedCamera?.id" @click="selectCamera(camera)">{{ camera.name }}</button></div>
    <div class="map-selection" aria-live="polite">
      <div class="selection-heading"><DashboardIcon name="layers" :size="17" /><h2 id="map-title">탐지 위치 현황</h2><span class="camera-count">CCTV {{ cameras.length }}대</span></div>
      <p v-if="noEventCamera" class="map-notice">{{ noEventCamera.name }}: 이 카메라에는 탐지 이벤트가 없습니다.</p>
      <template v-if="selectedEvent"><div class="selection-details"><span class="selection-camera">{{ selectedCameraName }}<span class="selection-id">이벤트 #{{ selectedEvent.id }}</span></span><template v-if="selectedEvent.estimatedLocation"><span v-if="selectedCamera" class="connection-text">{{ selectedCameraName }} → 추정 위치</span><span v-else class="connection-text">카메라 정보가 없어 추정 위치만 표시합니다.</span><span class="coordinate-text">{{ selectedEvent.estimatedLocation.latitude.toFixed(4) }}° N · {{ selectedEvent.estimatedLocation.longitude.toFixed(4) }}° E</span></template><span v-else class="no-location">위치 추정 정보가 없습니다.</span></div></template>
      <p v-else class="empty-message">{{ cameras.length === 0 ? '등록된 카메라가 없습니다.' : '이벤트를 선택하면 추정 위치를 확인할 수 있습니다.' }}</p>
    </div>
  </section>
</template>

<style scoped>
.monitoring-map { padding: 0; overflow: hidden; }
.map-area { position: relative; height: clamp(410px, 38vw, 540px); overflow: hidden; background: #214238; }
.map-stage { position: absolute; inset: 0; transition: transform .25s; }
.map-area.map { background: #e9f0e9; }.map-area.map .map-stage { background-image: linear-gradient(#7f9b8130 1px, transparent 1px), linear-gradient(90deg, #7f9b8130 1px, transparent 1px); background-size: 40px 40px; }
.connection-line { position: absolute; width: 100%; height: 100%; pointer-events: none; z-index: 1; }.connection-line line { stroke: #74bdff; stroke-width: .3; stroke-dasharray: 1 1; opacity: .75; vector-effect: non-scaling-stroke; }
.marker { position: absolute; transform: translate(-50%, -50%); border: 0; background: transparent; padding: 4px; display: flex; align-items: center; flex-direction: column; z-index: 3; }
.camera-pin { position: relative; width: 31px; height: 31px; display: grid; place-items: center; color: #245a96; background: #f6faff; border: 2px solid #72a9d5; border-radius: 9px; box-shadow: 0 2px 6px #102c3055; }
.camera-pin i { position: absolute; right: -3px; bottom: -3px; width: 8px; height: 8px; border: 1.5px solid #f6faff; background: #94a3b8; border-radius: 50%; }.camera-pin i.online { background: #1ab880; }
.marker-label { font-size: 10px; color: #f6faf7; padding: 3px 5px; margin-top: 4px; background: #122e2ab3; border-radius: 3px; white-space: nowrap; font-weight: 500; letter-spacing: .4px; }
.camera-marker.selected { z-index: 4; }.camera-marker.selected .camera-pin { border-color: #428be0; color: #fff; background: #337fd4; box-shadow: 0 0 0 5px #73b5ff44, 0 3px 8px #152c3255; }.camera-marker.selected .marker-label { color: #fff; background: #337fd4; }
.camera-marker.offline .camera-pin { border-style: dashed; color: #8191a2; border-color: #8191a2; background: #e5e9eb; }.camera-marker.offline .marker-label { color: #bdc7cb; }
.fire-marker { z-index: 2; transform: translate(-50%, -50%); width: 28px; height: 28px; padding: 0; justify-content: center; }
.fire-dot { width: 15px; height: 15px; border-radius: 50%; background: #ff4c3b; border: 2px solid #ff7261; box-shadow: 0 0 15px #ff443bcc; }
.fire-glow { position: absolute; width: 110px; height: 110px; border-radius: 50%; background: radial-gradient(circle, #ff443b7a 0%, #ff443b30 45%, transparent 70%); pointer-events: none; }
.fire-label { position: absolute; top: 34px; background: #ab342de0; padding: 4px 7px; border-radius: 4px; color: #fff; font-size: 10px; white-space: nowrap; }
.map-toolbar { position: absolute; top: 16px; left: 16px; display: flex; background: white; border-radius: 5px; overflow: hidden; box-shadow: 0 3px 8px #122c3255; z-index: 5; }.map-toolbar button { border: 0; padding: 10px 22px; background: white; color: #627188; font-size: 12px; }.map-toolbar button.active { background: #337fd4; color: #fff; }
.map-legend { position: absolute; right: 16px; top: 16px; border: 1px solid #ffffff0d; padding: 12px 14px; background: #1b2c33e8; border-radius: 5px; display: grid; gap: 10px; color: #dce7e8; font-size: 10px; z-index: 5; }.map-legend > span { display: flex; gap: 8px; align-items: center; }.legend-camera { width: 17px; height: 17px; display: grid; place-items: center; background: #337fd4; color: #fff; border-radius: 50%; }.legend-line { width: 17px; height: 2px; border-top: 2px dashed #73b7f6; }.legend-fire { width: 12px; height: 12px; margin: 0 3px; background: #ff5145; border-radius: 50%; }
.map-context { position: absolute; bottom: 20px; left: 18px; font-size: 11px; color: #e3eeea; background: #17302ab3; padding: 8px 12px; border-radius: 5px; z-index: 5; }.map-context small { display: block; margin: 5px 0 0 11px; font-size: 9px; color: #a7bdb4; }.context-dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: #9bb9a4; margin-right: 6px; }
.map-controls { position: absolute; bottom: 20px; right: 16px; display: grid; gap: 8px; z-index: 5; }.map-controls > div { display: grid; overflow: hidden; border-radius: 5px; }.map-controls button { width: 36px; height: 36px; border: 0; background: #fff; color: #314153; display: grid; place-items: center; border-radius: 4px; box-shadow: 0 2px 4px #17302a22; }.map-controls button:disabled { color: #b9c3cc; }.map-controls > div button { border-radius: 0; }.map-controls > div button + button { border-top: 1px solid #e7edf2; }
.map-scale { position: absolute; bottom: 21px; right: 70px; font-size: 9px; color: #d8e6df; background: #17302a99; padding: 5px 7px; border-radius: 3px; }.map-scale i { display: block; width: 50px; height: 5px; border: 1px solid #c4d7cb; border-top: 0; margin-top: 4px; }
.map-selection { padding: 15px 18px; }.selection-heading { display: flex; align-items: center; gap: 7px; color: #7d90a8; }.selection-heading h2 { font-size: 13px; font-weight: 600; color: #536781; }.camera-count { margin-left: auto; font-size: 10px; color: #8a9ab0; }
.selection-details { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; margin-top: 10px; font-size: 10px; }.selection-camera { font-weight: 600; color: #3f5876; }.selection-id { color: #9aabba; margin-left: 8px; font-weight: 400; }.connection-text { color: #337fd4; }.coordinate-text { margin-left: auto; font-variant-numeric: tabular-nums; color: #94a0b0; font-size: 9px; }.no-location { color: #c08b45; }.map-notice { font-size: 11px; color: #ad7b39; background: #fff8eb; padding: 8px 10px; border-radius: 4px; }
.unlocated-cameras { padding: 10px 18px 0; }.unlocated-cameras p { color: #7a899d; font-size: 11px; }.unlocated-cameras button { border: 1px solid #dce5ef; background: #f4f7fb; color: #59708a; border-radius: 5px; padding: 6px 10px; margin-right: 7px; font-size: 11px; }.unlocated-cameras button[aria-pressed='true'] { background: #337fd4; color: #fff; }
@media (max-width: 1200px) { .map-legend { padding: 10px; font-size: 9px; }.map-toolbar button { padding: 9px 15px; }.coordinate-text { margin-left: 0; } }
@media (max-width: 600px) { .map-area { height: 410px; }.map-toolbar { left: 10px; top: 10px; }.map-legend { top: 10px; right: 10px; gap: 8px; padding: 9px; font-size: 8px; }.map-toolbar button { padding: 8px 12px; font-size: 10px; }.camera-pin { width: 25px; height: 25px; }.camera-pin svg { width: 14px; }.marker-label { font-size: 8px; }.map-context { left: 10px; bottom: 15px; padding: 7px; font-size: 9px; }.map-context small { font-size: 8px; }.map-scale { display: none; }.map-controls { bottom: 15px; right: 10px; }.map-selection { padding: 12px; }.selection-details { gap: 7px; } }
</style>
