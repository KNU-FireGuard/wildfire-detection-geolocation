const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { verifyPassword } = require('../security/passwords');
const { getJwtSecret } = require('../middleware/require-admin');

const ACCESS_TOKEN_SECONDS = 60 * 60;

async function login(req, res) {
  const { username, password } = req.body || {};
  if (
    typeof username !== 'string'
    || username.trim() !== username
    || username.length === 0
    || typeof password !== 'string'
    || password.length === 0
  ) {
    return res.status(400).json({ error: 'username과 password를 입력하세요.' });
  }

  const { rows } = await pool.query(
    'SELECT id, username, password_hash FROM admins WHERE username = $1 LIMIT 1',
    [username],
  );
  const admin = rows[0];
  if (!admin || !(await verifyPassword(password, admin.password_hash))) {
    return res.status(401).json({ error: 'ID 또는 비밀번호가 올바르지 않습니다.' });
  }

  const secret = getJwtSecret();
  const accessToken = jwt.sign(
    { id: admin.id, username: admin.username },
    secret,
    { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_SECONDS },
  );

  return res.status(200).json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_SECONDS,
  });
}

function getMe(req, res) {
  return res.status(200).json(req.admin);
}

module.exports = { login, getMe };
