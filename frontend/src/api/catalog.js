// feature/backend의 GET /api/cameras, GET /api/events 응답을 UI 모델로 변환합니다.
// Backend에서 제공하지 않는 필드는 null로 유지하며 mock 값으로 채우지 않습니다.
function normalizeCamera(camera) {
  return {
    id: camera.id,
    name: camera.name,
    sourceType: camera.source_type,
    latitude: camera.latitude,
    longitude: camera.longitude,
    createdAt: camera.created_at ?? null,
    providerKey: camera.provider_key ?? null,
    locationName: null,
    altitudeM: null,
    status: null,
    ptzModel: null,
    panDeg: null,
    tiltDeg: null,
    zoom: null,
    hfovDeg: null,
    vfovDeg: null,
  }
}

function normalizeEvent(event) {
  const hasLocation = Number.isFinite(event.estimated_latitude) && Number.isFinite(event.estimated_longitude)
  return {
    id: event.id,
    cameraId: event.camera_id,
    videoId: event.video_id,
    endedAt: event.ended_at,
    createdAt: event.created_at,
    updatedAt: event.updated_at,
    detectedAt: event.started_at,
    type: event.class,
    confidence: event.max_confidence,
    latestCapture: event.latest_capture ?? null,
    estimatedLocation: hasLocation ? {
      latitude: event.estimated_latitude,
      longitude: event.estimated_longitude,
      address: null,
      errorRadiusM: event.error_range_m,
    } : null,
    // 운영자가 확인한 시각이 있으면 확인 완료, 없으면 확인 대기입니다. ended_at은 종료 시각이라 상태와 무관합니다.
    acknowledgedAt: event.acknowledged_at ?? null,
    // 서버가 계산한 값: 확인하지 않았고 마지막 탐지가 30분 안인 화재 이벤트
    alerting: event.is_alerting === true,
    popupAlerting: typeof event.is_popup_alerting === 'boolean' ? event.is_popup_alerting : null,
    status: event.acknowledged_at ? 'CONFIRMED' : 'UNCONFIRMED',
  }
}

