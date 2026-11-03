const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createNotifier } = require('../src/services/notifier');

const solapiOptions = {
  provider: 'solapi',
  apiKey: 'NCSTESTKEY',
  apiSecret: 'test-secret',
  sender: '01099998888',
  baseUrl: 'https://api.example.test',
  now: () => new Date('2026-11-03T01:00:00Z'),
  randomSalt: () => 'fixed-salt-for-test',
};

test('console 제공자는 실제 발송 없이 로그만 남긴다', async () => {
  const lines = [];
  const notifier = createNotifier({ provider: 'console', log: line => lines.push(line) });
  assert.equal(notifier.name, 'console');
  await notifier.send('01012345678', '테스트');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /테스트/);
});

test('solapi 제공자는 HMAC 서명 헤더와 국내 번호 형식으로 발송 API를 호출한다', async () => {
  const calls = [];
  const notifier = createNotifier({
    ...solapiOptions,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ groupId: 'G1' }) };
    },
  });
  assert.equal(notifier.name, 'solapi');
  await notifier.send('01012345678', '화재 탐지');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.test/messages/v4/send-many/detail');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  const authorization = calls[0].options.headers.Authorization;
  const match = /^HMAC-SHA256 apiKey=(\S+), date=(\S+), salt=(\S+), signature=([0-9a-f]{64})$/.exec(authorization);
  assert.ok(match, authorization);
  const [, apiKey, date, salt, signature] = match;
  assert.equal(apiKey, 'NCSTESTKEY');
  assert.match(date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/);
  assert.equal(new Date(date).getTime(), new Date('2026-11-03T01:00:00Z').getTime());
  assert.equal(salt, 'fixed-salt-for-test');
  assert.equal(signature, createHmac('sha256', 'test-secret').update(date + salt).digest('hex'));
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    messages: [{ to: '01012345678', from: '01099998888', text: '화재 탐지' }],
  });
});

test('solapi 응답이 실패하면 상태 코드와 오류 메시지를 포함해 거부한다', async () => {
  const notifier = createNotifier({
    ...solapiOptions,
    fetchImpl: async () => ({
      ok: false, status: 400,
      json: async () => ({ errorCode: 'SenderNotRegistered', errorMessage: '발신번호 미등록' }),
    }),
  });
  await assert.rejects(() => notifier.send('01012345678', '화재'), /HTTP 400.*발신번호 미등록/);
});

test('solapi 응답 본문에 errorCode가 있으면 HTTP 200이어도 실패로 처리한다', async () => {
  const notifier = createNotifier({
    ...solapiOptions,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ errorCode: 'X', errorMessage: '잔액 부족' }) }),
  });
  await assert.rejects(() => notifier.send('01012345678', '화재'), /잔액 부족/);
});

test('solapi 응답에 failedMessageList가 있으면 HTTP 200이어도 실패로 처리한다', async () => {
  const notifier = createNotifier({
    ...solapiOptions,
    fetchImpl: async () => ({
      ok: true, status: 200,
      json: async () => ({ failedMessageList: [{ to: '01012345678', statusMessage: '발신번호 사전 등록 오류' }] }),
    }),
  });
  await assert.rejects(() => notifier.send('01012345678', '화재'), /발신번호 사전 등록 오류/);
});

test('solapi 제공자는 010 휴대전화 번호가 아니면 호출 전에 거부한다', async () => {
  const notifier = createNotifier({ ...solapiOptions, fetchImpl: () => assert.fail('요청하면 안 됩니다') });
  await assert.rejects(() => notifier.send('0212345678', '화재'), /전화번호/);
  await assert.rejects(() => notifier.send('010-1234-5678', '화재'), /전화번호/);
});

test('solapi 제공자는 필수 설정이 없으면 생성할 수 없다', () => {
  assert.throws(() => createNotifier({ ...solapiOptions, apiKey: '' }), /SOLAPI_API_KEY/);
  assert.throws(() => createNotifier({ ...solapiOptions, apiSecret: '' }), /SOLAPI_API_SECRET/);
  assert.throws(() => createNotifier({ ...solapiOptions, sender: '' }), /SOLAPI_SENDER/);
  assert.throws(() => createNotifier({ ...solapiOptions, sender: '010-9999-8888' }), /SOLAPI_SENDER/);
});

test('알 수 없는 제공자는 거부한다', () => {
  assert.throws(() => createNotifier({ provider: 'textbee' }), /SMS_PROVIDER/);
  assert.throws(() => createNotifier({ provider: 'unknown' }), /SMS_PROVIDER/);
});
