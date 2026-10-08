<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  cameras: { type: Array, default: () => [] },
  events: { type: Array, default: () => [] },
  selectedEvent: { type: Object, default: null },
  selectedCamera: { type: Object, default: null },
})
const emit = defineEmits(['select'])
// 이벤트 선택 상태가 아니라, 이벤트 없는 CCTV를 클릭했을 때의 안내만 관리합니다.
const noEventCameraId = ref(null)
const noEventCamera = computed(() => props.cameras.find(camera => camera.id === noEventCameraId.value) ?? null)
watch(() => props.selectedEvent, () => { noEventCameraId.value = null })

function selectCamera(camera) {
  const latestEvent = props.events
    .filter(event => event.cameraId === camera.id)
    .reduce((latest, event) => !latest || Date.parse(event.detectedAt) > Date.parse(latest.detectedAt) ? event : latest, null)
  noEventCameraId.value = latestEvent ? null : camera.id
  if (latestEvent) emit('select', latestEvent.id)
}

// 실제 지도 투영이 아닙니다. 모든 카메라와 추정 위치의 좌표를 20~80%에 배치합니다.
// 선택이 바뀌어도 CCTV가 이동하지 않도록 전체 데이터로 범위를 계산합니다.
const bounds = computed(() => {
  const locations = [...props.cameras, ...props.events.map(event => event.estimatedLocation).filter(Boolean)]
  if (!locations.length) return null
  return {
    minLat: Math.min(...locations.map(location => location.latitude)),
    maxLat: Math.max(...locations.map(location => location.latitude)),
    minLng: Math.min(...locations.map(location => location.longitude)),
    maxLng: Math.max(...locations.map(location => location.longitude)),
  }
})
function markerStyle(location) {
  const range = bounds.value
  if (!range) return { left: '50%', top: '50%' }
  const left = range.maxLng === range.minLng ? 50 : 20 + 60 * (location.longitude - range.minLng) / (range.maxLng - range.minLng)
  const top = range.maxLat === range.minLat ? 50 : 80 - 60 * (location.latitude - range.minLat) / (range.maxLat - range.minLat)
  return { left: `${left}%`, top: `${top}%` }
}
</script>

<template>
  <section class="dashboard-panel" aria-labelledby="map-title">
    <h2 id="map-title">추정 위치</h2>
    <p class="map-caption">임시 지도 · 개발용 데이터 · 파랑: CCTV / 빨강: 추정 산불 위치</p>
    <div class="map-area" aria-label="CCTV 및 산불 추정 위치 임시 지도">
      <button v-for="camera in cameras" :key="camera.id" type="button" class="marker camera-marker"
        :class="{ offline: camera.status === 'OFFLINE', selected: camera.id === selectedCamera?.id }"
        :style="markerStyle(camera)"
        :aria-pressed="camera.id === selectedCamera?.id"
        :aria-label="`${camera.name} ${camera.status} 최근 탐지 이벤트 선택`"
        @click="selectCamera(camera)">{{ camera.name }}<small>{{ camera.status }}</small></button>
      <button v-if="selectedEvent?.estimatedLocation" type="button" class="marker fire-marker"
        :style="markerStyle(selectedEvent.estimatedLocation)" aria-label="선택 이벤트의 추정 산불 위치" aria-pressed="true">추정 산불 위치</button>
    </div>
    <div class="map-selection" aria-live="polite">
      <p v-if="noEventCamera">{{ noEventCamera.name }}: 이 카메라에는 탐지 이벤트가 없습니다.</p>
      <template v-if="selectedEvent">
        <strong>{{ selectedCamera?.name ?? selectedEvent.cameraId }} 선택됨</strong>
        <template v-if="selectedEvent.estimatedLocation">
          <p>{{ selectedCamera?.name ?? selectedEvent.cameraId }} → 추정 위치</p>
          <p>위도 {{ selectedEvent.estimatedLocation.latitude }} · 경도 {{ selectedEvent.estimatedLocation.longitude }}</p>
        </template>
        <p v-else>위치 추정 정보가 없습니다.</p>
      </template>
      <p v-else>이벤트를 선택하면 추정 위치를 확인할 수 있습니다.</p>
    </div>
  </section>
</template>

<style scoped>
.map-caption { color: #64748b; font-size: 13px; }
.map-area { height: 360px; position: relative; border: 1px solid #cbd5e1; border-radius: 8px; background-color: #e8efe8; background-image: linear-gradient(#cbd5e166 1px, transparent 1px), linear-gradient(90deg, #cbd5e166 1px, transparent 1px); background-size: 36px 36px; }
.marker { position: absolute; transform: translate(-50%, -50%); padding: 8px; border: 2px solid #3b82f6; border-radius: 20px; background: #eff6ff; color: #1e40af; cursor: pointer; white-space: nowrap; }
.camera-marker small { display: block; font-size: 9px; margin-top: 3px; }
.camera-marker.offline { border-style: dashed; border-color: #64748b; background: #f1f5f9; color: #64748b; }
.camera-marker.selected { background: #2563eb; border-color: #1d4ed8; color: white; box-shadow: 0 0 0 5px #2563eb33; z-index: 1; }
.fire-marker { border-color: #b91c1c; background: #fee2e2; color: #991b1b; z-index: 2; }
.map-selection { min-height: 72px; margin-top: 16px; overflow-wrap: anywhere; }
.map-selection p { font-size: 14px; color: #475569; }
</style>
