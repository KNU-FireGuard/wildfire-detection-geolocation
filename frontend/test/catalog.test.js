import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { fetchCameras, fetchEvents } from '../src/api/catalog.js'

// feature/backend catalog.controller.js의 응답 규격에 대한 회귀 테스트입니다.
const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
const page = (items, offset = 0) => Response.json({ items, limit: 100, offset })
const rawCamera = { id: 1, name: 'CAM 01', latitude: 36.0157, longitude: 128.6951 }
const rawEvent = {
  id: 10, video_id: 20, camera_id: 1, class: 'smoke',
  started_at: '2026-10-07T05:30:00.000Z', ended_at: null,
  max_confidence: 0.93, estimated_latitude: 36.0089,
  estimated_longitude: 128.7118, error_range_m: 50,
}

test('Camera/Event를 API 필드에서 UI 모델로 분리하고 숫자 ID를 유지한다', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.Accept, 'application/json')
    return page(url.startsWith('/api/cameras') ? [rawCamera] : [rawEvent])
  }
  const [cameras, events] = await Promise.all([fetchCameras(), fetchEvents()])
  assert.equal(cameras[0].id, events[0].cameraId)
  assert.equal(cameras[0].name, 'CAM 01')
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
