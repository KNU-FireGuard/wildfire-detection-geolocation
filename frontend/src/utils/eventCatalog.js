import { filterEvents } from './eventFilters.js'

const DAY = 24 * 60 * 60 * 1000
const KST = 9 * 60 * 60 * 1000
const PAGE_SIZES = [20, 50, 100]
const QUERY_KEYS = ['q', 'type', 'status', 'camera', 'period', 'from', 'to', 'page', 'pageSize']
export const defaultEventFilters = { search: '', type: 'all', status: 'all', cameraId: 'all', period: 'all', from: '', to: '' }
const text = value => typeof value === 'string' ? value : ''
const choice = (value, allowed, fallback = 'all') => allowed.includes(value) ? value : fallback
const positiveInteger = (value, fallback) => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback

export function readEventCatalogQuery(query = {}) {
  const camera = positiveInteger(text(query.camera), null)
  return {
    filters: {
      search: text(query.q).trim().slice(0, 200),
      type: choice(query.type, ['fire', 'smoke']),
      status: choice(query.status, ['UNCONFIRMED', 'CONFIRMED']),
      cameraId: camera && camera <= 2147483647 ? String(camera) : 'all',
      period: choice(query.period, ['today', 'week', 'custom']),
      from: text(query.from), to: text(query.to),
    },
    page: positiveInteger(text(query.page), 1),
    pageSize: choice(Number(text(query.pageSize)), PAGE_SIZES, 20),
  }
}

export function writeEventCatalogQuery({ filters, page = 1, pageSize = 20 }, previous = {}) {
  const query = { ...previous }
  for (const key of QUERY_KEYS) delete query[key]
  if (filters.search.trim()) query.q = filters.search.trim()
  for (const [key, value] of [['type', filters.type], ['status', filters.status], ['camera', filters.cameraId], ['period', filters.period]]) {
    if (value !== 'all') query[key] = value
  }
  if (filters.period === 'custom') {
    if (filters.from) query.from = filters.from
    if (filters.to) query.to = filters.to
  }
  if (page > 1) query.page = String(page)
  if (pageSize !== 20) query.pageSize = String(pageSize)
  return query
}

export function kstToday(now = Date.now()) {
  return new Date(now + KST).toISOString().slice(0, 10)
}

function dateStart(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
  const timestamp = Date.parse(`${value}T00:00:00+09:00`)
  return Number.isFinite(timestamp) && kstToday(timestamp) === value ? timestamp : NaN
}

export function eventDateRange({ period = 'all', from = '', to = '' } = {}, now = Date.now()) {
  if (period === 'all') return { start: null, end: null, error: '' }
  if (period === 'today' || period === 'week') {
    const today = dateStart(kstToday(now))
    return { start: today - (period === 'week' ? 6 * DAY : 0), end: today + DAY, error: '' }
  }
  if (!from || !to) return { error: '시작일과 종료일을 모두 입력해주세요.' }
  const start = dateStart(from), last = dateStart(to)
  if (!Number.isFinite(start) || !Number.isFinite(last)) return { error: '시작일과 종료일에 올바른 날짜를 입력해주세요.' }
  if (start > last) return { error: '종료일은 시작일과 같거나 이후여야 합니다.' }
  return { start, end: last + DAY, error: '' }
}

export function filterCatalogEvents(events, filters = {}, now = Date.now()) {
  const range = eventDateRange(filters, now)
  if (range.error) return []
  const normalize = value => String(value ?? '').toLowerCase().replace(/\s+/g, '')
  const search = normalize(filters.search)
  const id = search.replace(/^#/, '')
  return filterEvents(events, filters).filter(event => {
    if (search && !normalize(event.cameraName).includes(search) && !(/^\d+$/.test(id) && String(event.id) === String(Number(id)))) return false
    if (range.start !== null) {
      const timestamp = event.detectedAt ? Date.parse(event.detectedAt) : NaN
      if (!Number.isFinite(timestamp) || timestamp < range.start || timestamp >= range.end) return false
    }
    return true
  })
}

export function paginateCatalogEvents(events, requestedPage = 1, requestedSize = 20) {
  const size = choice(Number(requestedSize), PAGE_SIZES, 20)
  const pageCount = Math.max(1, Math.ceil(events.length / size))
  const page = Math.min(positiveInteger(requestedPage, 1), pageCount)
  const offset = (page - 1) * size
  return { items: events.slice(offset, offset + size), page, pageCount, total: events.length, start: events.length ? offset + 1 : 0, end: Math.min(offset + size, events.length) }
}
