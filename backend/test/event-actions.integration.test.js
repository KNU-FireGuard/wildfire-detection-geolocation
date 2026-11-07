const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
test('PostgreSQL: 전체 확인·이벤트 삭제는 캡처를 정리하고 문자 이력은 보존한다', {
  skip: process.env.npm_lifecycle_event !== 'test:integration' && process.env.RUN_DB_TESTS !== '1',
}, async () => {
  const pool = require('../src/config/db');
  const client = await pool.connect();
  let server;
  try {
    await client.query('SET search_path TO pg_temp');
    const schema = readFileSync(path.join(__dirname, '../../sql/init.sql'), 'utf8')
      .replaceAll('CREATE TABLE IF NOT EXISTS ', 'CREATE TEMP TABLE ')
      .replace(/^BEGIN;\s*/m, '').replace(/COMMIT;\s*$/, '');
    await client.query(schema);
    const cameraId = (await client.query("INSERT INTO cameras (name,source_type) VALUES ('test','test') RETURNING id")).rows[0].id;
    const videoId = (await client.query("INSERT INTO videos(camera_id,original_filename,file_path) VALUES ($1,'test.mp4','data/videos/test.mp4') RETURNING id", [cameraId])).rows[0].id;
    const events = (await client.query("INSERT INTO detection_events(video_id,class,started_at,max_confidence) VALUES ($1,'fire',CURRENT_TIMESTAMP,.9), ($1,'smoke',CURRENT_TIMESTAMP,.9) RETURNING id,updated_at", [videoId])).rows;
    const eventId = events[0].id;
    await client.query('INSERT INTO event_captures(event_id,video_time_ms,jpeg) VALUES ($1,3800,$2)', [eventId, Buffer.from([255,216,255,217])]);
    await client.query("INSERT INTO sms_logs(camera_id,event_id,message,status,provider) VALUES ($1,$2,'test','sent','console')", [cameraId,eventId]);
    const dbPath = require.resolve('../src/config/db');
    let failDelete = false;
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
      query: (...args) => client.query(...args), connect: async () => ({
        query: async (...args) => {
          const result = await client.query(...args);
          if (failDelete && /DELETE FROM detection_events/.test(args[0])) throw new Error('simulated failure after delete');
          return result;
        }, release() {},
      }),
    } };
    const app = require('../src/app');
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const bulk = await fetch(`${base}/events/acknowledge-all`, { method: 'POST' });
    assert.equal((await bulk.json()).count, 2);
    const saved = (await client.query('SELECT acknowledged_at,updated_at FROM detection_events ORDER BY id')).rows;
    assert.ok(saved.every(row => row.acknowledged_at));
    assert.equal(saved[0].updated_at.toISOString(), events[0].updated_at.toISOString());
    failDelete = true;
    assert.equal((await fetch(`${base}/events/${eventId}`, { method: 'DELETE' })).status, 500);
    assert.equal(Number((await client.query('SELECT count(*) FROM event_captures')).rows[0].count), 1);
    assert.equal((await client.query('SELECT event_id FROM sms_logs')).rows[0].event_id, eventId);
    assert.equal(Number((await client.query('SELECT count(*) FROM detection_events')).rows[0].count), 2);
    failDelete = false;
    assert.equal((await fetch(`${base}/events/${eventId}`, { method: 'DELETE' })).status, 204);
    assert.equal(Number((await client.query('SELECT count(*) FROM event_captures')).rows[0].count), 0);
    assert.equal((await client.query('SELECT event_id FROM sms_logs')).rows[0].event_id, null);
    assert.equal(Number((await client.query('SELECT count(*) FROM detection_events')).rows[0].count), 1);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    client.release(); await pool.end();
  }
});
