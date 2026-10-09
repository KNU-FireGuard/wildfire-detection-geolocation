<script setup>
import { onMounted, ref } from 'vue'
import { accessToken, logout } from '../auth'
import { recipients } from '../api/workflow'
const items = ref([]), error = ref(''), busy = ref(false), editing = ref(null), loaded = ref(false)
const name = ref(''), phone = ref(''), active = ref(true), deleting = ref(null)
function reset() { editing.value = null; name.value = ''; phone.value = ''; active.value = true }
function edit(item) { editing.value = item.id; name.value = item.name; phone.value = item.phone_number; active.value = item.is_active }
async function action(callback) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await callback() } catch (cause) { error.value = cause.message; if (cause.status === 401) logout() } finally { busy.value = false }
}
async function load() { const list = await recipients.list(accessToken.value); items.value = list.items; loaded.value = true }
async function save() { await action(async () => { const body = { name: name.value.trim(), phone_number: phone.value.trim() }; if (editing.value) await recipients.update(editing.value, { ...body, is_active: active.value }, accessToken.value); else await recipients.create(body, accessToken.value); reset(); await load() }) }
async function remove() { await action(async () => { await recipients.remove(deleting.value.id, accessToken.value); deleting.value = null; await load() }) }
onMounted(() => action(load))
</script>
<template><div class="catalog-page"><h1>SMS 수신자 관리</h1><p>알림을 받을 수신자를 관리합니다. 실제 SMS 발송은 백엔드에서 처리합니다.</p><p v-if="error" role="alert">{{ error }}</p>
  <form class="dashboard-panel recipient-form" @submit.prevent="save"><h2>{{ editing ? '수신자 수정' : '수신자 추가' }}</h2><label>이름<input v-model="name" required maxlength="100" :disabled="busy" /></label><label>휴대전화<input v-model="phone" type="tel" required placeholder="01012345678" :disabled="busy" /></label><label v-if="editing"><input v-model="active" type="checkbox" :disabled="busy" /> 알림 활성화</label><div class="actions"><button class="primary-button" :disabled="busy">저장</button><button v-if="editing" type="button" :disabled="busy" @click="reset">취소</button></div></form>
  <section class="dashboard-panel list"><button :disabled="busy" @click="action(load)">새로고침</button><p v-if="busy" role="status">요청 처리 중입니다.</p><p v-else-if="loaded && !items.length && !error">등록된 수신자가 없습니다.</p><ul><li v-for="item in items" :key="item.id"><span>{{ item.name }} · {{ item.phone_number }} · {{ item.is_active ? '활성' : '비활성' }}</span><button :disabled="busy" @click="edit(item)">수정</button><button :disabled="busy" @click="deleting = item">삭제</button></li></ul><div v-if="deleting" role="alert"><p>{{ deleting.name }} 수신자를 삭제할까요?</p><button :disabled="busy" @click="remove">삭제 확인</button><button :disabled="busy" @click="deleting = null">취소</button></div></section>
</div></template>
<style scoped>.recipient-form { max-width: 600px; display: grid; gap: 12px; }.recipient-form label { display: flex; align-items: center; gap: 12px; }input:not([type='checkbox']) { padding: 10px; min-width: 0; flex: 1; border: 1px solid #ccd7e4; border-radius: 5px; }.actions { display: flex; gap: 10px; }.list { margin-top: 20px; }ul { list-style: none; padding: 0; }li { display: flex; flex-wrap: wrap; gap: 10px; padding: 12px 0; border-bottom: 1px solid #eee; }li span { flex: 1; }button { cursor: pointer; }[role='alert'] { color: #b93434; }h2 { font-size: 18px; }</style>
