import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'

test('선택한 카메라 상세는 지도 오른쪽에, 관제 요약은 그 아래에 둔다', () => {
  const source = readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const template = descriptor.template.content
  const grid = template.indexOf('class="dashboard-grid"')
  const map = template.indexOf('<MonitoringMap', grid)
  const detail = template.indexOf('<EventDetail', grid)
  const summary = template.indexOf('class="summary-grid"')
  assert.ok(grid >= 0 && map > grid && detail > map && summary > detail)
  assert.match(descriptor.styles[0].content, /\.dashboard-grid\.with-detail:not\(\.map-hidden\)\s*\{[^}]*grid-template-columns:/)
  assert.match(descriptor.styles[0].content, /\.map-panel\s*\{[^}]*grid-column:\s*1\s*;/)
  assert.match(descriptor.styles[0].content, /\.detail-panel\s*\{[^}]*grid-column:\s*2\s*;/)
})

test('실시간 관제 영상은 선택과 무관하게 표시하고 선택해도 영상 월의 플레이어를 유지한다', () => {
  const dashboard = parse(readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8')).descriptor
  const wall = parse(readFileSync(new URL('../src/components/LiveCctvWall.vue', import.meta.url), 'utf8')).descriptor
  const dashboardTemplate = dashboard.template.content
  const wallTemplate = wall.template.content

  assert.match(dashboardTemplate, /<LiveCctvWall\b[^>]*:cameras="liveCameras"[^>]*:selected-id="selectedCamera\?\.sourceType === 'live' \? selectedCamera\.id : null"/)
  assert.ok(dashboardTemplate.indexOf('<LiveCctvWall') > dashboardTemplate.indexOf('<MonitoringMap'))
  assert.match(wallTemplate, /v-for="camera in cameras"[^>]*:key="camera\.id"/)
  assert.match(wallTemplate, /<LiveVideo\b[^>]*:url="camera\.streamUrl"/)
  assert.match(wallTemplate, /:class="\{ selected: camera\.id === selectedId \}"/)
  assert.doesNotMatch(wallTemplate, /v-if="camera\.id === selectedId"/)
  assert.match(dashboard.scriptSetup.content, /liveCameras = computed\(\(\) => cameras\.value\.filter\(camera => camera\.sourceType === 'live'\)\)/)
  assert.match(dashboardTemplate, /<LiveCctvWall\b[^>]*@select="selectLiveTile"/)
  assert.match(dashboard.scriptSetup.content, /function selectLiveTile\(id\) \{\s*if \(id === null\)/)
})

test('상세 패널은 화면에 고정되거나 자체 스크롤을 갖지 않고 페이지와 함께 스크롤한다', () => {
  const { descriptor } = parse(readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8'))
  const css = descriptor.styles[0].content
  // 넓은 화면의 기본 규칙 전체를 검사(미디어 쿼리 안의 해제 규칙으로 가려지지 않도록 쿼리를 제외)
  const base = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
  const rules = [...base.matchAll(/(^|[}\s])([^{}]*\.detail-panel[^{}]*)\{([^}]*)\}/g)].map(match => match[3]).join(';')
  assert.match(rules, /grid-column:\s*2/)
  assert.doesNotMatch(rules, /position:\s*sticky/)
  assert.doesNotMatch(rules, /max-height/)
  assert.doesNotMatch(rules, /overflow(-y)?:\s*(auto|scroll)/)
})

test('실시간 카메라나 이벤트를 선택해도 화면을 자동으로 스크롤하지 않는다', () => {
  const { descriptor } = parse(readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8'))
  assert.doesNotMatch(descriptor.scriptSetup.content, /scrollIntoView|revealLiveWall|scrollTo\(/)
})

test('실시간 카메라를 선택하면 상세 패널에 영상을 표시하고 영상 월의 타일은 확대하지 않는다', () => {
  const read = name => parse(readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')).descriptor
  const dashboard = read('views/DashboardView.vue')
  const wall = read('components/LiveCctvWall.vue')
  const detail = read('components/EventDetail.vue')
  assert.doesNotMatch(dashboard.template.content, /show-video/)
  assert.doesNotMatch(detail.scriptSetup.content, /showVideo/)
  assert.match(detail.template.content, /<template v-if="camera\?\.sourceType === 'live' && camera\.streamUrl">/)
  assert.doesNotMatch(wall.styles[0].content, /\.live-tile\.selected[^{]*\{[^}]*(grid-column|order\s*:)/)
})

test('CCTV 닫기는 대시보드의 선택을 해제하고 상세 패널을 숨긴다', () => {
  const dashboard = parse(readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8')).descriptor
  const detail = parse(readFileSync(new URL('../src/components/EventDetail.vue', import.meta.url), 'utf8')).descriptor
  assert.match(dashboard.template.content, /<EventDetail[^>]*\sclosable\s+@close="closeCctv"/)
  assert.match(dashboard.scriptSetup.content, /function closeCctv\(\)\s*\{[^}]*selectedCameraId\.value = null[^}]*selectedEventId\.value = null/)
  assert.match(detail.template.content, /@click="emit\('close'\)"[^>]*>CCTV 닫기<\/button>/)
})


test('대시보드 헤더는 제목 "대시보드"만 보여 주고 홍보성 문구와 부제는 두지 않는다', () => {
  const { descriptor } = parse(readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8'))
  const header = descriptor.template.content.match(/<header class="dashboard-header">([\s\S]*?)<\/header>/)?.[1] ?? ''
  assert.match(header, /<h1>대시보드<\/h1>/)
  assert.doesNotMatch(header, /산불로부터|지켜줍니다/)
  assert.doesNotMatch(header, /<p>/)
})
