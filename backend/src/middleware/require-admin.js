const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET을 32바이트 이상의 임의 문자열로 설정하세요.');
  }
  return secret;
}

function unauthorized(res) {
  return res.status(401).json({ error: '로그인이 필요하거나 토큰이 유효하지 않습니다.' });
}

function requireAdmin(req, res, next) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(req.get('authorization') || '');
  if (!match) return unauthorized(res);

  let secret;
  try {
    secret = getJwtSecret();
  } catch (error) {
    return next(error);
  }

  try {
    const claims = jwt.verify(match[1], secret, { algorithms: ['HS256'] });
    if (!Number.isSafeInteger(claims.id) || claims.id < 1 || typeof claims.username !== 'string') {
      return unauthorized(res);
    }
    req.admin = { id: claims.id, username: claims.username };
    return next();
  } catch {
    return unauthorized(res);
  }
}

module.exports = { getJwtSecret, requireAdmin };
