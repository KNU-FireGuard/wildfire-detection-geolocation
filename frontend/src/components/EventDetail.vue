<script setup>
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import RecordedVideo from './RecordedVideo.vue'
import EventCaptures from './EventCaptures.vue'
import DashboardIcon from './DashboardIcon.vue'
import { formatConfidence, formatDetectedAt, formatType, formatStatus } from '../utils/eventFormat'
import { errorRangeDisplay } from '../maps/naverScene'
const LiveVideo = defineAsyncComponent(() => import('./LiveVideo.vue'))
const LiveMirror = defineAsyncComponent(() => import('./LiveMirror.vue'))
const TestRunPanel = defineAsyncComponent(() => import('./TestRunPanel.vue'))
const props = defineProps({
  event: { type: Object, default: null },
  camera: { type: Object, default: null },
  videos: { type: Array, default: () => [] },
  // true이면 지도 아래 실시간 CCTV 영상에서 재생 중인 같은 영상을 공유하고 영상 서버에 다시 접속하지 않음
  mirror: { type: Boolean, default: false },
  closable: { type: Boolean, default: false },
})
const emit = defineEmits(['test-progress', 'test-started', 'close'])
const showDetails = ref(false)
const rangeDisplay = computed(() => errorRangeDisplay(props.event?.estimatedLocation))
const activeVideoId = ref(null)
const playbackPosition = ref(0)
const playbackSequence = ref(0)
const testVideoId = computed(() => activeVideoId.value ?? props.event?.videoId
  ?? props.videos.find(video => video.camera_id === props.camera?.id)?.id ?? null)
watch(() => props.camera?.id, () => { activeVideoId.value = null; playbackPosition.value = 0; playbackSequence.value++ })
function startPlayback(run) {
  activeVideoId.value = run.video_id
  playbackPosition.value = 0
  playbackSequence.value++
  emit('test-started', run)
}
function seekCapture(seconds) {
  activeVideoId.value = props.event?.videoId ?? testVideoId.value
  playbackPosition.value = seconds
  playbackSequence.value++
}
const cameraStatusLabel = computed(() => {
  if (props.camera?.sourceType === 'live') return ({
    running: 'AI 감시 중', starting: 'AI 시작 중', restarting: 'AI 재시작 중',
    waiting_for_ai: 'AI 연결 대기', waiting_for_cctv: 'CCTV 연결 대기',
  })[props.camera.monitorState] ?? 'AI 감시 상태 없음'
  return props.camera?.status === 'ONLINE' ? '온라인'
    : props.camera?.status === 'OFFLINE' ? '오프라인' : '상태 정보 없음'
})
</script>

