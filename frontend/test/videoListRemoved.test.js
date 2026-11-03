import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'

const read = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')

test('영상 목록 화면은 메뉴와 경로에서 제거되었다', () => {
  assert.doesNotMatch(read('App.vue'), /\/videos|영상 목록/)
  assert.doesNotMatch(read('router.js'), /\/videos|resource:\s*'videos'/)
})

test('목록 화면(CatalogView)에는 영상 목록용 코드가 남아 있지 않고 카메라·이벤트 목록은 유지된다', () => {
  const source = read('views/CatalogView.vue')
  const { descriptor } = parse(source)
  assert.doesNotMatch(source, /fetchVideos|resource === 'videos'|selectedVideo|video-player|play-button|영상 목록/)
  assert.match(descriptor.scriptSetup.content, /cameras:\s*fetchCameras/)
  assert.match(descriptor.scriptSetup.content, /events:\s*fetchEvents/)
})

test('등록된 영상이 없다는 안내는 사라진 영상 목록 메뉴를 가리키지 않고 영상 등록 방법을 알려 준다', () => {
  const template = parse(read('components/EventDetail.vue')).descriptor.template.content
  const message = template.match(/<strong>재생할 영상이 없습니다\.<\/strong><p>([^<]*)<\/p>/)?.[1] ?? ''
  assert.ok(message.length > 0, '안내 문구를 찾지 못했습니다')
  assert.doesNotMatch(message, /영상 목록/)
  assert.match(message, /data\/videos/)
})

test('없는 주소는 템플릿 문자열이 아닌 실제 화면 컴포넌트로 안내한다(런타임 컴파일 없는 빌드에서도 표시)', () => {
  const router = read('router.js')
  assert.doesNotMatch(router, /template\s*:/)
  assert.match(router, /pathMatch\(\.\*\)\*[^}]*component:\s*NotFoundView/)
  const view = parse(read('views/NotFoundView.vue')).descriptor
  assert.match(view.template.content, /페이지를 찾을 수 없습니다/)
  assert.match(view.template.content, /<RouterLink[^>]*to="\/"/)
})
