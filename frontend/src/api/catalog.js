// feature/backend의 GET /api/cameras, GET /api/events 응답을 UI 모델로 변환합니다.
// Backend에서 제공하지 않는 필드는 null로 유지하며 mock 값으로 채우지 않습니다.
function normalizeCamera(camera) {
  return {
    id: camera.id,
    name: camera.name,
    latitude: camera.latitude,
    longitude: camera.longitude,
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
    detectedAt: event.started_at,
    type: event.class,
    confidence: event.max_confidence,
    estimatedLocation: hasLocation ? {
      latitude: event.estimated_latitude,
      longitude: event.estimated_longitude,
      address: null,
      errorRadiusM: event.error_range_m,
    } : null,
    // ended_at은 종료 시각입니다. 확인/미확인 상태로 해석하지 않습니다.
    status: null,
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