<template>
  <section class="dashboard-panel" aria-labelledby="detail-title">
    <div class="panel-heading video-heading">
      <h2 id="detail-title">{{ camera?.name ?? 'CCTV' }} <span class="title-caption">영상</span></h2>
      <div class="video-actions">
        <span class="camera-status" :class="{ online: camera?.monitorState === 'running' || camera?.status === 'ONLINE' }"><i />{{ cameraStatusLabel }}</span>
        <button v-if="closable" type="button" class="close-cctv" @click="emit('close')">CCTV 닫기</button>
      </div>
    </div>
    <div class="video-placeholder" aria-label="CCTV 영상">
      <template v-if="camera?.sourceType === 'live' && camera.streamUrl">
        <LiveMirror v-if="mirror" :key="camera.id" :camera-id="camera.id" :url="camera.streamUrl" />
        <LiveVideo v-else :key="camera.id" :url="camera.streamUrl" />
      </template>
      <div v-else-if="camera?.sourceType === 'live'" class="video-message"><span class="video-icon"><DashboardIcon name="camera" :size="30" /></span><strong>실시간 영상 주소가 없습니다.</strong><p>CCTV 목록을 갱신한 뒤 다시 확인하세요.</p></div>
      <RecordedVideo v-else-if="camera?.sourceType === 'test' && testVideoId" :video-id="testVideoId" :position="playbackPosition" :sequence="playbackSequence" />
      <div v-else-if="camera?.sourceType === 'test'" class="video-message"><span class="video-icon"><DashboardIcon name="camera" :size="30" /></span><strong>Test 분석을 시작하면 원본 영상을 재생합니다.</strong><p>확정 탐지는 아래 캡처에서 확인할 수 있습니다.</p></div>
      <div v-else class="video-message"><span class="video-icon"><DashboardIcon name="camera" :size="30" /></span><strong>재생할 영상이 없습니다.</strong><p>data/videos에 원본 영상을 넣고 카메라에 연결해 주세요.</p></div>
    </div>
    <TestRunPanel v-if="camera?.sourceType === 'test'" :camera-id="camera.id" @started="startPlayback" @events-updated="emit('test-progress')" />
    <div class="event-info" aria-live="polite">
      <div class="info-heading"><h3>탐지 이벤트 정보</h3><span v-if="event" class="status-badge" :class="{ pending: event.status === 'UNCONFIRMED', confirmed: event.status === 'CONFIRMED' }">{{ formatStatus(event.status) }}</span></div>
      <p v-if="!event" class="empty-message">이벤트를 선택하면 상세 정보를 확인할 수 있습니다.</p>
      <template v-else>
        <dl class="summary-info">
          <dt>탐지 시각</dt><dd><time :datetime="event.detectedAt">{{ formatDetectedAt(event.detectedAt) }} <small>KST</small></time></dd>
          <dt>CCTV</dt><dd>{{ camera?.name ?? '카메라 정보 없음' }}</dd>
          <dt>탐지 유형</dt><dd>{{ formatType(event.type) }}</dd>
          <dt>추정 위치</dt><dd>{{ event.estimatedLocation ? '위치 추정 완료' : '위치 추정 정보 없음' }}</dd>
        </dl>
        <button type="button" class="primary-button detail-toggle" :aria-expanded="showDetails" aria-controls="extended-detail" @click="showDetails = !showDetails"><DashboardIcon name="bell" :size="18" />{{ showDetails ? '상세 정보 접기' : '상세 정보 보기' }}<DashboardIcon name="arrow" :size="18" /></button>
        <EventCaptures v-if="event.videoId" :event-id="event.id" :latest-capture="event.latestCapture" @seek="seekCapture" />
        <div v-if="showDetails" id="extended-detail" class="extended-detail">
          <h4>Camera 정보</h4>
          <dl v-if="camera" class="extended-info">
            <dt>Camera ID</dt><dd>{{ camera.id }}</dd>
            <dt>Camera 이름</dt><dd>{{ camera.name }}</dd>
            <dt>위치 이름</dt><dd>{{ camera.locationName ?? '정보 없음' }}</dd>
            <dt>Camera 상태</dt><dd>{{ camera.status ?? '정보 없음' }}</dd>
            <dt>Camera 위도</dt><dd>{{ camera.latitude ?? '정보 없음' }}</dd>
            <dt>Camera 경도</dt><dd>{{ camera.longitude ?? '정보 없음' }}</dd>
            <dt>PTZ 모델</dt><dd>{{ camera.ptzModel ?? '정보 없음' }}</dd>
          </dl>
          <p v-else class="empty-message">카메라 정보 없음<span v-if="event.cameraId != null"> ({{ event.cameraId }})</span></p>
          <h4>Detection Event 정보</h4>
          <dl class="extended-info"><dt>Event ID</dt><dd>{{ event.id }}</dd><dt>탐지 시각 (KST)</dt><dd>{{ formatDetectedAt(event.detectedAt) }}</dd><dt>탐지 유형</dt><dd>{{ formatType(event.type) }}</dd><dt>AI 신뢰도</dt><dd>{{ formatConfidence(event.confidence) }}</dd><dt>이벤트 상태</dt><dd>{{ formatStatus(event.status) }}</dd></dl>
          <h4>Estimated Location</h4>
          <dl v-if="event.estimatedLocation" class="extended-info"><dt>추정 위도</dt><dd>{{ event.estimatedLocation.latitude }}</dd><dt>추정 경도</dt><dd>{{ event.estimatedLocation.longitude }}</dd><dt>추정 주소</dt><dd>{{ event.estimatedLocation.address || '추정 주소 정보 없음' }}</dd><dt>오차 범위</dt><dd>{{ rangeDisplay.label }}</dd></dl>
          <p v-else class="empty-message">위치 추정 정보 없음</p>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.video-heading { margin-bottom: 15px; align-items: flex-start; }.title-caption { font-size: 13px; font-weight: 400; color: var(--text-3); margin-left: 6px; }.video-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 7px; }.close-cctv { border: 1px solid var(--line-strong); border-radius: 8px; padding: 5px 9px; background: var(--surface-2); color: var(--text-2); font-size: 11px; white-space: nowrap; cursor: pointer; }.close-cctv:hover { border-color: var(--accent); color: var(--text); }
.camera-status { display: flex; align-items: center; gap: 7px; padding: 4px 11px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface-2); font-size: 11px; color: var(--text-2); white-space: nowrap; }.camera-status i { width: 7px; height: 7px; background: var(--text-3); border-radius: 50%; }.camera-status.online i { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
.video-placeholder { position: relative; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: #05080c; color: var(--text); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45); }
.video-placeholder video, .video-placeholder .test-frame { display: block; width: 100%; height: auto; aspect-ratio: auto 16 / 9; max-height: 420px; background: #05080c; }.video-message { min-height: 220px; display: flex; align-items: center; justify-content: center; flex-direction: column; padding: 30px; text-align: center; }.video-icon { display: grid; place-items: center; width: 63px; height: 63px; border: 1px solid var(--line-strong); background: var(--surface-2); color: var(--text-2); border-radius: 50%; margin-bottom: 15px; }.video-message strong { font-size: 15px; font-weight: 600; }.video-message p { font-size: 12px; color: var(--text-2); margin: 9px 0 0; }
.event-info { margin-top: 22px; }.info-heading { background: var(--surface-2); border: 1px solid var(--line); padding: 11px 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; border-radius: 10px; }.info-heading h3 { margin: 0; font-size: 14px; font-weight: 650; letter-spacing: -0.3px; }
.summary-info { margin: 0 0 15px; display: grid; grid-template-columns: 90px minmax(0, 1fr); font-size: 12px; }
.summary-info dt, .summary-info dd { margin: 0; padding: 13px 8px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }.summary-info dt { color: var(--text-3); }.summary-info dd { color: var(--text); }.summary-info time { font-size: 11px; }.summary-info small { font-size: 9px; color: var(--text-3); }.confidence-value { font-weight: 700; color: var(--text); }
.detail-toggle { width: 100%; }.detail-toggle svg:last-child { margin-left: auto; }.detail-toggle svg:first-child { margin-left: auto; }
.extended-detail { margin-top: 24px; border-top: 1px solid var(--line); padding-top: 4px; }.extended-detail h4 { font-size: 12px; color: var(--accent); margin: 20px 0 9px; }
.extended-info { display: grid; grid-template-columns: 100px minmax(0, 1fr); margin: 0; gap: 10px 12px; font-size: 11px; }.extended-info dt { color: var(--text-3); }.extended-info dd { margin: 0; overflow-wrap: anywhere; line-height: 1.5; color: var(--text); }
@media (max-width: 600px) { .summary-info { grid-template-columns: 78px minmax(0, 1fr); } }
</style>
