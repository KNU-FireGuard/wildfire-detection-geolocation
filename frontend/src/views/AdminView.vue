<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { loginAdmin } from '../api/catalog'
import { fetchAdminCameras, fetchSmsLogs, updateAlertPhone, deleteSmsLogs } from '../api/admin'
import { useAdminSession } from '../composables/useAdminSession'
import { formatDetectedAt } from '../utils/eventFormat'

const { token, isLoggedIn, signIn, signOut } = useAdminSession()
const username = ref('')
const password = ref('')
const loginBusy = ref(false)
const notice = ref('')

const cameras = ref([])
const drafts = ref({})
const rowState = ref({})
const camerasLoading = ref(false)
const camerasError = ref('')

const logs = ref([])
const logsLoading = ref(false)
const logsError = ref('')
const selectedLogs = ref(new Set())
const logsDeleting = ref(false)
const deleteNotice = ref('')
const deleteError = ref('')
let active = true
onBeforeUnmount(() => { active = false })
const allLogsSelected = computed(() => logs.value.length > 0 && logs.value.every(log => selectedLogs.value.has(log.id)))
function selectLog(id, checked) {
  const next = new Set(selectedLogs.value)
  if (checked) next.add(id)
  else next.delete(id)
  selectedLogs.value = next
}
function selectAllLogs(checked) { selectedLogs.value = checked ? new Set(logs.value.map(log => log.id)) : new Set() }
async function removeSelectedLogs() {
  if (logsDeleting.value || logsLoading.value || !selectedLogs.value.size) return
  const ids = [...selectedLogs.value]
  if (!window.confirm(`선택한 문자 발송 내역 ${ids.length}건을 삭제할까요?`)) return
  const sessionToken = token.value
  logsDeleting.value = true
  deleteNotice.value = ''; deleteError.value = ''
  try {
    const result = await deleteSmsLogs(ids, sessionToken)
    if (!active || token.value !== sessionToken) return
    const removed = new Set(ids)
    logs.value = logs.value.filter(log => !removed.has(log.id))
    selectedLogs.value = new Set()
    deleteNotice.value = `${result.count}건을 삭제했습니다.`
  } catch (error) {
    if (active && token.value === sessionToken && !expire(error)) deleteError.value = error.message
  } finally { logsDeleting.value = false }
}

const STATUS = {
  sent: { label: '발송 요청 수락', tone: 'ok' },
  failed: { label: '발송 실패', tone: 'error' },
  skipped: { label: '번호 없음', tone: 'muted' },
}

function expire(error) {
  if (error.code !== 'unauthorized') return false
  signOut()
  notice.value = error.message
  return true
}

async function login() {
  loginBusy.value = true
  notice.value = ''
  try {
    signIn(await loginAdmin(username.value, password.value))
    password.value = ''
  } catch (error) {
    notice.value = error.message
  } finally {
    loginBusy.value = false
  }
}

async function loadCameras() {
  camerasLoading.value = true
  camerasError.value = ''
  try {
    cameras.value = await fetchAdminCameras(token.value)
    drafts.value = Object.fromEntries(cameras.value.map(camera => [camera.id, camera.alertPhone ?? '']))
    rowState.value = {}
  } catch (error) {
    if (!expire(error)) camerasError.value = error.message
  } finally {
    camerasLoading.value = false
  }
}

async function loadLogs() {
  if (logsDeleting.value || logsLoading.value) return
  const sessionToken = token.value
  logsLoading.value = true
  logsError.value = ''
  try {
    const items = await fetchSmsLogs(sessionToken)
    if (!active || token.value !== sessionToken) return
    logs.value = items
    const available = new Set(items.map(log => log.id))
    selectedLogs.value = new Set([...selectedLogs.value].filter(id => available.has(id)))
  } catch (error) {
    if (active && token.value === sessionToken && !expire(error)) logsError.value = error.message
  } finally {
    logsLoading.value = false
  }
}

