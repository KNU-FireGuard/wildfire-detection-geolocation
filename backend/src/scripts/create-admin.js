const { randomBytes, scrypt } = require('node:crypto');
const { promisify } = require('node:util');

const deriveKey = promisify(scrypt);
const SCRYPT_COST = 131072;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;

async function createAdmin(db, username, password) {
  if (!username || username.trim() !== username) {
    throw new Error('ADMIN_USERNAME에 공백 없는 관리자 ID를 입력하세요');
  }
  if (!password) {
    throw new Error('ADMIN_INITIAL_PASSWORD에 초기 비밀번호를 입력하세요');
  }
  if (password.length < 12) {
    throw new Error('ADMIN_INITIAL_PASSWORD는 12자 이상이어야 합니다');
  }

  const salt = randomBytes(16);
  const hash = await deriveKey(password, salt, 64, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
    maxmem: 256 * 1024 * 1024,
  });
  const passwordHash = `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELISM}$${salt.toString('hex')}$${hash.toString('hex')}`;
  const result = await db.query(`
    INSERT INTO admins (username, password_hash)
    SELECT $1, $2
    WHERE NOT EXISTS (SELECT 1 FROM admins)
    ON CONFLICT (username) DO NOTHING
    RETURNING id
  `, [username, passwordHash]);
  return result.rows.length > 0;
}

if (require.main === module) {
  const db = require('../config/db');
  createAdmin(db, process.env.ADMIN_USERNAME, process.env.ADMIN_INITIAL_PASSWORD)
    .then((created) => {
      console.log(created ? '초기 관리자 계정을 생성했습니다' : '관리자 계정이 이미 있어 변경하지 않았습니다');
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => db.end());
}

module.exports = { createAdmin };
