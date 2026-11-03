const { createHmac, randomBytes } = require('node:crypto');

const DOMESTIC_MOBILE = /^010\d{8}$/;
const SENDER_NUMBER = /^0\d{8,10}$/;
const SALT_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const REQUEST_TIMEOUT_MS = 10000;

function createConsoleNotifier(log) {
  return {
    name: 'console',
    async send(phone, message) {
      log(`[SMS console] ${phone} ${message}`);
    },
  };
}

// 초 단위 ISO 8601 시각과 로컬 시간대 오프셋, 예: 2026-11-03T10:00:00+09:00
function isoWithOffset(date) {
  const pad = value => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

function randomSaltDefault() {
  return Array.from(randomBytes(32), byte => SALT_ALPHABET[byte % SALT_ALPHABET.length]).join('');
}

function createSolapiNotifier({ apiKey, apiSecret, sender, baseUrl, fetchImpl, now, randomSalt }) {
  if (!apiKey) throw new Error('SMS_PROVIDER=solapi에는 SOLAPI_API_KEY가 필요합니다.');
  if (!apiSecret) throw new Error('SMS_PROVIDER=solapi에는 SOLAPI_API_SECRET이 필요합니다.');
  if (!SENDER_NUMBER.test(sender || '')) {
    throw new Error('SOLAPI_SENDER는 솔라피에 등록된 발신번호를 하이픈 없이 입력해야 합니다.');
  }
  // 서명 대상은 date + salt, 키는 API Secret
  function authorization() {
    const date = isoWithOffset(now());
    const salt = randomSalt();
    const signature = createHmac('sha256', apiSecret).update(date + salt).digest('hex');
    return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
  }
  return {
    name: 'solapi',
    async send(phone, message) {
      if (!DOMESTIC_MOBILE.test(phone)) throw new Error('전화번호는 010으로 시작하는 숫자 11자리여야 합니다.');
      const response = await fetchImpl(`${baseUrl}/messages/v4/send-many/detail`, {
        method: 'POST',
        headers: { Authorization: authorization(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ to: phone, from: sender, text: message }] }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`솔라피 발송 실패 (HTTP ${response.status})${body.errorMessage ? `: ${body.errorMessage}` : ''}`);
      }
      if (body.errorCode) throw new Error(`솔라피 발송 실패: ${body.errorMessage || body.errorCode}`);
      // 접수 단계에서 걸러진 건은 HTTP 200으로 failedMessageList에 담겨 옴
      const failed = body.failedMessageList?.[0];
      if (failed) throw new Error(`솔라피 발송 실패: ${failed.statusMessage || failed.statusCode || '사유 미상'}`);
    },
  };
}

// SMS_PROVIDER: console(기본, 실제 발송 없음) | solapi
function createNotifier({
  provider = process.env.SMS_PROVIDER || 'console',
  apiKey = process.env.SOLAPI_API_KEY,
  apiSecret = process.env.SOLAPI_API_SECRET,
  sender = process.env.SOLAPI_SENDER,
  baseUrl = process.env.SOLAPI_API_URL || 'https://api.solapi.com',
  fetchImpl = fetch,
  now = () => new Date(),
  randomSalt = randomSaltDefault,
  log = console.log,
} = {}) {
  if (provider === 'console') return createConsoleNotifier(log);
  if (provider === 'solapi') {
    return createSolapiNotifier({ apiKey, apiSecret, sender, baseUrl, fetchImpl, now, randomSalt });
  }
  throw new Error('SMS_PROVIDER는 console 또는 solapi여야 합니다.');
}

module.exports = { createNotifier, DOMESTIC_MOBILE };
