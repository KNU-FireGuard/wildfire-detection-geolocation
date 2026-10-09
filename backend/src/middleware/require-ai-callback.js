const { timingSafeEqual } = require('node:crypto');

function getAiCallbackToken() {
  const token = process.env.AI_CALLBACK_TOKEN;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('AI_CALLBACK_TOKEN을 프로젝트 루트의 .env에 설정하세요.');
  }
  return token;
}

function requireAiCallback(req, res, next) {
  let expected;
  try {
    expected = Buffer.from(getAiCallbackToken(), 'utf8');
  } catch (error) {
    return next(error);
  }

  const supplied = req.get('x-ai-token');
  const actual = typeof supplied === 'string' ? Buffer.from(supplied, 'utf8') : Buffer.alloc(0);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return res.status(401).json({ error: 'AI 인증 토큰이 없거나 유효하지 않습니다.' });
  }
  return next();
}

module.exports = { getAiCallbackToken, requireAiCallback };
