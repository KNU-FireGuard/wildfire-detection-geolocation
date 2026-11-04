import assert from 'node:assert/strict'
import test from 'node:test'
import { filterEvents } from '../src/utils/eventFilters.js'

const events = [
  { id: 1, cameraId: 7, type: 'fire', status: 'UNCONFIRMED' },
  { id: 2, cameraId: 8, type: 'smoke', status: 'CONFIRMED' },
  { id: 3, cameraId: 7, type: 'smoke', status: 'UNCONFIRMED' },
]

test('returns all events when no filter is selected', () => {
  assert.deepEqual(filterEvents(events), events)
})

test('filters by event type and confirmation status', () => {
  assert.deepEqual(
    filterEvents(events, { type: 'fire', status: 'UNCONFIRMED' }).map(event => event.id),
    [1],
  )
})

test('filters camera IDs as strings or numbers and combines filters', () => {
  assert.deepEqual(
    filterEvents(events, { cameraId: '7', type: 'smoke' }).map(event => event.id),
    [3],
  )
})

test('does not mutate the source event list', () => {
  const input = [...events]
  filterEvents(input, { status: 'CONFIRMED' })
  assert.deepEqual(input, events)
})
