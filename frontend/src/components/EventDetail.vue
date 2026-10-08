<script setup>
import { computed, ref } from 'vue'
import DashboardIcon from './DashboardIcon.vue'
import { formatConfidence, formatDetectedAt, formatType, formatStatus } from '../utils/eventFormat'
const props = defineProps({
  event: { type: Object, default: null },
  camera: { type: Object, default: null },
  videos: { type: Array, default: () => [] },
})
const showDetails = ref(false)
const selectedVideo = computed(() => props.videos.find(video => video.id === props.event?.videoId)
  ?? props.videos.find(video => video.camera_id === props.camera?.id)
  ?? (props.camera ? null : props.videos[0] ?? null))
</script>

<template>
  <section class="dashboard-panel" aria-labelledby="detail-title">
    <div class="panel-heading video-heading">
      <h2 id="detail-title">{{ camera?.name ?? 'CCTV' }} <span class="title-caption">영상</span></h2>
      <span class="camera-status" :class="{ online: camera?.status === 'ONLINE' }"><i />{{ camera?.status === 'ONLINE' ? '온라인' : camera?.status === 'OFFLINE' ? '오프라인' : '상태 정보 없음' }}</span>
    </div>
    <div class="video-placeholder" aria-label="CCTV 영상">
      <video v-if="selectedVideo" :key="selectedVideo.id" controls preload="metadata" :src="`/api/videos/${selectedVideo.id}/stream`">
        이 브라우저는 영상 재생을 지원하지 않습니다.
      </video>
      <div v-else class="video-message"><span class="video-icon"><DashboardIcon name="camera" :size="30" /></span><strong>재생할 영상이 없습니다.</strong><p>영상 목록에 파일을 등록하고 DB에 메타데이터를 추가하세요.</p></div>
      <span v-if="selectedVideo" class="preview-footnote">{{ selectedVideo.original_filename }}</span>
    </div>
    <div class="event-info" aria-live="polite">
      <div class="info-heading"><h3>탐지 이벤트 정보</h3><span v-if="event" class="status-badge" :class="{ pending: event.status === 'UNCONFIRMED', confirmed: event.status === 'CONFIRMED' }">{{ formatStatus(event.status) }}</span></div>
      <p v-if="!event" class="empty-message">이벤트를 선택하면 상세 정보를 확인할 수 있습니다.</p>
      <template v-else>
        <dl class="summary-info">
          <dt>탐지 시각</dt><dd><time :datetime="event.detectedAt">{{ formatDetectedAt(event.detectedAt) }} <small>KST</small></time></dd>
          <dt>CCTV</dt><dd>{{ camera?.name ?? '카메라 정보 없음' }}</dd>
          <dt>탐지 유형</dt><dd>{{ formatType(event.type) }}</dd>
          <dt>AI 신뢰도</dt><dd><span class="confidence-value">{{ formatConfidence(event.confidence) }}</span></dd>
          <dt>추정 위치</dt><dd>{{ event.estimatedLocation ? '위치 추정 완료' : '위치 추정 정보 없음' }}</dd>
        </dl>
        <button type="button" class="primary-button detail-toggle" :aria-expanded="showDetails" aria-controls="extended-detail" @click="showDetails = !showDetails"><DashboardIcon name="bell" :size="18" />{{ showDetails ? '상세 정보 접기' : '상세 정보 보기' }}<DashboardIcon name="arrow" :size="18" /></button>
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
          <dl v-if="event.estimatedLocation" class="extended-info"><dt>추정 위도</dt><dd>{{ event.estimatedLocation.latitude }}</dd><dt>추정 경도</dt><dd>{{ event.estimatedLocation.longitude }}</dd><dt>추정 주소</dt><dd>{{ event.estimatedLocation.address || '추정 주소 정보 없음' }}</dd><dt>오차 반경</dt><dd>{{ event.estimatedLocation.errorRadiusM == null ? '정보 없음' : `${event.estimatedLocation.errorRadiusM} m` }}</dd></dl>
          <p v-else class="empty-message">위치 추정 정보 없음</p>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.video-heading { margin-bottom: 15px; }.title-caption { font-size: 14px; font-weight: 400; color: #7b8a9e; margin-left: 5px; }
.camera-status { display: flex; align-items: center; gap: 7px; font-size: 11px; color: #8090a5; white-space: nowrap; }.camera-status i { width: 7px; height: 7px; background: #a0aaba; border-radius: 50%; }.camera-status.online i { background: #1eb96f; }
.video-placeholder { position: relative; border-radius: 6px; min-height: 220px; overflow: hidden; background: #111; color: white; }
.video-placeholder video { display: block; width: 100%; max-height: 420px; background: #111; }.video-message { min-height: 220px; display: flex; align-items: center; justify-content: center; flex-direction: column; padding: 30px; text-align: center; }.video-icon { display: grid; place-items: center; width: 63px; height: 63px; border: 1px solid #ffffff44; background: #d6edf11a; border-radius: 50%; margin-bottom: 15px; }.video-message strong { font-size: 16px; font-weight: 500; }.video-message p { font-size: 11px; color: #d0dfde; margin: 9px 0 0; }.preview-footnote { position: absolute; left: 8px; bottom: 8px; z-index: 1; max-width: calc(100% - 16px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: 3px; padding: 4px 6px; font-size: 10px; color: white; background: #101820b3; }
.event-info { margin-top: 22px; }.info-heading { background: #f4f7fb; padding: 11px 10px; display: flex; justify-content: space-between; align-items: center; gap: 8px; border-radius: 4px; }.info-heading h3 { margin: 0; font-size: 16px; letter-spacing: -.5px; }
.summary-info { margin: 0 0 15px; display: grid; grid-template-columns: 90px minmax(0, 1fr); font-size: 12px; }
.summary-info dt, .summary-info dd { margin: 0; padding: 13px 8px; border-bottom: 1px solid #edf1f6; overflow-wrap: anywhere; }.summary-info dt { color: #72829a; }.summary-info dd { color: #35475f; }.summary-info time { font-size: 11px; }.summary-info small { font-size: 9px; color: #98a4b5; }.confidence-value { font-weight: 700; }
.detail-toggle { width: 100%; }.detail-toggle svg:last-child { margin-left: auto; }.detail-toggle svg:first-child { margin-left: auto; }
.extended-detail { margin-top: 24px; border-top: 1px solid #e9eef5; padding-top: 4px; }.extended-detail h4 { font-size: 12px; color: #337fd4; margin: 20px 0 9px; }
.extended-info { display: grid; grid-template-columns: 100px minmax(0, 1fr); margin: 0; gap: 10px 12px; font-size: 11px; }.extended-info dt { color: #7a8ba1; }.extended-info dd { margin: 0; overflow-wrap: anywhere; line-height: 1.5; }
@media (max-width: 960px) { .video-placeholder { height: 300px; } }
@media (max-width: 600px) { .video-placeholder { height: 220px; }.summary-info { grid-template-columns: 78px minmax(0, 1fr); } }
</style>
