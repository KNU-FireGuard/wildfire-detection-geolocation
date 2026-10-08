<script setup>
// 임시 지도용 코드 기반 지형 일러스트입니다. 실제 위성 영상이나 지도 데이터가 아닙니다.
const contours = Array.from({ length: 46 }, (_, index) => {
  const points = Array.from({ length: 51 }, (_, step) => {
    const x = step * 22 - 50
    const y = index * 19 - 100 + 42 * Math.sin(x / 115 + index * .11) + 21 * Math.cos(x / 59 + index * .17)
    return `${step === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  })
  return points.join(' ')
})
</script>

<template>
  <svg class="terrain-backdrop" viewBox="0 0 1000 650" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <radialGradient id="terrain-shade"><stop stop-color="#416553" /><stop offset="1" stop-color="#163c35" /></radialGradient>
      <filter id="terrain-grain"><feTurbulence type="fractalNoise" baseFrequency=".023" numOctaves="4" seed="11" /><feColorMatrix type="saturate" values="0" /></filter>
      <linearGradient id="terrain-ridge"><stop stop-color="#67856a" stop-opacity=".6" /><stop offset="1" stop-color="#102f2b" stop-opacity=".1" /></linearGradient>
    </defs>
    <rect width="1000" height="650" fill="url(#terrain-shade)" />
    <path d="M-50 460 Q180 90 430 40 Q580 160 480 390 Q440 630 820 670Z" fill="url(#terrain-ridge)" />
    <path d="M370-50 Q530 220 740 180 Q940 110 1090 300L1080 610Q920 450 750 540Q470 580 370-50" fill="#213e32" opacity=".58" />
    <rect width="1000" height="650" filter="url(#terrain-grain)" opacity=".23" style="mix-blend-mode: soft-light" />
    <g fill="none" stroke="#91a47b" stroke-width="1" opacity=".21"><path v-for="(path, index) in contours" :key="index" :d="path" /></g>
    <g fill="none" stroke-linecap="round">
      <path d="M-30 520Q110 495 160 403T330 355Q418 345 451 280T650 280Q790 355 870 185T1040 90" stroke="#152e2d" stroke-width="15" />
      <path d="M-30 520Q110 495 160 403T330 355Q418 345 451 280T650 280Q790 355 870 185T1040 90" stroke="#8b9671" stroke-width="3" opacity=".64" />
      <path d="M330 355Q280 210 440 159T500-30M650 280Q690 430 590 490T570 690M160 403Q250 545 340 610T400 700" stroke="#8b9671" stroke-width="1.5" opacity=".55" />
      <path d="M940 700Q860 550 900 430T835 260Q725 160 785-30" stroke="#35685f" stroke-width="6" opacity=".65" />
      <path d="M940 700Q860 550 900 430T835 260Q725 160 785-30" stroke="#769a87" stroke-width="1" opacity=".4" />
    </g>
    <g fill="#d0dccb" opacity=".55" font-family="sans-serif" text-anchor="middle"><text x="510" y="100" font-size="16" letter-spacing="5">팔공산</text><text x="370" y="380" font-size="10" letter-spacing="2">비로봉 능선</text><text x="790" y="550" font-size="10" letter-spacing="2">동쪽 관제 구역</text></g>
  </svg>
</template>

<style scoped>
.terrain-backdrop { position: absolute; inset: 0; height: 100%; width: 100%; pointer-events: none; }
</style>
