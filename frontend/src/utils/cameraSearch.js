export function filterCameras(cameras, query) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return cameras.filter(camera => {
    const text = [camera.id, camera.name, camera.latitude, camera.longitude,
      camera.sourceType, camera.sourceType === 'live' ? '실시간' : camera.sourceType === 'test' ? '테스트' : '']
      .map(value => value ?? '').join(' ').toLocaleLowerCase()
    return words.every(word => text.includes(word))
  })
}
