import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { fetchCameras, fetchEvents, fetchVideos, fetchEvent, fetchLiveCctvs, fetchLiveMonitorStatus, refreshLiveCctvs, loginAdmin, startTestRun, fetchTestRunStatus, openTestRunStream } from '../src/api/catalog.js'

// feature/backend catalog.controller.js의 응답 규격에 대한 회귀 테스트입니다.
const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
const page = (items, offset = 0) => Response.json({ items, limit: 100, offset })
const rawCamera = { id: 1, name: 'CAM 01', source_type: 'test', latitude: 36.0157, longitude: 128.6951 }
const rawEvent = {
  id: 10, video_id: 20, camera_id: 1, class: 'smoke',
  started_at: '2026-10-07T05:30:00.000Z', ended_at: null,
  max_confidence: 0.93, estimated_latitude: 36.0089,
  estimated_longitude: 128.7118, error_range_m: 50,
}

test('영상 목록은 videos API 메타데이터를 그대로 조회한다', async () => {
  const video = { id: 20, camera_id: 1, original_filename: 'sample.mp4', created_at: rawEvent.started_at }
  globalThis.fetch = async url => {
    assert.equal(url, '/api/videos?limit=100&offset=0')
    return page([video])
  }
  assert.deepEqual(await fetchVideos(), [video])
})

test('이벤트 상세는 item 응답을 변환하며 404와 잘못된 ID를 처리한다', async () => {
  globalThis.fetch = async url => {
    assert.equal(url, '/api/events/10')
    return Response.json({ item: rawEvent })
  }
  const event = await fetchEvent('10')
  assert.equal(event.id, 10)
  assert.equal(event.videoId, 20)
  assert.equal(event.endedAt, null)
  await assert.rejects(fetchEvent('abc'), /올바른 이벤트/)
  await assert.rejects(fetchEvent('2147483648'), /올바른 이벤트/)
  globalThis.fetch = async () => new Response('', { status: 404 })
  await assert.rejects(fetchEvent('10'), /탐지 이벤트가 없습니다/)
})

test('이벤트 상세는 잘못된 응답과 서버 오류를 거부하고 취소 신호를 전달한다', async () => {
  const controller = new AbortController()
  globalThis.fetch = async (url, options) => {
    assert.equal(options.signal, controller.signal)
    return Response.json({ items: [] })
  }
  await assert.rejects(fetchEvent('10', { signal: controller.signal }), /응답 형식/)
  globalThis.fetch = async () => new Response('', { status: 500 })
  await assert.rejects(fetchEvent('10'), /HTTP 500/)
})

test('Camera/Event를 API 필드에서 UI 모델로 분리하고 숫자 ID를 유지한다', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.Accept, 'application/json')
    return page(url.startsWith('/api/cameras') ? [rawCamera] : [rawEvent])
  }
  const [cameras, events] = await Promise.all([fetchCameras(), fetchEvents()])
  assert.equal(cameras[0].id, events[0].cameraId)
  assert.equal(cameras[0].name, 'CAM 01')
  assert.equal(cameras[0].sourceType, 'test')
  for (const key of ['locationName', 'status', 'ptzModel', 'altitudeM', 'panDeg', 'tiltDeg', 'zoom', 'hfovDeg', 'vfovDeg']) {
    assert.equal(cameras[0][key], null)
  }
  assert.equal(events[0].detectedAt, rawEvent.started_at)
  assert.equal(events[0].type, 'smoke')
  assert.equal(events[0].confidence, 0.93)
  assert.equal(events[0].status, null)
  assert.deepEqual(events[0].estimatedLocation, { latitude: 36.0089, longitude: 128.7118, address: null, errorRadiusM: 50 })
  assert.ok(!('cameraName' in events[0]) && !('cameraLatitude' in events[0]))
})

test('null 카메라, null 좌표, null 오차 반경을 0이나 임시 정보로 바꾸지 않는다', async () => {
  globalThis.fetch = async url => page(url.startsWith('/api/cameras')
    ? [{ ...rawCamera, latitude: null, longitude: null }]
    : [
      { ...rawEvent, camera_id: null, estimated_latitude: null, estimated_longitude: null },
      { ...rawEvent, id: 11, estimated_latitude: 0, estimated_longitude: 0, error_range_m: null },
    ])
  const [cameras, events] = await Promise.all([fetchCameras(), fetchEvents()])
  assert.equal(cameras[0].latitude, null)
  assert.equal(cameras[0].longitude, null)
  assert.equal(events[0].cameraId, null)
  assert.equal(events[0].estimatedLocation, null)
  assert.equal(events[1].estimatedLocation.latitude, 0)
  assert.equal(events[1].estimatedLocation.errorRadiusM, null)
})

test('100개를 넘는 데이터는 다음 페이지까지 조회하고 서버 순서를 유지한다', async () => {
  const calls = []
  globalThis.fetch = async url => {
    calls.push(url)
    const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'))
    return page(Array.from({ length: offset === 0 ? 100 : 1 }, (_, index) => ({ ...rawEvent, id: 101 - offset - index })), offset)
  }
  const events = await fetchEvents()
  assert.deepEqual(calls, ['/api/events?limit=100&offset=0', '/api/events?limit=100&offset=100'])
  assert.equal(events.length, 101)
  assert.equal(events[0].id, 101)
  assert.equal(events.at(-1).id, 1)
})

