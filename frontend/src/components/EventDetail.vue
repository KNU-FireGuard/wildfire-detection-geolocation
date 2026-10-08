<script setup>
import { formatConfidence, formatDetectedAt, formatType } from '../utils/eventFormat'

defineProps({ event: { type: Object, default: null }, camera: { type: Object, default: null } })
</script>

<template>
  <section class="dashboard-panel" aria-labelledby="detail-title">
    <h2 id="detail-title">이벤트 상세 정보</h2>
    <div aria-live="polite">
      <p v-if="!event" class="empty-message">이벤트를 선택하면 상세 정보를 확인할 수 있습니다.</p>
      <template v-else>
        <h3>Camera 정보</h3>
        <dl v-if="camera">
          <dt>카메라 ID</dt><dd>{{ camera.id }}</dd>
          <dt>카메라 이름</dt><dd>{{ camera.name }}</dd>
          <dt>위치 이름</dt><dd>{{ camera.locationName }}</dd>
          <dt>카메라 상태</dt><dd>{{ camera.status }}</dd>
          <dt>카메라 위도</dt><dd>{{ camera.latitude }}</dd>
          <dt>카메라 경도</dt><dd>{{ camera.longitude }}</dd>
          <dt>PTZ 모델</dt><dd>{{ camera.ptzModel }}</dd>
        </dl>
        <p v-else>카메라 정보 없음 ({{ event.cameraId }})</p>
        <h3>Detection Event 정보</h3>
        <dl>
          <dt>탐지 시각 (KST)</dt><dd>{{ formatDetectedAt(event.detectedAt) }}</dd>
          <dt>탐지 유형</dt><dd>{{ formatType(event.type) }}</dd>
          <dt>AI 신뢰도</dt><dd>{{ formatConfidence(event.confidence) }}</dd>
          <dt>이벤트 상태</dt><dd>{{ event.status }}</dd>
        </dl>
        <h3>Estimated Location</h3>
        <dl v-if="event.estimatedLocation">
          <dt>추정 위도</dt><dd>{{ event.estimatedLocation.latitude }}</dd>
          <dt>추정 경도</dt><dd>{{ event.estimatedLocation.longitude }}</dd>
          <dt>추정 주소</dt><dd>{{ event.estimatedLocation.address || '추정 주소 정보 없음' }}</dd>
          <dt>오차 반경</dt><dd>{{ event.estimatedLocation.errorRadiusM }} m</dd>
        </dl>
        <p v-else>위치 추정 정보 없음</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
dl { margin: 0; }
h3 { margin: 20px 0 0; font-size: 15px; }
dt { margin-top: 16px; font-size: 13px; color: #64748b; }
dd { margin: 5px 0 0; font-size: 14px; overflow-wrap: anywhere; }
</style>
