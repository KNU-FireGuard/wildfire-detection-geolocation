import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retainSelection } from '../src/utils/dashboardSelection.js'

test('첫 조회에서 CCTV와 이벤트를 자동 선택하지 않는다', () => {
  assert.deepEqual(retainSelection(null, null, [{ id: 1 }], [{ id: 9 }]), { cameraId: null, eventId: null })
})

test('사용자가 선택한 항목만 새 조회 후 유지하고 사라지면 선택을 해제한다', () => {
  assert.deepEqual(retainSelection(1, 9, [{ id: 1 }], [{ id: 9 }]), { cameraId: 1, eventId: 9 })
  assert.deepEqual(retainSelection(1, 9, [], []), { cameraId: null, eventId: null })
})
