import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { ensureAdminToken, useAdminSession } from '../src/composables/useAdminSession.js'

const session = useAdminSession()
beforeEach(() => session.signOut())

test('로그인하지 않았다면 로그인하고 토큰을 보관해 이후에는 다시 묻지 않는다', async () => {
  const calls = []
  const login = async (username, password) => { calls.push([username, password]); return 'issued-token' }
  assert.equal(await ensureAdminToken(login, 'admin', 'pw'), 'issued-token')
  assert.equal(session.isLoggedIn.value, true)
  assert.equal(await ensureAdminToken(login, '', ''), 'issued-token')
  assert.deepEqual(calls, [['admin', 'pw']])
})

test('로그인에 실패하면 토큰을 보관하지 않고 오류를 전달한다', async () => {
  const login = async () => { throw new Error('ID 또는 비밀번호가 올바르지 않습니다.') }
  await assert.rejects(ensureAdminToken(login, 'admin', 'bad'), /올바르지 않습니다/)
  assert.equal(session.isLoggedIn.value, false)
})