async function fetchAll(resource, label, signal) {
  const items = []
  const limit = 100 // Backend에서 허용하는 최대 페이지 크기
  let offset = 0
  while (true) {
    let response
    try {
      response = await fetch(`/api/${resource}?limit=${limit}&offset=${offset}`, {
        signal,
        headers: { Accept: 'application/json' },
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new Error(`${label} API에 연결할 수 없습니다. Backend 서버 실행 상태를 확인해주세요.`)
    }
    if (!response.ok) throw new Error(`${label} 조회에 실패했습니다. (HTTP ${response.status})`)
    let page
    try {
      page = await response.json()
    } catch {
      throw new Error(`${label} API 응답이 JSON 형식이 아닙니다.`)
    }
    if (!Array.isArray(page?.items) || page.limit !== limit || page.offset !== offset || page.items.length > limit) {
      throw new Error(`${label} API 응답 형식이 올바르지 않습니다.`)
    }
    items.push(...page.items)
    if (page.items.length < limit) return items
    offset += limit
  }
}

export async function fetchCameras({ signal } = {}) {
  return (await fetchAll('cameras', '카메라', signal)).map(normalizeCamera)
}

export async function fetchEvents({ signal } = {}) {
  return (await fetchAll('events', '탐지 이벤트', signal)).map(normalizeEvent)
}

export async function fetchVideos({ signal } = {}) {
  return fetchAll('videos', '영상', signal)
}

export async function fetchEventCaptures(eventId, { offset = 0, before, signal } = {}) {
  if (!Number.isSafeInteger(eventId) || eventId < 1 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('올바르지 않은 캡처 조회입니다.')
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 0)) throw new Error('올바르지 않은 캡처 시각입니다.')
  const cursor = before === undefined ? '' : `&before_time_ms=${before}`
  const response = await fetch(`/api/events/${eventId}/captures?limit=20&offset=${offset}${cursor}`, { signal })
  if (!response.ok) throw new Error(`탐지 캡처 조회에 실패했습니다. (HTTP ${response.status})`)
  const result = await response.json()
  if (!Array.isArray(result?.items) || result.limit !== 20 || result.offset !== offset
    || result.items.some(item => !Number.isSafeInteger(item.id) || !Number.isFinite(item.video_time_ms)
      || item.video_time_ms < 0 || item.image_url !== `/api/event-captures/${item.id}/image`)) {
    throw new Error('탐지 캡처 응답이 올바르지 않습니다.')
  }
  return result
}

export async function fetchLiveCctvs({ signal } = {}) {
  let response
  try { response = await fetch('/api/live-cctvs', { signal, headers: { Accept: 'application/json' } }) }
  catch (error) {
    if (signal?.aborted) throw error
    throw new Error('실시간 CCTV API에 연결할 수 없습니다.')
  }
  if (!response.ok) throw new Error(`실시간 CCTV 조회에 실패했습니다. (HTTP ${response.status})`)
  const data = await response.json()
  if (data?.source !== 'live' || !Array.isArray(data.items)) {
    throw new Error('실시간 CCTV 응답 형식이 올바르지 않습니다.')
  }
  return {
    source: data.source,
    refreshedAt: data.refreshedAt,
    cameras: data.items.map(item => ({
      id: item.cameraId ?? `its:${item.providerKey}`, providerKey: item.providerKey,
      name: item.name, sourceType: 'live',
      latitude: item.latitude, longitude: item.longitude, streamUrl: item.streamUrl,
      status: null, locationName: null, altitudeM: null, ptzModel: null,
      panDeg: null, tiltDeg: null, zoom: null, hfovDeg: null, vfovDeg: null,
    })),
  }
}

async function postPublic(url, label) {
  try {
    return await fetch(url, { method: 'POST', signal: AbortSignal.timeout(15000) })
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error(`${label} 요청 시간이 초과되었습니다. 다시 시도해주세요.`)
    throw new Error(`${label} API에 연결할 수 없습니다. Backend 서버 연결을 확인해주세요.`)
  }
}

export async function refreshLiveCctvs() {
  const response = await postPublic('/api/live-cctvs/refresh', 'CCTV 목록 갱신')
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `CCTV 목록 갱신에 실패했습니다. (HTTP ${response.status})`)
  }
  const result = await response.json()
  if (result?.source !== 'live' || !Array.isArray(result.items)) throw new Error('CCTV 목록 갱신 응답이 올바르지 않습니다.')
  return result
}

// 운영자가 이벤트를 확인했다고 기록하고 갱신된 이벤트를 돌려줍니다.
export async function acknowledgeEvent(eventId) {
  if (!Number.isSafeInteger(eventId) || eventId < 1) throw new Error('올바르지 않은 이벤트 번호입니다.')
  const response = await postPublic(`/api/events/${eventId}/acknowledge`, '이벤트 확인')
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `이벤트 확인에 실패했습니다. (HTTP ${response.status})`)
  }
  const data = await response.json()
  if (!data?.item || typeof data.item !== 'object' || Array.isArray(data.item)) throw new Error('이벤트 확인 응답이 올바르지 않습니다.')
  return normalizeEvent(data.item)
}

export async function acknowledgeAllEvents() {
  const response = await postPublic('/api/events/acknowledge-all', '미확인 이벤트 전체 확인')
  if (!response.ok) throw new Error(`전체 확인에 실패했습니다. (HTTP ${response.status})`)
  const result = await response.json()
  if (!Array.isArray(result.ids) || result.ids.some(id => !Number.isSafeInteger(id) || id < 1)
    || result.count !== result.ids.length) throw new Error('전체 확인 응답이 올바르지 않습니다.')
  return result
}