async function save(camera) {
  rowState.value = { ...rowState.value, [camera.id]: { busy: true, message: '', error: false } }
  try {
    const saved = await updateAlertPhone(camera.id, drafts.value[camera.id], token.value)
    camera.alertPhone = saved.alertPhone
    drafts.value = { ...drafts.value, [camera.id]: saved.alertPhone ?? '' }
    rowState.value = { ...rowState.value, [camera.id]: { busy: false, message: saved.alertPhone ? '저장했습니다.' : '번호를 해제했습니다.', error: false } }
  } catch (error) {
    if (expire(error)) return
    rowState.value = { ...rowState.value, [camera.id]: { busy: false, message: error.message, error: true } }
  }
}

function logout() {
  signOut()
  cameras.value = []
  logs.value = []
  notice.value = ''
}

watch(isLoggedIn, loggedIn => {
  if (!loggedIn) { selectedLogs.value = new Set(); deleteNotice.value = ''; deleteError.value = ''; return }
  loadCameras()
  loadLogs()
}, { immediate: true })
</script>

<template>
  <div class="catalog-page admin-page">
    <header class="page-heading">
      <h1>문자 알림 관리</h1>
      <button v-if="isLoggedIn" type="button" class="secondary-button" @click="logout">로그아웃</button>
    </header>

    <section v-if="!isLoggedIn" class="dashboard-panel admin-login" aria-label="관리자 로그인">
      <h2>관리자 로그인</h2>
      <form @submit.prevent="login">
        <label>아이디<input v-model="username" autocomplete="username" required></label>
        <label>비밀번호<input v-model="password" type="password" autocomplete="current-password" required></label>
        <button type="submit" class="primary-button" :disabled="loginBusy">{{ loginBusy ? '로그인 중' : '로그인' }}</button>
      </form>
      <p v-if="notice" class="form-error" role="alert">{{ notice }}</p>
    </section>

    <template v-else>
      <section class="dashboard-panel" aria-label="카메라별 알림 번호">
        <div class="section-heading">
          <h2>카메라별 알림 번호</h2>
          <button type="button" class="secondary-button" :disabled="camerasLoading" @click="loadCameras">새로고침</button>
        </div>
        <p class="hint">해당 카메라에서 화재(fire)가 탐지되면 이 번호로 문자를 보냅니다. 연기(smoke)는 보내지 않습니다. 번호를 비우면 발송하지 않습니다.</p>
        <p v-if="camerasLoading" role="status">불러오는 중입니다.</p>
        <p v-else-if="camerasError" class="form-error" role="alert">{{ camerasError }}</p>
        <p v-else-if="!cameras.length" class="empty-message">등록된 카메라가 없습니다.</p>
        <div v-else class="table-scroll">
          <table>
            <caption class="sr-only">카메라별 알림 번호</caption>
            <thead><tr><th>카메라</th><th>구분</th><th>알림 번호</th><th>저장</th></tr></thead>
            <tbody>
              <tr v-for="camera in cameras" :key="camera.id">
                <td>{{ camera.name }}</td>
                <td>{{ camera.sourceType === 'live' ? '실시간' : 'Test' }}</td>
                <td><input v-model="drafts[camera.id]" inputmode="numeric" placeholder="01012345678" :aria-label="`${camera.name} 알림 번호`" @keyup.enter="save(camera)"></td>
                <td>
                  <div class="save-cell">
                    <button type="button" class="primary-button compact" :disabled="rowState[camera.id]?.busy" @click="save(camera)">저장</button>
                    <span v-if="rowState[camera.id]?.message" :class="rowState[camera.id].error ? 'form-error' : 'form-ok'" role="status">{{ rowState[camera.id].message }}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="dashboard-panel" aria-label="문자 발송 내역">
        <div class="section-heading">
          <h2>문자 발송 내역</h2>
          <button type="button" class="secondary-button" :disabled="logsLoading || logsDeleting" @click="loadLogs">새로고침</button>
        </div>
        <p class="hint">최근 100건입니다. 발송 요청 수락은 문자 제공자가 요청을 받았다는 뜻이며 단말 수신 확인은 아닙니다.</p>
        <div class="log-actions">
          <span>선택 {{ selectedLogs.size }}건</span>
          <button type="button" class="secondary-button delete-button" :disabled="logsDeleting || logsLoading || !selectedLogs.size" @click="removeSelectedLogs">{{ logsDeleting ? '삭제 중' : '선택 삭제' }}</button>
        </div>
        <p v-if="deleteNotice" class="form-ok" role="status">{{ deleteNotice }}</p>
        <p v-if="deleteError" class="form-error" role="alert">{{ deleteError }}</p>
        <p v-if="logsLoading" role="status">불러오는 중입니다.</p>
        <p v-else-if="logsError" class="form-error" role="alert">{{ logsError }}</p>
        <p v-else-if="!logs.length" class="empty-message">발송 내역이 없습니다.</p>
        <div v-else class="table-scroll">
          <table>
            <caption class="sr-only">문자 발송 내역</caption>
            <thead><tr><th><input type="checkbox" aria-label="문자 발송 내역 전체 선택" :checked="allLogsSelected" :indeterminate="selectedLogs.size > 0 && !allLogsSelected" :disabled="logsDeleting" @change="selectAllLogs($event.target.checked)"></th><th>시각</th><th>카메라</th><th>번호</th><th>상태</th><th>제공자</th><th>문구</th><th>사유</th></tr></thead>
            <tbody>
              <tr v-for="log in logs" :key="log.id">
                <td><input type="checkbox" :aria-label="`${log.cameraName ?? '카메라 정보 없음'} ${formatDetectedAt(log.createdAt)} 발송 내역 선택`" :checked="selectedLogs.has(log.id)" :disabled="logsDeleting" @change="selectLog(log.id, $event.target.checked)"></td>
                <td class="time-cell">{{ formatDetectedAt(log.createdAt) }}</td>
                <td>{{ log.cameraName ?? '카메라 정보 없음' }}</td>
                <td>{{ log.phoneNumber ?? '-' }}</td>
                <td><span class="badge" :class="STATUS[log.status]?.tone">{{ STATUS[log.status]?.label ?? log.status }}</span></td>
                <td>{{ log.provider }}</td>
                <td class="message-cell">{{ log.message }}</td>
                <td>{{ log.error ?? '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.admin-page { display: grid; gap: 20px; align-content: start; }
.log-actions { display: flex; align-items: center; gap: 12px; margin: 14px 0; }
.delete-button { color: var(--fire); border-color: var(--fire); }
input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }
.page-heading, .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
h1 { font-size: 26px; font-weight: 800; letter-spacing: -0.8px; margin: 0; }
.hint { color: var(--text-3); font-size: 12px; line-height: 1.6; }
.admin-login { max-width: 420px; }
.admin-login form { display: grid; gap: 14px; margin-top: 14px; }
label { display: grid; gap: 5px; font-size: 12px; color: var(--text-2); }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
th { background: var(--surface-2); color: var(--text-3); font-weight: 600; font-size: 12px; letter-spacing: 0.3px; white-space: nowrap; }
th, td { padding: 12px 14px; border-bottom: 1px solid var(--line); vertical-align: middle; }
td { color: var(--text); }
.save-cell { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
.time-cell { white-space: nowrap; }
.message-cell { min-width: 260px; }
.compact { padding: 8px 14px; }
.secondary-button { border: 1px solid var(--line-strong); background: var(--surface); color: var(--text); border-radius: 10px; padding: 9px 15px; font-size: 13px; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.secondary-button:hover:not(:disabled) { background: var(--surface-3); border-color: var(--accent); }
.secondary-button:disabled { opacity: 0.5; cursor: default; }
.form-error { color: var(--fire); font-size: 12px; }
.form-ok { color: var(--ok); font-size: 12px; }
.badge { display: inline-block; padding: 3px 10px; border: 1px solid var(--line); border-radius: 999px; font-size: 12px; white-space: nowrap; background: var(--surface-3); color: var(--text-2); }
.badge.ok { background: var(--ok-soft); color: var(--ok); border-color: rgba(54, 214, 163, 0.3); }
.badge.error { background: var(--fire-soft); color: var(--fire); border-color: rgba(255, 106, 87, 0.3); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
