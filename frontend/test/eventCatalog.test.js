import assert from 'node:assert/strict'
import test from 'node:test'
import { readEventCatalogQuery, writeEventCatalogQuery, eventDateRange, filterCatalogEvents, paginateCatalogEvents } from '../src/utils/eventCatalog.js'

const now = Date.parse('2026-11-18T03:00:00Z')
const event = (id, detectedAt, extra = {}) => ({ id, detectedAt, cameraId: 7, cameraName: '청성 CCTV', type: 'fire', status: 'UNCONFIRMED', ...extra })

test('유형·상태·CCTV·이름 검색을 조합하고 원본 순서를 유지한다', () => {
  const events = [event(1, '', { type: 'smoke' }), event(2, '', { status: 'CONFIRMED' }), event(3, ''), event(4, '', { cameraId: 8 })]
  const before = structuredClone(events)
  assert.deepEqual(filterCatalogEvents(events, { type: 'fire', status: 'UNCONFIRMED', cameraId: '7', search: '청성 cctv' }).map(item => item.id), [3])
  assert.deepEqual(events, before)
})

test('이벤트 번호는 # 접두사를 허용하고 번호 전체를 일치시킨다', () => {
  const events = [event(2, ''), event(20, '')]
  assert.deepEqual(filterCatalogEvents(events, { search: '#2' }).map(item => item.id), [2])
  assert.deepEqual(filterCatalogEvents(events, { search: '2' }).map(item => item.id), [2])
})

test('오늘은 브라우저 시간대와 무관하게 KST 자정부터 다음 자정 전까지다', () => {
  const events = [event(1, '2026-11-17T14:59:59.999Z'), event(2, '2026-11-17T15:00:00Z'), event(3, '2026-11-18T14:59:59.999Z'), event(4, '2026-11-18T15:00:00Z'), event(5, null)]
  assert.deepEqual(filterCatalogEvents(events, { period: 'today' }, now).map(item => item.id), [2, 3])
})

test('최근 7일은 오늘을 포함한 KST 달력 7일이다', () => {
  const events = [event(1, '2026-11-11T14:59:59Z'), event(2, '2026-11-11T15:00:00Z'), event(3, '2026-11-18T14:59:59Z'), event(4, '2026-11-18T15:00:00Z')]
  assert.deepEqual(filterCatalogEvents(events, { period: 'week' }, now).map(item => item.id), [2, 3])
})

test('직접 기간은 종료일 전체를 포함하며 역전·누락·존재하지 않는 날짜는 오류다', () => {
  const filters = { period: 'custom', from: '2026-11-16', to: '2026-11-17' }
  const events = [event(1, '2026-11-15T15:00:00Z'), event(2, '2026-11-17T14:59:59Z'), event(3, '2026-11-17T15:00:00Z')]
  assert.deepEqual(filterCatalogEvents(events, filters).map(item => item.id), [1, 2])
  for (const range of [{ from: '', to: '2026-11-17' }, { from: '2026-11-18', to: '2026-11-17' }, { from: '2026-02-30', to: '2026-03-01' }]) {
    assert.ok(eventDateRange({ period: 'custom', ...range }).error)
    assert.deepEqual(filterCatalogEvents(events, { period: 'custom', ...range }), [])
  }
})

test('URL의 중복 값·알 수 없는 조건·잘못된 페이지를 안전한 기본값으로 읽는다', () => {
  const state = readEventCatalogQuery({ q: ['fire', 'smoke'], type: 'invalid', status: 'invalid', camera: '-1', period: 'invalid', page: 'Infinity', pageSize: '999' })
  assert.equal(state.filters.search, '')
  assert.equal(state.filters.type, 'all')
  assert.equal(state.filters.status, 'all')
  assert.equal(state.filters.cameraId, 'all')
  assert.equal(state.filters.period, 'all')
  assert.equal(state.page, 1)
  assert.equal(state.pageSize, 20)
})

test('필터·페이지를 URL로 왕복하고 기본값과 숨겨진 날짜 조건은 제거한다', () => {
  const state = readEventCatalogQuery({ q: '청성', type: 'fire', status: 'CONFIRMED', camera: '7', period: 'custom', from: '2026-11-16', to: '2026-11-18', page: '2', pageSize: '50' })
  const query = writeEventCatalogQuery(state, { other: 'keep', q: 'old' })
  assert.equal(query.other, 'keep')
  assert.deepEqual(readEventCatalogQuery(query), state)
  assert.deepEqual(writeEventCatalogQuery(readEventCatalogQuery({}), query), { other: 'keep' })
  assert.equal(writeEventCatalogQuery(readEventCatalogQuery({ period: 'today', from: '2026-11-01' })).from, undefined)
})

test('페이지는 필터된 결과를 기준으로 자르고 마지막 페이지를 벗어나지 않는다', () => {
  const events = Array.from({ length: 45 }, (_, index) => event(index + 1, ''))
  const page = paginateCatalogEvents(events, 99, 20)
  assert.equal(page.page, 3)
  assert.equal(page.pageCount, 3)
  assert.equal(page.total, 45)
  assert.equal(page.start, 41)
  assert.equal(page.end, 45)
  assert.deepEqual(page.items.map(item => item.id), [41, 42, 43, 44, 45])
  assert.deepEqual(paginateCatalogEvents([], 3, 20), { items: [], page: 1, pageCount: 1, total: 0, start: 0, end: 0 })
})
