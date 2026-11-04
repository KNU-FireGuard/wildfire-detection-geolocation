export function filterEvents(events, { type = 'all', status = 'all', cameraId = 'all' } = {}) {
  return events.filter(event => {
    if (type !== 'all' && event.type !== type) return false
    if (status !== 'all' && event.status !== status) return false
    if (cameraId !== 'all' && String(event.cameraId) !== String(cameraId)) return false
    return true
  })
}
