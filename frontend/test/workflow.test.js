import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { startDemo, getDemo, login, recipients } from '../src/api/workflow.js'
const original = globalThis.fetch
afterEach(() => { globalThis.fetch = original })
test('데모 시작은 본문 없이 POST하고 서버가 반환한 URL을 사용한다', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/demo-runs')
    assert.equal(options.method, 'POST')
    assert.equal(options.body, undefined)
    return Response.json({ id: 1, status: 'running', videos: Array.from({ length: 4 }, (_, i) => ({ camera_id: i + 1, video_id: i + 1, stream_url: `/api/videos/${i + 1}/stream` })) }, { status: 202 })
  }
  assert.equal((await startDemo()).videos.length, 4)
})
test('409·401 오류를 유지하고 수신자 수정은 Bearer 토큰을 보낸다', async () => {
  globalThis.fetch = async () => Response.json({ error: '이미 실행 중입니다.' }, { status: 409 })
  await assert.rejects(startDemo(), error => error.status === 409)
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer token')
    assert.equal(options.method, 'PATCH')
    return Response.json({ id: 1, is_active: false })
  }
  await recipients.update(1, { is_active: false }, 'token')
})
test('로그인 실패와 HTML 응답을 정상 데이터로 처리하지 않는다', async () => {
  globalThis.fetch = async () => Response.json({ error: '로그인 실패' }, { status: 401 })
  await assert.rejects(login('admin', 'bad'), error => error.status === 401)
  globalThis.fetch = async () => new Response('<html>error</html>')
  await assert.rejects(getDemo(1), /응답/)
})

test('미구현 API의 HTML 404도 HTTP 상태와 안내를 유지한다', async () => {
  globalThis.fetch = async () => new Response('<html>Cannot POST</html>', { status: 404 })
  await assert.rejects(startDemo(), error => error.status === 404 && /404/.test(error.message))
})

test('중복 카메라 영상과 잘못된 카메라 상태를 거부한다', async () => {
  globalThis.fetch = async () => Response.json({ id: 1, status: 'running', videos: Array.from({ length: 4 }, (_, i) => ({ camera_id: 1, video_id: i + 1, stream_url: `/api/videos/${i + 1}/stream` })) })
  await assert.rejects(startDemo(), /영상/)
  globalThis.fetch = async () => Response.json({ id: 1, status: 'running', cameras: [{ camera_id: 1, status: 'unknown', error: null }] })
  await assert.rejects(getDemo(1), /상태/)
})

test('수신자 목록 형식 오류를 빈 목록으로 처리하지 않는다', async () => {
  globalThis.fetch = async () => Response.json({ items: null })
  await assert.rejects(recipients.list('token'), /응답/)
})
