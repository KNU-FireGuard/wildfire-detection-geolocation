<script setup>
import { computed } from 'vue'
import { fetchCameras, fetchEvents, fetchVideos } from '../api/catalog'
import { formatConfidence, formatDetectedAt, formatType } from '../utils/eventFormat'
import { useQuery } from '../composables/useQuery'
const props = defineProps({ resource: { type: String, required: true } })
const titles = { cameras: '카메라 목록', videos: '영상 목록', events: '탐지 이벤트' }
const loaders = { cameras: fetchCameras, videos: fetchVideos, events: fetchEvents }
const title = computed(() => titles[props.resource])
const { data, loading, error, reload } = useQuery(() => props.resource, signal => loaders[props.resource]({ signal }))
const rows = computed(() => data.value ?? [])
</script>
<template>
  <div class="catalog-page">
    <header class="page-heading"><h1>{{ title }}</h1><button class="primary-button" :disabled="loading" @click="reload">새로고침</button></header>
    <p v-if="loading" role="status">목록을 불러오는 중입니다.</p>
    <div v-else-if="error" class="dashboard-panel" role="alert"><p>{{ error }}</p><button class="primary-button" @click="reload">다시 시도</button></div>
    <section v-else class="dashboard-panel">
      <p>총 {{ rows.length }}건</p>
      <p v-if="!rows.length" class="empty-message">등록된 {{ resource === 'cameras' ? '카메라가' : resource === 'videos' ? '영상이' : '탐지 이벤트가' }} 없습니다.</p>
      <div v-else class="table-scroll">
        <table v-if="resource === 'cameras'"><caption class="sr-only">카메라 목록</caption><thead><tr><th>ID</th><th>이름</th><th>위도</th><th>경도</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.id }}</td><td>{{ row.name }}</td><td>{{ row.latitude ?? '정보 없음' }}</td><td>{{ row.longitude ?? '정보 없음' }}</td></tr></tbody></table>
        <table v-else-if="resource === 'videos'"><caption class="sr-only">영상 목록</caption><thead><tr><th>ID</th><th>카메라 ID</th><th>파일 이름</th><th>등록 시각</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.id }}</td><td>{{ row.camera_id ?? '정보 없음' }}</td><td>{{ row.original_filename }}</td><td>{{ formatDetectedAt(row.created_at) }}</td></tr></tbody></table>
        <table v-else><caption class="sr-only">탐지 이벤트 목록</caption><thead><tr><th>ID</th><th>탐지 시각</th><th>카메라 ID</th><th>유형</th><th>신뢰도</th><th>상세</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.id }}</td><td>{{ formatDetectedAt(row.detectedAt) }}</td><td>{{ row.cameraId ?? '정보 없음' }}</td><td>{{ formatType(row.type) }}</td><td>{{ formatConfidence(row.confidence) }}</td><td><RouterLink :to="`/events/${row.id}`">상세 보기</RouterLink></td></tr></tbody></table>
      </div>
      <p v-if="resource === 'videos'" class="empty-message">등록된 영상 정보를 표시합니다. 영상 재생 기능은 준비 중입니다.</p>
    </section>
  </div>
</template>
<style scoped>
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }h1 { font-size: 26px; margin: 0; }
.table-scroll { overflow-x: auto; }table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; white-space: nowrap; }th { background: #f5f7fb; }th, td { padding: 14px; border-bottom: 1px solid #edf1f6; }a { color: #337fd4; }.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