test('정확히 한 페이지가 차면 빈 다음 페이지를 조회하고 종료한다', async () => {
  let calls = 0
  globalThis.fetch = async () => page(++calls === 1 ? Array.from({ length: 100 }, () => rawCamera) : [], calls === 1 ? 0 : 100)
  assert.equal((await fetchCameras()).length, 100)
  assert.equal(calls, 2)
})

test('빈 목록은 성공한 빈 배열로 처리한다', async () => {
  globalThis.fetch = async () => page([])
  assert.deepEqual(await fetchCameras(), [])
  assert.deepEqual(await fetchEvents(), [])
})

test('HTTP 오류와 네트워크 실패를 구분하고 mock으로 대체하지 않는다', async () => {
  globalThis.fetch = async () => Response.json({ error: '서버 내부 오류가 발생했습니다.' }, { status: 500 })
  await assert.rejects(fetchEvents(), /HTTP 500/)
  globalThis.fetch = async () => { throw new TypeError('fetch failed') }
  await assert.rejects(fetchCameras(), /Backend 서버 실행 상태/)
})

test('HTML 응답, 잘못된 envelope, 잘못된 페이지 offset을 거부한다', async () => {
  globalThis.fetch = async () => new Response('<html>Vite fallback</html>')
  await assert.rejects(fetchEvents(), /JSON 형식/)
  for (const payload of [{ data: [] }, { items: [], limit: 50, offset: 0 }, { items: [], limit: 100, offset: 100 }, null]) {
    globalThis.fetch = async () => Response.json(payload)
    await assert.rejects(fetchEvents(), /응답 형식/)
  }
})

test('요청 취소 신호를 fetch에 전달한다', async () => {
  const controller = new AbortController()
  controller.abort()
  globalThis.fetch = async (url, options) => {
    assert.equal(options.signal, controller.signal)
    options.signal.throwIfAborted()
  }
  await assert.rejects(fetchEvents({ signal: controller.signal }), { name: 'AbortError' })
})

test('ITS 카메라는 DB 카메라 ID와 실제 영상 주소를 유지한다', async () => {
  globalThis.fetch = async url => {
    assert.equal(url, '/api/live-cctvs')
    return Response.json({ source: 'live', refreshedAt: '2026-10-29T00:00:00Z', items: [
      { providerKey: 'key-1', cameraId: 9, name: '서울 CCTV', latitude: 37.5, longitude: 127, streamUrl: 'http://video.example.test/live.m3u8' },
    ] })
  }
  const result = await fetchLiveCctvs()
  assert.equal(result.source, 'live')
  assert.equal(result.cameras[0].id, 9)
  assert.equal(result.cameras[0].streamUrl, 'http://video.example.test/live.m3u8')
})

test('관리자 인증으로만 CCTV 목록을 수동 갱신하고 서버 오류를 전달한다', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (url === '/api/auth/login') return Response.json({ access_token: 'short-lived-token' })
    return Response.json({ source: 'live', refreshedAt: '2026-10-29T08:00:00Z', items: [] })
  }
  const result = await refreshLiveCctvs('admin', 'password')
  assert.equal(result.refreshedAt, '2026-10-29T08:00:00Z')
  assert.equal(calls.length, 2)
  assert.deepEqual(JSON.parse(calls[0].options.body), { username: 'admin', password: 'password' })
  assert.equal(calls[1].url, '/api/live-cctvs/refresh')
  assert.equal(calls[1].options.headers.Authorization, 'Bearer short-lived-token')
  globalThis.fetch = async () => Response.json({ error: '다시 시도하세요.' }, { status: 409 })
  await assert.rejects(refreshLiveCctvs('admin', 'bad'), /다시 시도하세요/)
})

test('Test 실행과 상태 조회는 관리자 토큰과 카메라·실행 ID를 사용한다', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (url === '/api/auth/login') return Response.json({ access_token: 'test-token' })
    if (url === '/api/cameras/3/test-runs') return Response.json({ id: 77, camera_id: 3, video_id: 12, status: 'ready', stream_url: '/api/test-runs/77/stream' }, { status: 202 })
    return Response.json({ id: 77, camera_id: 3, status: 'running', error: null })
  }
  const token = await loginAdmin('admin', 'password')
  const run = await startTestRun(3, token)
  const status = await fetchTestRunStatus(run.id, token)
  assert.equal(run.stream_url, '/api/test-runs/77/stream')
  assert.equal(status.status, 'running')
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-token')
  assert.equal(calls[2].url, '/api/test-runs/77')
  assert.equal(calls[2].options.headers.Authorization, 'Bearer test-token')
})

test('MJPEG 영상 요청은 관리자 토큰을 전송하고 응답 형식을 검증한다', async () => {
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-token')
    return new Response('frame', { headers: { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' } })
  }
  const response = await openTestRunStream('/api/test-runs/77/stream', 'test-token')
  assert.equal(response.status, 200)
  globalThis.fetch = async () => new Response('bad', { headers: { 'Content-Type': 'application/json' } })
  await assert.rejects(openTestRunStream('/api/test-runs/77/stream', 'test-token'), /MJPEG/)
})

test('AI 감시 상태는 카메라 ID와 마지막 프레임 시각을 유지한다', async () => {
  globalThis.fetch = async url => {
    assert.equal(url, '/api/live-monitor/status')
    return Response.json({ state: 'running', cameras: [
      { camera_id: 9, state: 'running', last_frame_at: '2026-10-29T02:00:00Z' },
    ] })
  }
  const status = await fetchLiveMonitorStatus()
  assert.equal(status.state, 'running')
  assert.equal(status.cameras[0].camera_id, 9)
  assert.equal(status.cameras[0].last_frame_at, '2026-10-29T02:00:00Z')
})
