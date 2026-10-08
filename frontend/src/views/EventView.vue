<script setup>
import { fetchCameras, fetchEvent } from '../api/catalog'
import EventDetail from '../components/EventDetail.vue'
import { useQuery } from '../composables/useQuery'
import { formatDetectedAt } from '../utils/eventFormat'
const props = defineProps({ id: { type: String, required: true } })
const { data, loading, error, reload } = useQuery(() => props.id, async signal => {
  const event = await fetchEvent(props.id, { signal })
  let cameras = []
  let cameraError = ''
  if (event.cameraId != null) {
    try { cameras = await fetchCameras({ signal }) } catch (cause) { cameraError = cause.message }
  }
  return { event, camera: cameras.find(camera => camera.id === event.cameraId) ?? null, cameraError }
})
</script>
<template>
  <div class="catalog-page">
    <RouterLink to="/events">← 이벤트 목록</RouterLink>
    <h1>탐지 이벤트 #{{ id }}</h1>
    <p v-if="loading" role="status">상세 정보를 불러오는 중입니다.</p>
    <div v-else-if="error" class="dashboard-panel" role="alert"><p>{{ error }}</p><button class="primary-button" @click="reload">다시 시도</button></div>
    <template v-else-if="data">
      <p v-if="data.cameraError" role="alert">카메라 정보를 가져오지 못했습니다. {{ data.cameraError }}</p>
      <EventDetail :event="data.event" :camera="data.camera" />
      <section class="dashboard-panel metadata"><h2>이벤트 기록</h2><dl>
        <dt>영상 ID</dt><dd>{{ data.event.videoId ?? '정보 없음' }}</dd>
        <dt>종료 시각</dt><dd>{{ data.event.endedAt ? formatDetectedAt(data.event.endedAt) : '종료 시각 없음' }}</dd>
        <dt>등록 시각</dt><dd>{{ data.event.createdAt ? formatDetectedAt(data.event.createdAt) : '정보 없음' }}</dd>
        <dt>수정 시각</dt><dd>{{ data.event.updatedAt ? formatDetectedAt(data.event.updatedAt) : '정보 없음' }}</dd>
      </dl></section>
    </template>
  </div>
</template>
<style scoped>
.metadata { margin-top: 16px; }h2 { font-size: 16px; }dl { display: grid; grid-template-columns: 100px 1fr; gap: 12px; font-size: 13px; }dd { margin: 0; }
</style>
