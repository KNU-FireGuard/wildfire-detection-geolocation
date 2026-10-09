// 이전 요청이 끝난 뒤 다음 조회를 예약하여 요청 중첩을 방지합니다.
export function createDemoMonitor({ read, refresh, update, error, schedule = setTimeout, cancel = clearTimeout, interval = 2000 }) {
  let controller, timer, generation = 0
  function stop() { generation++; controller?.abort(); cancel(timer) }
  async function start(id) {
    stop()
    const current = generation
    controller = new AbortController()
    const signal = controller.signal
    async function tick() {
      try {
        const result = await read(id, signal)
        if (current !== generation) return
        update(result)
        await refresh(signal)
        if (current !== generation) return
        if (result.status === 'running') timer = schedule(tick, interval)
      } catch (cause) { if (current === generation) error(cause) }
    }
    await tick()
  }
  return { start, stop }
}
