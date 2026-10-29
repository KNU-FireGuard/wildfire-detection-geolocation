export function retainSelection(cameraId, eventId, cameras, events) {
  return {
    cameraId: cameras.some(camera => camera.id === cameraId) ? cameraId : null,
    eventId: events.some(event => event.id === eventId) ? eventId : null,
  }
}
