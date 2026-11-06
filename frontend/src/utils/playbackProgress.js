export function trackPlaybackProgress(lastTime, currentTime) {
  if (currentTime < lastTime) return { lastTime: currentTime, progressed: false }
  if (currentTime > lastTime) return { lastTime: currentTime, progressed: true }
  return { lastTime, progressed: false }
}