export async function deleteEvent(eventId) {
  if (!Number.isSafeInteger(eventId) || eventId < 1) throw new Error('올바르지 않은 이벤트 번호입니다.')
  const response = await fetch(`/api/events/${eventId}`, { method: 'DELETE', signal: AbortSignal.timeout(15000) })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw Object.assign(new Error(body.error || `이벤트 삭제에 실패했습니다. (HTTP ${response.status})`), { status: response.status })
  }
}

export async function loginAdmin(username, password) {
  const login = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!login.ok) {
    const body = await login.json().catch(() => ({}))
    throw new Error(body.error || `관리자 로그인에 실패했습니다. (HTTP ${login.status})`)
  }
  const { access_token: token } = await login.json()
  if (typeof token !== 'string' || !token) throw new Error('관리자 로그인 응답이 올바르지 않습니다.')
  return token
}

export async function startTestRun(cameraId) {
  if (!Number.isSafeInteger(cameraId) || cameraId < 1) throw new Error('올바른 카메라 번호가 아닙니다.')
  const response = await fetch(`/api/cameras/${cameraId}/test-runs`, {
    method: 'POST',
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `Test 실행에 실패했습니다. (HTTP ${response.status})`)
  }
  const result = await response.json()
  if (!Number.isSafeInteger(result?.id) || result.id < 1 || result.camera_id !== cameraId
    || !Number.isSafeInteger(result.video_id) || result.video_id < 1
    || result.stream_url !== `/api/test-runs/${result.id}/stream`) throw new Error('Test 실행 응답이 올바르지 않습니다.')
  return result
}

export async function fetchTestRunStatus(runId) {
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Error('올바른 실행 번호가 아닙니다.')
  const response = await fetch(`/api/test-runs/${runId}`)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `Test 상태 조회에 실패했습니다. (HTTP ${response.status})`)
  }
  const result = await response.json()
  if (result?.id !== runId || !['ready', 'running', 'completed', 'failed'].includes(result.status)) {
    throw new Error('Test 상태 응답이 올바르지 않습니다.')
  }
  return result
}

export async function openTestRunStream(url, signal) {
  if (!/^\/api\/test-runs\/[1-9]\d*\/stream$/.test(url)) throw new Error('Test 영상 주소가 올바르지 않습니다.')
  const response = await fetch(url, { signal })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `분석 영상 연결에 실패했습니다. (HTTP ${response.status})`)
  }
  if (!/^multipart\/x-mixed-replace\s*;\s*boundary=frame(?:\s*;|\s*$)/i.test(response.headers.get('Content-Type') || '') || !response.body) {
    throw new Error('MJPEG 영상 응답 형식이 올바르지 않습니다.')
  }
  return response
}

export async function fetchLiveMonitorStatus({ signal } = {}) {
  let response
  try { response = await fetch('/api/live-monitor/status', { signal, headers: { Accept: 'application/json' } }) }
  catch (error) {
    if (signal?.aborted) throw error
    throw new Error('AI 감시 상태 API에 연결할 수 없습니다.')
  }
  if (!response.ok) throw new Error(`AI 감시 상태 조회에 실패했습니다. (HTTP ${response.status})`)
  const data = await response.json()
  if (typeof data?.state !== 'string' || !Array.isArray(data.cameras)) {
    throw new Error('AI 감시 상태 응답 형식이 올바르지 않습니다.')
  }
  return data
}

export async function fetchEvent(id, { signal } = {}) {
  if (!/^[1-9]\d*$/.test(String(id)) || Number(id) > 2147483647) {
    throw new Error('올바른 이벤트 번호가 아닙니다.')
  }
  const response = await fetch(`/api/events/${id}`, { signal, headers: { Accept: 'application/json' } })
  if (response.status === 404) throw new Error('탐지 이벤트가 없습니다.')
  if (!response.ok) throw new Error(`이벤트 조회에 실패했습니다. (HTTP ${response.status})`)
  const data = await response.json()
  if (!data?.item || typeof data.item !== 'object' || Array.isArray(data.item)) throw new Error('이벤트 응답 형식이 올바르지 않습니다.')
  return normalizeEvent(data.item)
}
