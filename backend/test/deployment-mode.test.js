const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const originalMode = process.env.DEMO_MODE;
const originalNodeEnv = process.env.NODE_ENV;
const dbPath = require.resolve('../src/config/db');
let queries = 0;
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  async query() { queries++; return { rows: [] }; },
} };
const app = require('../src/app');
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  if (originalMode === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = originalMode;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  await new Promise(resolve => server.close(resolve));
});

test('배포 모드는 테스트 실행·영상·콜백을 DB 접근 전에 차단한다', async () => {
  process.env.DEMO_MODE = 'false';
  queries = 0;
  for (const [method, path] of [
    ['POST', '/cameras/1/test-runs'], ['GET', '/test-runs/1'],
    ['GET', '/test-runs/1/stream'], ['POST', '/test-runs/1/video'],
    ['POST', '/test-runs/1/captures/fire'], ['GET', '/videos/1/stream'],
  ]) {
    const result = await fetch(base + path, { method });
    assert.equal(result.status, 404, `${method} ${path}`);
    assert.match((await result.json()).error, /비활성화/);
  }
  const result = await fetch(base + '/videos');
  assert.deepEqual(await result.json(), { items: [], limit: 50, offset: 0 });
  assert.equal(queries, 0);
});

test('production 기본값은 OFF, 명시적 데모 설정에서만 영상 목록을 조회한다', async () => {
  delete process.env.DEMO_MODE;
  process.env.NODE_ENV = 'production';
  queries = 0;
  assert.equal((await fetch(base + '/cameras/1/test-runs', { method: 'POST' })).status, 404);
  assert.equal(queries, 0);
  process.env.DEMO_MODE = 'true';
  assert.equal((await fetch(base + '/videos')).status, 200);
  assert.equal(queries, 1);
});

test('운영 시작은 빈 DB만 허용하고 테스트 데이터가 있으면 삭제 없이 거부한다', async () => {
  const { assertDeploymentDatabase } = require('../src/middleware/deployment-mode');
  process.env.DEMO_MODE = 'false';
  const sqls = [];
  for (const count of ['0', '1', '4']) {
    const pool = { async query(sql) { sqls.push(sql); return { rows: [{ count }] }; } };
    if (count === '0') await assertDeploymentDatabase(pool);
    else await assert.rejects(assertDeploymentDatabase(pool), /테스트 데이터/);
  }
  assert.ok(sqls.every(sql => /^SELECT /.test(sql) && !/DELETE|INSERT|UPDATE/.test(sql)));
  process.env.DEMO_MODE = 'true';
  await assertDeploymentDatabase({ query() { assert.fail('데모 DB는 운영 검사를 하지 않음'); } });
});
