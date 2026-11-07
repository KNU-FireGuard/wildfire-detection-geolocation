const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCaptureStore } = require('../src/services/event-captures');

test('같은 이벤트 캡처는 행 잠금 안에서 영상 시각 5초 간격을 검증한다', async () => {
  const saved = [];
  let previous = null;
  const sqls = [];
  const client = {
    async query(sql, params) {
      sqls.push(sql);
      if (/FOR UPDATE/.test(sql)) return { rows: [{ id: 7 }] };
      if (/SELECT video_time_ms/.test(sql)) return { rows: previous === null ? [] : [{ video_time_ms: previous }] };
      if (/INSERT INTO event_captures/.test(sql)) {
        previous = params[1]; saved.push(previous); return { rows: [{ id: saved.length, video_time_ms: previous }] };
      }
      return { rows: [] };
    }, release() {},
  };
  const store = createCaptureStore({ pool: { connect: async () => client } });
  assert.equal((await store.save(7, 3800, Buffer.from('jpeg'))).id, 1);
  assert.equal(await store.save(7, 8799, Buffer.from('jpeg')), null);
  assert.equal((await store.save(7, 8800, Buffer.from('jpeg'))).id, 2);
  assert.equal(await store.save(7, 2000, Buffer.from('jpeg')), null);
  assert.deepEqual(saved, [3800, 8800]);
  assert.ok(sqls.some(sql => /FOR UPDATE/.test(sql)));
});

test('캡처 DB 저장 실패는 롤백하고 연결을 해제한다', async () => {
  let released = false;
  const sqls = [];
  const store = createCaptureStore({ pool: { connect: async () => ({
    query: async sql => { sqls.push(sql); if (/FOR UPDATE/.test(sql)) throw new Error('DB failed'); return { rows: [] }; },
    release: () => { released = true; },
  }) } });
  await assert.rejects(store.save(7, 0, Buffer.from('jpeg')), /DB failed/);
  assert.ok(sqls.includes('ROLLBACK'));
  assert.equal(released, true);
});
