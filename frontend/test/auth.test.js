import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { signIn, logout, accessToken, admin } from '../src/auth.js'
const original = globalThis.fetch
afterEach(() => { logout(); globalThis.fetch = original })
test('잘못된 로그인 응답은 토큰과 관리자를 저장하지 않는다', async () => {
  globalThis.fetch = async url => Response.json(url.endsWith('/login') ? { access_token: '', expires_in: -1 } : { id: 1, username: 'admin' })
  await assert.rejects(signIn('admin', 'password'), /응답/)
  assert.equal(accessToken.value, '')
  assert.equal(admin.value, null)
})
test('관리자 확인까지 성공해야 로그인되며 로그아웃은 토큰을 지운다', async () => {
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/login')) return Response.json({ access_token: 'example', token_type: 'Bearer', expires_in: 3600 })
    assert.equal(options.headers.Authorization, 'Bearer example')
    return Response.json({ id: 1, username: 'admin' })
  }
  await signIn('admin', 'password')
  assert.equal(accessToken.value, 'example')
  assert.equal(admin.value.username, 'admin')
  logout()
  assert.equal(accessToken.value, '')
})
