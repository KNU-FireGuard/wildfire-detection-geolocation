// 관리자 API(/api/admin/*) 호출입니다. API 실패를 mock 데이터로 대체하지 않습니다.
const PHONE_PATTERN = /^010\d{8}$/
const PAGE_SIZE = 100 // Backend에서 허용하는 최대 페이지 크기

function authError(message) {
  const error = new Error(message)
  error.code = 'unauthorized'
  return error
}

async function request(path, token, options = {}, label = '관리자 API') {
  let response
  try {
    response = await fetch(path, {
      ...options,
      headers: { Accept: 'application/json', ...options.headers, Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new Error(`${label}에 연결할 수 없습니다. Backend 서버 실행 상태를 확인해주세요.`)
  }
  if (response.status === 401) throw authError('로그인이 만료되었습니다. 다시 로그인해주세요.')
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `${label} 요청에 실패했습니다. (HTTP ${response.status})`)
  }
  return response.json()
}

async function fetchPages(resource, token, label, signal) {
  const items = []
  let offset = 0
  while (true) {
    const page = await request(`/api/admin/${resource}?limit=${PAGE_SIZE}&offset=${offset}`, token, { signal }, label)
    if (!Array.isArray(page?.items) || page.limit !== PAGE_SIZE || page.offset !== offset || page.items.length > PAGE_SIZE) {
      throw new Error(`${label} 응답 형식이 올바르지 않습니다.`)
    }
    items.push(...page.items)
    if (page.items.length < PAGE_SIZE) return items
    offset += PAGE_SIZE
  }
}

// 하이픈·공백을 제거하고 빈 값은 null(번호 해제)로 바꿉니다.
export function normalizeAlertPhone(input) {
  const digits = String(input ?? '').replace(/[\s-]/g, '')
  if (digits === '') return null
  if (!PHONE_PATTERN.test(digits)) throw new Error('번호는 010으로 시작하는 휴대전화 11자리여야 합니다.')
  return digits
}

function normalizeAdminCamera(camera) {
  return { id: camera.id, name: camera.name, sourceType: camera.source_type, alertPhone: camera.alert_phone ?? null }
}

export async function fetchAdminCameras(token, { signal } = {}) {
  return (await fetchPages('cameras', token, '카메라 알림 번호', signal)).map(normalizeAdminCamera)
}

export async function updateAlertPhone(cameraId, input, token) {
  if (!Number.isSafeInteger(cameraId) || cameraId < 1) throw new Error('올바른 카메라 번호가 아닙니다.')
  const alertPhone = normalizeAlertPhone(input)
  const saved = await request(`/api/admin/cameras/${cameraId}/alert-phone`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alert_phone: alertPhone }),
  }, '알림 번호 저장')
  return { id: saved.id, name: saved.name, alertPhone: saved.alert_phone ?? null }
}

function normalizeSmsLog(log) {
  return {
    id: log.id, cameraId: log.camera_id, cameraName: log.camera_name, eventId: log.event_id,
    phoneNumber: log.phone_number, message: log.message, status: log.status,
    provider: log.provider, error: log.error, createdAt: log.created_at,
  }
}

// 최신 100건만 조회합니다.
export async function fetchSmsLogs(token, { signal } = {}) {
  const page = await request(`/api/admin/sms-logs?limit=${PAGE_SIZE}&offset=0`, token, { signal }, '문자 발송 내역')
  if (!Array.isArray(page?.items)) throw new Error('문자 발송 내역 응답 형식이 올바르지 않습니다.')
  return page.items.map(normalizeSmsLog)
}

export async function deleteSmsLogs(ids, token) {
  return request('/api/admin/sms-logs', token, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  }, '문자 발송 내역 삭제')
}
