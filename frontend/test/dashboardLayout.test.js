import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'

test('선택한 카메라 상세는 지도와 같은 줄에, 관제 요약은 그 아래에 둔다', () => {
  const source = readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const template = descriptor.template.content
  const grid = template.indexOf('class="dashboard-grid"')
  const map = template.indexOf('<MonitoringMap', grid)
  const detail = template.indexOf('<EventDetail', grid)
  const summary = template.indexOf('class="summary-grid"')
  assert.ok(grid >= 0 && map > grid && detail > map && summary > detail)
  assert.match(descriptor.styles[0].content, /\.map-panel\s*\{[^}]*grid-column:\s*1\s*;/)
  assert.match(descriptor.styles[0].content, /\.detail-panel\s*\{[^}]*grid-column:\s*2\s*;/)
})
