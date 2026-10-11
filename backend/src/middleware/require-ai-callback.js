const { timingSafeEqual } = require('node:crypto');

function getAiCallbackToken() {
  const token = process.env.AI_CALLBACK_TOKEN;
  if (
    typeof token !== 'string'
    || Buffer.byteLength(token, 'utf8') < 32
    || /^replace_with_/i.test(token)
  ) {
    throw new Error('AI_CALLBACK_TOKEN은 32바이트 이상의 임의 문자열로 설정하세요.');
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
