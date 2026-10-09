const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scrypt } = require('node:crypto');
const { promisify } = require('node:util');
const { createAdmin } = require('../src/scripts/create-admin');

test('초기 관리자를 한 번만 만들고 비밀번호 해시만 저장한다', async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      return { rows: queries.length === 1 ? [{ id: 1 }] : [] };
    },
  };

  const first = await createAdmin(db, 'admin', 'long-local-password');
  const second = await createAdmin(db, 'admin', 'long-local-password');

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /INSERT INTO admins/);
  assert.equal(queries[0].params[0], 'admin');
  assert.equal(queries[0].sql.includes('long-local-password'), false);
  assert.equal(queries[0].params.includes('long-local-password'), false);

  const [algorithm, cost, blockSize, parallelism, salt, storedHash] = queries[0].params[1].split('$');
  assert.equal(algorithm, 'scrypt');
  const derived = await promisify(scrypt)('long-local-password', Buffer.from(salt, 'hex'), 64, {
    N: Number(cost), r: Number(blockSize), p: Number(parallelism), maxmem: 256 * 1024 * 1024,
  });
  assert.equal(derived.toString('hex'), storedHash);
});

test('초기 관리자 ID와 비밀번호가 비어 있거나 너무 짧으면 거부한다', async () => {
  const db = { query: () => { throw new Error('DB를 조회해서는 안 됩니다'); } };
  await assert.rejects(createAdmin(db, '', 'long-local-password'), /ADMIN_USERNAME/);
  await assert.rejects(createAdmin(db, 'admin', ''), /ADMIN_INITIAL_PASSWORD/);
  await assert.rejects(createAdmin(db, 'admin', 'short'), /12자/);
});
