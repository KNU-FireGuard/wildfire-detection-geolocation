const { test } = require('node:test');
const assert = require('node:assert/strict');

const dbPath = require.resolve('../src/config/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [] }) } };
const { createFireAlert, buildMessage } = require('../src/services/fire-alert');

function setup({ camera, sendError, queryError } = {}) {
  const queries = [];
  const sent = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (queryError) throw queryError;
      if (/FROM cameras/.test(sql)) return { rows: camera ? [camera] : [] };
      return { rows: [] };
    },
  };
  const notifier = {
    name: 'console',
    async send(phone, message) {
      if (sendError) throw sendError;
      sent.push({ phone, message });
    },
  };
  return { alert: createFireAlert({ pool, notifier }), queries, sent };
}

const logInsert = queries => queries.find(call => /INSERT INTO sms_logs/.test(call.sql));

test('번호가 있는 카메라의 화재 탐지는 문자를 보내고 sent로 기록한다', async () => {
  const { alert, queries, sent } = setup({ camera: { name: '북악산 CCTV', alert_phone: '01012345678' } });
  await alert.notifyFire({ cameraId: 3, eventId: 15, confidence: 0.944 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].phone, '01012345678');
  assert.match(sent[0].message, /북악산 CCTV/);
  assert.match(sent[0].message, /화재/);
  assert.deepEqual(logInsert(queries).params, [3, 15, '01012345678', sent[0].message, 'sent', 'console', null]);
});

test('번호가 없는 카메라는 발송하지 않고 skipped로 기록한다', async () => {
  const { alert, queries, sent } = setup({ camera: { name: '번호 없음', alert_phone: null } });
  await alert.notifyFire({ cameraId: 3, eventId: 15, confidence: 0.9 });
  assert.equal(sent.length, 0);
  const params = logInsert(queries).params;
  assert.deepEqual([params[0], params[1], params[2], params[4]], [3, 15, null, 'skipped']);
});

test('발송이 실패해도 예외 없이 failed와 오류 사유를 기록한다', async () => {
  const { alert, queries } = setup({
    camera: { name: 'CCTV', alert_phone: '01012345678' },
    sendError: new Error('솔라피 발송 실패 (HTTP 429)'),
  });
  await alert.notifyFire({ cameraId: 3, eventId: 15, confidence: 0.9 });
  const params = logInsert(queries).params;
  assert.equal(params[4], 'failed');
  assert.equal(params[6], '솔라피 발송 실패 (HTTP 429)');
});

test('카메라가 없으면 기록 없이 종료한다', async () => {
  const { alert, queries, sent } = setup({ camera: null });
  await alert.notifyFire({ cameraId: 99, eventId: 1, confidence: 0.9 });
  assert.equal(sent.length, 0);
  assert.equal(logInsert(queries), undefined);
});

test('DB 오류가 나도 호출자에게 예외를 던지지 않는다', async () => {
  const { alert } = setup({ queryError: new Error('db down') });
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.doesNotReject(() => alert.notifyFire({ cameraId: 3, eventId: 15, confidence: 0.9 }));
  } finally {
    console.error = originalError;
  }
});

// SMS는 90바이트(한글 2바이트)까지, 넘으면 LMS로 전환되어 비용이 늘어남
function smsBytes(text) {
  return [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 2 : 1), 0);
}

test('문구는 카메라 이름이 길어도 SMS 90바이트를 넘지 않는다', () => {
  assert.match(buildMessage('북악산 CCTV'), /북악산 CCTV/);
  const long = buildMessage('[경부선] 서울에서 부산 방향 아주 긴 이름의 도로 CCTV 카메라 이름 입니다 열두번째');
  assert.ok(smsBytes(long) <= 90, `${smsBytes(long)}바이트`);
  assert.match(long, /화재/);
});
