import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as alerts from '../src/utils/fireAlert.js'

const now = Date.parse('2026-11-07T06:00:00Z')
const smoke = (id, overrides = {}) => ({ id, cameraId: 10, type: 'smoke', status: 'UNCONFIRMED',
  alerting: false, detectedAt: new Date(now - 60000).toISOString(), updatedAt: new Date(now).toISOString(), ...overrides })
const fire = (id, overrides = {}) => ({ ...smoke(id), type: 'fire', alerting: true, ...overrides })

test('브라우저 시각이 달라도 서버가 알림 중인 연기는 표시하고 만료된 연기는 제외한다', () => {
  const events = [smoke(1, { popupAlerting: true }), smoke(2, { popupAlerting: false, cameraId: 11 })]
  const wrongClock = now + 3 * 60 * 60 * 1000
  assert.deepEqual(alerts.findNewDetectionEvents(new Set(), events, wrongClock).map(event => event.id), [1])
  assert.deepEqual(alerts.reconcileDetectionAlerts(events, events, [], wrongClock).map(event => event.id), [1])
})

test('연기는 화재 전용 alerting 값이 false여도 새 탐지 팝업에 포함하고 첫 조회는 생략한다', () => {
  const events = [smoke(1), fire(2)]
  assert.deepEqual(alerts.findNewDetectionEvents(null, events, now), [])
  assert.deepEqual(alerts.findNewDetectionEvents(new Set(), events, now).map(event => event.id), [1, 2])
  assert.deepEqual(alerts.findNewDetectionEvents(new Set([1, 2]), events, now), [])
})

test('같은 카메라의 같은 유형만 중복을 막고 연기 뒤 화재·화재 뒤 연기는 각각 알린다', () => {
  assert.deepEqual(alerts.findNewDetectionEvents(new Set([1]), [fire(1), smoke(2)], now).map(event => event.id), [2])
  assert.deepEqual(alerts.findNewDetectionEvents(new Set([1]), [smoke(1), fire(2)], now).map(event => event.id), [2])
  assert.deepEqual(alerts.findNewDetectionEvents(new Set([1]), [smoke(1), smoke(2), smoke(3, { cameraId: 11 })], now).map(event => event.id), [3])
})

test('연기는 확인 여부와 마지막 탐지 30분 경계로 대기를 정리하고 종료 시각을 우선한다', () => {
  const events = [smoke(1), smoke(2, { status: 'CONFIRMED' }), smoke(3, { acknowledgedAt: new Date(now).toISOString() }),
    smoke(4, { updatedAt: new Date(now - 30 * 60000).toISOString() }),
    smoke(5, { updatedAt: new Date(now - 30 * 60000 + 1).toISOString() }),
    smoke(6, { endedAt: new Date(now - 31 * 60000).toISOString() }),
    smoke(7, { updatedAt: 'invalid' }), smoke(8, { type: 'other' })]
  assert.deepEqual(alerts.reconcileDetectionAlerts(events, events, [], now).map(event => event.id), [1, 5])
  assert.deepEqual(alerts.reconcileDetectionAlerts(events, [], [], now), [])
})

test('연기 대기는 최신 신뢰도를 반영하고 같은 ID를 중복 표시하지 않는다', () => {
  const old = smoke(1, { confidence: .6 })
  const updated = { ...old, confidence: .9 }
  const next = alerts.reconcileDetectionAlerts([old], [updated], [updated], now)
  assert.equal(next.length, 1)
  assert.equal(next[0].confidence, .9)
  assert.deepEqual(alerts.activeFireCameraIds([smoke(1)]), new Set())
})
