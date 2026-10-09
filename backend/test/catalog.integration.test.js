const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test('PostgreSQL: catalog queries and initial admin insert', {
  skip: process.env.npm_lifecycle_event !== 'test:integration' && process.env.RUN_DB_TESTS !== '1',
}, async () => {
  const pool = require('../src/config/db');
  let client;
  let server;
  try {
    client = await pool.connect();
    // 세션 전용 임시 테이블로 검증하며 기존 테이블과 데이터는 변경하지 않습니다.
    const schema = readFileSync(path.join(__dirname, '../../sql/init.sql'), 'utf8')
      .replaceAll('CREATE TABLE IF NOT EXISTS ', 'CREATE TEMP TABLE ')
      .replace(/COMMIT;\s*$/, '');
    await client.query(schema);

    const { createAdmin } = require('../src/scripts/create-admin');
    assert.equal(await createAdmin(client, 'admin', 'long-local-password'), true);
    assert.equal(await createAdmin(client, 'admin', 'long-local-password'), false);
    const adminRows = await client.query('SELECT username, password_hash FROM admins');
    assert.equal(adminRows.rows.length, 1);
    assert.equal(adminRows.rows[0].username, 'admin');
    assert.match(adminRows.rows[0].password_hash, /^scrypt\$/);

    await client.query(`
      INSERT INTO cameras (name, source_type, latitude, longitude)
      VALUES ('test camera', 'test', 35.1, 128.1), ('live camera', 'live', NULL, NULL);
      INSERT INTO videos (camera_id, original_filename, file_path)
      VALUES (1, 'known.mp4', 'data/videos/known.mp4'),
             (NULL, 'unknown.mp4', 'data/videos/unknown.mp4');
      INSERT INTO detection_events
        (video_id, class, started_at, ended_at, max_confidence,
         estimated_latitude, estimated_longitude, error_range_m)
      VALUES
        (1, 'fire', '2026-10-01T09:00:00+09:00', '2026-10-01T09:01:00+09:00', 0.9, 35.2, 128.2, 50),
        (2, 'smoke', '2026-10-02T09:00:00+09:00', NULL, 0.8, NULL, NULL, NULL),
        (1, 'fire', '2026-10-02T09:00:00+09:00', NULL, 0.95, 35.3, 128.3, 30);
    `);

    // API SQL도 같은 연결을 사용해 세션 내 임시 테이블만 조회합니다.
    require.cache[require.resolve('../src/config/db')].exports = {
      query: (...args) => client.query(...args),
    };
    const app = require('../src/app');
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = async (url, status = 200) => {
      const response = await fetch(base + url);
      assert.equal(response.status, status, url);
      return response.json();
    };

    const cameras = await get('/api/cameras');
    assert.deepEqual(cameras.items.map(row => row.id), [1, 2]);
    assert.deepEqual(cameras.items.map(row => row.source_type), ['test', 'live']);
    assert.equal(cameras.items[1].latitude, null);
    const videos = await get('/api/videos');
    assert.deepEqual(videos.items.map(row => row.id), [2, 1]);
    assert.equal(videos.items[0].camera_id, null);
    assert.equal(videos.items[0].original_filename, 'unknown.mp4');
    assert.ok(videos.items.every(row => !Object.hasOwn(row, 'file_path')));

    const events = await get('/api/events');
    assert.deepEqual(events.items.map(row => row.id), [3, 2, 1]);
    assert.equal(events.items[1].camera_id, null);
    assert.equal(events.items[1].estimated_latitude, null);
    assert.equal(events.items[1].ended_at, null);
    assert.equal(events.items[2].started_at, '2026-10-01T00:00:00.000Z');
    assert.equal(events.items[2].max_confidence, 0.9);
    const page = await get('/api/events?limit=1&offset=1');
    assert.deepEqual(page, { items: [events.items[1]], limit: 1, offset: 1 });
    const empty = await get('/api/events?offset=3');
    assert.deepEqual(empty.items, []);
    const detail = await get('/api/events/2');
    assert.deepEqual(detail.item, events.items[1]);
    await get('/api/events/999', 404);

    await client.query("INSERT INTO cameras (name, source_type) VALUES ('경북의성', 'live')");
    const seed = readFileSync(path.join(__dirname, '../../sql/seed.dev.sql'), 'utf8')
      .replace(/^--[^\n]*\n(?:--[^\n]*\n)*BEGIN;\s*/, '')
      .replace(/COMMIT;\s*$/, '');
    await client.query(seed);
    const seeded = await client.query("SELECT name, source_type FROM cameras WHERE name = '경북의성' ORDER BY id");
    assert.deepEqual(seeded.rows.map(row => row.source_type), ['live', 'test']);
    const demoCameras = await client.query("SELECT COUNT(*)::int AS count FROM cameras WHERE source_type = 'test' AND name IN ('경북의성', '청성', '기도4교', '단촌4터널')");
    assert.equal(demoCameras.rows[0].count, 4);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    await pool.end();
  }
});
