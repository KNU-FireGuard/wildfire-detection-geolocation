<script setup>
import { formatConfidence, formatDetectedAt, formatType } from '../utils/eventFormat'
defineProps({ event: { type: Object, default: null } })
</script>

<template>
  <section class="dashboard-panel" aria-labelledby="detail-title">
    <h2 id="detail-title">이벤트 상세 정보</h2>
    <div aria-live="polite">
      <p v-if="!event" class="empty-message">이벤트를 선택하면 상세 정보를 확인할 수 있습니다.</p>
      <dl v-else>
        <dt>카메라 ID</dt><dd>{{ event.cameraId }}</dd>
        <dt>카메라 이름</dt><dd>{{ event.cameraName }}</dd>
        <dt>탐지 시각 (KST)</dt><dd>{{ formatDetectedAt(event.detectedAt) }}</dd>
        <dt>탐지 유형</dt><dd>{{ formatType(event.type) }}</dd>
        <dt>AI 신뢰도</dt><dd>{{ formatConfidence(event.confidence) }}</dd>
        <template v-if="event.location">
          <dt>추정 위도</dt><dd>{{ event.location.latitude }}</dd>
          <dt>추정 경도</dt><dd>{{ event.location.longitude }}</dd>
        </template>
        <template v-else><dt>추정 위도 / 경도</dt><dd>위치 추정 정보 없음</dd></template>
        <dt>추정 주소</dt><dd>{{ event.estimatedAddress || '추정 주소 정보 없음' }}</dd>
        <dt>상태</dt><dd>{{ event.status }}</dd>
      </dl>
    </div>
  </section>
</template>

<style scoped>
dl { margin: 0; }
dt { margin-top: 16px; font-size: 13px; color: #64748b; }
dd { margin: 5px 0 0; font-size: 14px; overflow-wrap: anywhere; }
</style>
