const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeItsResponse, selectDistributed, createItsClient } = require('../src/services/its-cctv');
const { createCctvCatalog } = require('../src/services/cctv-catalog');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const entries = [
  ['서울', 126.98, 37.57], ['인천', 126.70, 37.46],
  ['춘천', 127.73, 37.88], ['강릉', 128.88, 37.75],
  ['대전', 127.38, 36.35], ['대구', 128.60, 35.87],
  ['광주', 126.85, 35.16], ['부산', 129.07, 35.18],
].map(([name, longitude, latitude]) => ({
  cctvname: name,
  coordx: String(longitude),
  coordy: String(latitude),
  cctvtype: '4',
  cctvurl: `https://video.example.test/${encodeURIComponent(name)}.m3u8`,
  roadsectionid: name,
}));

test('ITS 응답에서 HTTPS 실시간 영상과 유효한 좌표만 추출한다', () => {
  const cameras = normalizeItsResponse({ response: { data: [
    entries[0],
    { ...entries[1], cctvurl: 'http://video.example.test/plain.m3u8' },
    { ...entries[2], coordx: 'not-a-number' },
    { ...entries[3], cctvtype: '2' },
  ] } });

  assert.equal(cameras.length, 1);
  assert.equal(cameras[0].name, '서울');
  assert.equal(cameras[0].latitude, 37.57);
  assert.equal(cameras[0].longitude, 126.98);
  assert.match(cameras[0].providerKey, /^[a-f0-9]{32}$/);
});

test('후보가 여섯 곳 이상이면 지역적으로 분산된 여섯 곳을 결정적으로 고른다', () => {
  const cameras = normalizeItsResponse({ response: { data: entries } });
  const selected = selectDistributed(cameras, 6);

  assert.equal(selected.length, 6);
  assert.deepEqual(selectDistributed([...cameras].reverse(), 6), selected);
  assert.ok(selected.some(camera => camera.latitude > 37.5));
  assert.ok(selected.some(camera => camera.latitude < 35.5));
  assert.ok(selected.some(camera => camera.longitude < 127));
  assert.ok(selected.some(camera => camera.longitude > 128.8));
});

test('ITS 클라이언트는 명시적으로 호출될 때만 키를 사용하고 요청 실패를 숨기지 않는다', async () => {
  const urls = [];
  const client = createItsClient({
    apiKey: 'test-key',
    fetchImpl: async url => {
      urls.push(new URL(url));
      return { ok: true, json: async () => ({ response: { data: entries } }) };
    },
  });

  assert.equal(urls.length, 0);
  const cameras = await client.fetchCctvs();
  assert.equal(cameras.length, 8);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].pathname, '/cctvInfo');
  assert.equal(urls[0].searchParams.get('apiKey'), 'test-key');
  assert.equal(urls[0].searchParams.get('type'), 'its');
  assert.equal(urls[0].searchParams.get('cctvType'), '4');
  assert.equal(urls[0].searchParams.get('getType'), 'json');

  const broken = createItsClient({ apiKey: 'test-key', fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(broken.fetchCctvs(), /ITS CCTV 조회 실패/);
});

test('조회는 저장된 목록만 반환하고 관리자가 필요할 때 다시 갱신할 수 있다', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fireguard-cctv-'));
  const cachePath = path.join(directory, 'cctv.json');
  let calls = 0;
  const catalog = createCctvCatalog({
    cachePath,
    client: { fetchCctvs: async () => { calls++; return normalizeItsResponse({ response: { data: entries } }); } },
    now: () => new Date('2026-10-29T08:00:00Z'),
  });
  try {
    assert.deepEqual(await catalog.list(), { source: 'live', refreshedAt: null, items: [] });
    assert.equal(calls, 0);
    const first = await catalog.refresh();
    assert.equal(calls, 1);
    assert.equal(first.items.length, 6);
    assert.deepEqual(await catalog.list(), first);
    await catalog.refresh();
    assert.equal(calls, 2);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('ITS 오류로 갱신에 실패해도 다음 수동 요청은 다시 시도한다', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fireguard-cctv-'));
  let calls = 0;
  const options = {
    cachePath: path.join(directory, 'cctv.json'),
    client: { fetchCctvs: async () => { calls++; throw new Error('ITS 오류'); } },
    now: () => new Date('2026-10-29T08:00:00Z'),
  };
  try {
    await assert.rejects(createCctvCatalog(options).refresh(), /ITS 오류/);
    await assert.rejects(createCctvCatalog(options).refresh(), /ITS 오류/);
    assert.equal(calls, 2);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('ITS 응답 후 DB 저장 실패는 보관한 목록으로 재개해 제공자를 다시 호출하지 않는다', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fireguard-cctv-'));
  let calls = 0;
  let saves = 0;
  const catalog = createCctvCatalog({
    cachePath: path.join(directory, 'cctv.json'),
    client: { fetchCctvs: async () => { calls++; return normalizeItsResponse({ response: { data: entries } }); } },
    saveCameras: async items => {
      saves++;
      if (saves === 1) throw new Error('DB 연결 실패');
      return items.map((item, index) => ({ ...item, cameraId: index + 1 }));
    },
    now: () => new Date('2026-10-29T08:00:00Z'),
  });
  try {
    await assert.rejects(catalog.refresh(), /DB 연결 실패/);
    const result = await catalog.refresh();
    assert.equal(calls, 1);
    assert.equal(saves, 2);
    assert.equal(result.items.length, 6);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
