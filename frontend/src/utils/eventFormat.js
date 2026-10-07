export function formatConfidence(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '정보 없음'
}
export function formatDetectedAt(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '시각 정보 없음' : date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })
}
export function formatType(value) {
  return { smoke: '연기', fire: '화재' }[value] ?? value
}
