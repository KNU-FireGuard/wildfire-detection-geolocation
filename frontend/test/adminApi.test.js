import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { fetchAdminCameras, fetchSmsLogs, normalizeAlertPhone, updateAlertPhone } from '../src/api/admin.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('알림 번호 입력은 공백과 하이픈을 제거하고 빈 값은 null로 바꾼다', () => {
  assert.equal(normalizeAlertPhone('010-1234-5678'), '01012345678')
  assert.equal(normalizeAlertPhone(' 010 1234 5678 '), '01012345678')
  assert.equal(normalizeAlertPhone('01012345678'), '01012345678')
  assert.equal(normalizeAlertPhone(''), null)
  assert.equal(normalizeAlertPhone('   '), null)
  assert.equal(normalizeAlertPhone(null), null)
})

test('010 휴대전화 11자리가 아닌 번호는 거부한다', () => {
  for (const value of ['0212345678', '0101234567', '010123456789', 'abc', '+821012345678']) {
    assert.throws(() => normalizeAlertPhone(value), /010/, value)
  }
})

test('관리자 카메라 목록은 Bearer 토큰으로 모든 페이지를 조회한다', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization })
    const offset = calls.length === 1 ? 0 : 100
    const items = calls.length === 1
      ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `cam${index + 1}`, source_type: 'test', alert_phone: null }))
      : [{ id: 101, name: 'last', source_type: 'live', alert_phone: '01012345678' }]
    return Response.json({ items, limit: 100, offset })
  }
  const cameras = await fetchAdminCameras('tok')
  assert.equal(cameras.length, 101)
  assert.deepEqual(calls.map(call => call.url), ['/api/admin/cameras?limit=100&offset=0', '/api/admin/cameras?limit=100&offset=100'])
  assert.ok(calls.every(call => call.auth === 'Bearer tok'))
  assert.deepEqual(cameras[100], { id: 101, name: 'last', sourceType: 'live', alertPhone: '01012345678' })
})

test('번호 저장은 PATCH로 보내고 응답을 화면 모델로 변환한다', async () => {
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return Response.json({ id: 3, name: 'cam', alert_phone: '01012345678' })
  }
  const saved = await updateAlertPhone(3, '010-1234-5678', 'tok')
  assert.equal(request.url, '/api/admin/cameras/3/alert-phone')
  assert.equal(request.options.method, 'PATCH')
  assert.equal(request.options.headers.Authorization, 'Bearer tok')
  assert.deepEqual(JSON.parse(request.options.body), { alert_phone: '01012345678' })
  assert.deepEqual(saved, { id: 3, name: 'cam', alertPhone: '01012345678' })

  await updateAlertPhone(3, '', 'tok')
  assert.deepEqual(JSON.parse(request.options.body), { alert_phone: null })
})

test('잘못된 번호나 ID는 요청 전에 거부한다', async () => {
  globalThis.fetch = () => assert.fail('요청하면 안 됩니다')
  await assert.rejects(updateAlertPhone(3, 'abc', 'tok'), /010/)
  await assert.rejects(updateAlertPhone(0, '01012345678', 'tok'), /카메라 번호/)
})

test('Backend 오류 메시지를 그대로 전달하고 401은 세션 만료로 표시한다', async () => {
  globalThis.fetch = async () => Response.json({ error: '카메라가 없습니다.' }, { status: 404 })
  await assert.rejects(updateAlertPhone(3, '01012345678', 'tok'), /카메라가 없습니다/)
  globalThis.fetch = async () => Response.json({ error: '로그인이 필요하거나 토큰이 유효하지 않습니다.' }, { status: 401 })
  await assert.rejects(fetchSmsLogs('tok'), error => error.code === 'unauthorized')
})

test('발송 내역은 최신 100건을 변환해 반환하고 API 실패를 mock으로 대체하지 않는다', async () => {
  globalThis.fetch = async url => {
    assert.equal(url, '/api/admin/sms-logs?limit=100&offset=0')
    return Response.json({ items: [{
      id: 4, camera_id: 1, camera_name: 'demo', event_id: 9, phone_number: '01012345678',
      message: '화재', status: 'sent', provider: 'solapi', error: null, created_at: '2026-11-03T01:00:00.000Z',
    }], limit: 100, offset: 0 })
  }
  const logs = await fetchSmsLogs('tok')
  assert.deepEqual(logs, [{
    id: 4, cameraId: 1, cameraName: 'demo', eventId: 9, phoneNumber: '01012345678',
    message: '화재', status: 'sent', provider: 'solapi', error: null, createdAt: '2026-11-03T01:00:00.000Z',
  }])
  globalThis.fetch = async () => new Response('', { status: 500 })
  await assert.rejects(fetchSmsLogs('tok'), /HTTP 500/)
  globalThis.fetch = async () => { throw new TypeError('network') }
  await assert.rejects(fetchSmsLogs('tok'), /연결할 수 없습니다/)
})
