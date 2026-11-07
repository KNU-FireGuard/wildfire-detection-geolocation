const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createCaptureStore } = require('../src/services/event-captures');

test('PostgreSQL: 캡처는 동일 이벤트에 5초 간격으로 저장되고 원본 JPEG를 보존한다', {
  skip: process.env.npm_lifecycle_event !== 'test:integration' && process.env.RUN_DB_TESTS !== '1',
}, async () => {
  const pool = require('../src/config/db');
  const client = await pool.connect();
  try {
    await client.query('SET search_path TO pg_temp');
    const schema = readFileSync(path.join(__dirname, '../../sql/init.sql'), 'utf8')
      .replaceAll('CREATE TABLE IF NOT EXISTS ', 'CREATE TEMP TABLE ')
      .replace(/^BEGIN;\s*/m, '').replace(/COMMIT;\s*$/, '');
    await client.query(schema);
    const camera = (await client.query("INSERT INTO cameras (name, source_type) VALUES ('capture test', 'test') RETURNING id")).rows[0].id;
    const video = (await client.query("INSERT INTO videos (camera_id, original_filename, file_path) VALUES ($1, 'fixture.mp4', 'data/videos/fixture.mp4') RETURNING id", [camera])).rows[0].id;
    const event = (await client.query("INSERT INTO detection_events (video_id, class, started_at, max_confidence) VALUES ($1, 'smoke', CURRENT_TIMESTAMP, .9) RETURNING id", [video])).rows[0].id;
    const store = createCaptureStore({ pool: { connect: async () => ({ query: (...args) => client.query(...args), release() {} }) } });
    const jpeg = Buffer.from([255, 216, 255, 217]);
    assert.ok(await store.save(event, 3800, jpeg));
    assert.equal(await store.save(event, 8799, jpeg), null);
    assert.ok(await store.save(event, 8800, jpeg));
    const rows = (await client.query('SELECT video_time_ms, jpeg FROM event_captures ORDER BY video_time_ms')).rows;
    assert.deepEqual(rows.map(row => Number(row.video_time_ms)), [3800, 8800]);
    assert.deepEqual(rows[0].jpeg, jpeg);
  } finally { client.release(); await pool.end(); }
});
