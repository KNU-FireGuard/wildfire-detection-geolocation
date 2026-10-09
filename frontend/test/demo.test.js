import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDemoMonitor } from '../src/demoMonitor.js'

test('상태 갱신은 순차 실행하고 완료 후 최종 이벤트를 조회한다', async () => {
  let scheduled, calls = 0, refreshed = 0
  const updates = []
  const monitor = createDemoMonitor({
    read: async () => ({ id: 7, status: ++calls === 1 ? 'running' : 'completed' }),
    refresh: async () => { refreshed++ },
    update: value => updates.push(value.status),
    error: cause => { throw cause },
    schedule: callback => { scheduled = callback; return 1 }, cancel: () => {},
  })
  await monitor.start(7)
  assert.deepEqual(updates, ['running'])
  await scheduled()
  assert.deepEqual(updates, ['running', 'completed'])
  assert.equal(refreshed, 2)
  assert.equal(calls, 2)
  monitor.stop()
})

test('화면을 떠난 뒤 늦게 도착한 응답은 반영하지 않는다', async () => {
  let resolve, updates = 0, refreshed = 0
  const monitor = createDemoMonitor({
    read: () => new Promise(done => { resolve = done }),
    update: () => { updates++ }, refresh: async () => { refreshed++ }, error: () => {},
  })
  const pending = monitor.start(1)
  monitor.stop()
  resolve({ id: 1, status: 'running' })
  await pending
  assert.equal(updates, 0)
  assert.equal(refreshed, 0)
})

test('상태 조회 실패는 성공으로 대체하지 않고 재시작할 수 있다', async () => {
  let fail = true, failures = 0, updates = 0
  const monitor = createDemoMonitor({
    read: async () => { if (fail) throw new Error('404'); return { id: 1, status: 'failed' } },
    update: () => { updates++ }, refresh: async () => {}, error: () => { failures++ },
  })
  await monitor.start(1)
  assert.equal(failures, 1)
  assert.equal(updates, 0)
  fail = false
  await monitor.start(1)
  assert.equal(updates, 1)
  monitor.stop()
})
