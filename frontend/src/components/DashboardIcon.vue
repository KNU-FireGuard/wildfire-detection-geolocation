<script setup>
defineProps({ name: { type: String, default: 'camera' }, size: { type: [Number, String], default: 24 } })
const paths = {
  home: ['m3 10 9-7 9 7', 'M5 9v12h5v-7h4v7h5V9'],
  camera: ['M3 6h12v12H3z', 'm15 10 6-4v12l-6-4'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
  monitor: ['M3 4h18v13H3z', 'M8 21h8', 'M12 17v4'],
  chart: ['M5 20v-7', 'M12 20V4', 'M19 20V9'],
  settings: ['m9 3-1 3-3 1-2 3 2 2-1 3 3 2 2-1 3 2 3-2 2 1 3-2-1-3 2-2-2-3-3-1-1-3Z', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 7v5l4 2'],
  user: ['M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M4 21v-2a8 8 0 0 1 16 0v2'],
  arrow: ['M4 12h16', 'm14 6 6 6-6 6'],
  chevron: ['m9 5 7 7-7 7'],
  target: ['M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14', 'M12 1v6', 'M12 17v6', 'M1 12h6', 'M17 12h6'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  layers: ['m12 3 10 6-10 6L2 9Z', 'm2 14 10 6 10-6'],
  fire: ['M12 2c2 5 7 7 7 12a7 7 0 0 1-14 0c0-3 2-5 4-7 0 3 1 4 2 5 2-3 2-6 1-10Z'],
}
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path v-for="(path, index) in paths[name] ?? paths.camera" :key="index" :d="path" :fill="name === 'fire' ? 'currentColor' : 'none'" />
  </svg>
</template>
