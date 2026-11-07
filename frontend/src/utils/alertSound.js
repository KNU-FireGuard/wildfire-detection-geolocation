// 새 화재·연기 알림음, 브라우저가 소리 재생을 막은 경우(사용자 조작 전)에는 조용히 건너뜁니다.
export function playAlertTone() {
  try {
    const Context = window.AudioContext || window.webkitAudioContext
    if (!Context) return
    const context = new Context()
    if (context.state === 'suspended') { context.close(); return }
    const start = context.currentTime
    for (const offset of [0, 0.28]) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.22)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start + offset)
      oscillator.stop(start + offset + 0.24)
    }
    setTimeout(() => context.close(), 800)
  } catch { /* 소리는 보조 수단이라 실패해도 화면 알림만 사용 */ }
}
