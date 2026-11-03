import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_MEDIA_RECOVERIES, MAX_NETWORK_RETRIES, decideRecovery, describeHlsError } from '../src/utils/hlsRecovery.js'

test('오류 원인을 HTTP 상태·시간 초과·네트워크·재생 오류로 구분해 설명한다', () => {
  assert.equal(describeHlsError({ type: 'networkError', details: 'manifestLoadError', response: { code: 403 } }), 'HTTP 403')
  assert.equal(describeHlsError({ type: 'networkError', details: 'levelLoadTimeOut' }), '응답 시간 초과')
  assert.equal(describeHlsError({ type: 'networkError', details: 'fragLoadError' }), '네트워크 오류')
  assert.equal(describeHlsError({ type: 'mediaError', details: 'bufferAppendError' }), '재생 오류')
  assert.equal(describeHlsError({ type: 'otherError', details: 'internalException' }), 'internalException')
  assert.equal(describeHlsError(undefined), '알 수 없는 오류')
})

test('네트워크 오류는 간격을 늘려 최대 횟수까지만 다시 연결한다', () => {
  assert.deepEqual(decideRecovery({ type: 'networkError' }, { network: 0, media: 0 }), { action: 'retry', delayMs: 10000 })
  assert.deepEqual(decideRecovery({ type: 'networkError' }, { network: 1, media: 0 }), { action: 'retry', delayMs: 20000 })
  assert.deepEqual(decideRecovery({ type: 'networkError' }, { network: MAX_NETWORK_RETRIES - 1, media: 0 }), { action: 'retry', delayMs: 10000 * MAX_NETWORK_RETRIES })
  assert.deepEqual(decideRecovery({ type: 'networkError' }, { network: MAX_NETWORK_RETRIES, media: 0 }), { action: 'fail' })
})

test('재생 오류는 제한된 횟수만 복구하고 그 밖의 오류는 바로 실패로 처리한다', () => {
  assert.deepEqual(decideRecovery({ type: 'mediaError' }, { network: 0, media: 0 }), { action: 'recover', delayMs: 0 })
  assert.deepEqual(decideRecovery({ type: 'mediaError' }, { network: 0, media: MAX_MEDIA_RECOVERIES }), { action: 'fail' })
  assert.deepEqual(decideRecovery({ type: 'otherError' }, { network: 0, media: 0 }), { action: 'fail' })
})
