const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { saveLiveCameras } = require('../src/services/live-camera-sync');

const item = (name, latitude, longitude, providerKey) => ({ name, latitude, longitude, providerKey, streamUrl: `http://video.example.test/${name}.m3u8` });

test('PostgreSQL: 실시간 카메라 갱신은 같은 CCTV를 중복 행으로 만들지 않는다', {
  skip: process.env.npm_lifecycle_event !== 'test:integration' && process.env.RUN_DB_TESTS !== '1',
}, async () => {
  const pool = require('../src/config/db');
  const client = await pool.connect();
  try {
    // 세션 전용 임시 테이블로 검증하며 기존 테이블과 데이터는 변경하지 않습니다.
    const schema = readFileSync(path.join(__dirname, '../../sql/init.sql'), 'utf8')
      .replaceAll('CREATE TABLE IF NOT EXISTS ', 'CREATE TEMP TABLE ')
      .replace(/COMMIT;\s*$/, '');
    await client.query(schema);
    const sameSession = { connect: async () => ({ query: (...args) => client.query(...args), release() {} }) };
    const count = async () => Number((await client.query("SELECT count(*) FROM cameras WHERE source_type = 'live'")).rows[0].count);

    // 첫 갱신은 새 행을 만든다
    const first = await saveLiveCameras([item('고성', 38.54174, 128.40352, 'key-1'), item('완도', 34.31, 126.75, 'key-2')], { pool: sameSession });
    assert.equal(await count(), 2);

    // 같은 키로 다시 갱신하면 같은 행을 수정만 한다
    const again = await saveLiveCameras([item('고성', 38.54174, 128.40352, 'key-1')], { pool: sameSession });
    assert.equal(again[0].cameraId, first[0].cameraId);
    assert.equal(await count(), 2);

    // 키가 달라졌어도(옛 방식 키) 이름이 같고 약 1km 안이면 같은 행을 재사용하고 키와 좌표를 갱신한다
    const legacy = await saveLiveCameras([item('고성', 38.5417, 128.404, 'new-stable-key')], { pool: sameSession });
    assert.equal(legacy[0].cameraId, first[0].cameraId);
    assert.equal(await count(), 2);
    const row = (await client.query('SELECT provider_key, latitude, longitude FROM cameras WHERE id = $1', [first[0].cameraId])).rows[0];
    assert.equal(row.provider_key, 'new-stable-key');
    assert.equal(row.latitude, 38.5417);

    // 이름이 같아도 멀리 떨어진 다른 CCTV는 별도 행으로 추가한다
    const far = await saveLiveCameras([item('고성', 35.5, 129.1, 'far-key')], { pool: sameSession });
    assert.notEqual(far[0].cameraId, first[0].cameraId);
    assert.equal(await count(), 3);

    // Test 카메라는 같은 이름이어도 재사용 대상이 아니다
    await client.query("INSERT INTO cameras (name, source_type) VALUES ('완도', 'test')");
    const wando = await saveLiveCameras([item('완도', 34.31, 126.75, 'key-2')], { pool: sameSession });
    assert.equal(wando[0].cameraId, first[1].cameraId);
    assert.equal(await count(), 3);
  } finally {
    client.release();
    await pool.end();
  }
});
