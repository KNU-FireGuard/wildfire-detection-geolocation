const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getAiCallbackToken } = require('../src/middleware/require-ai-callback');

test('AI_CALLBACK_TOKEN은 32바이트 이상이며 예시 placeholder가 아니어야 한다', () => {
  const original = process.env.AI_CALLBACK_TOKEN;
  try {
    for (const token of ['', 'short', 'replace_with_random_secret_at_least_32_characters']) {
      process.env.AI_CALLBACK_TOKEN = token;
      assert.throws(() => getAiCallbackToken(), /AI_CALLBACK_TOKEN/);
    }

    process.env.AI_CALLBACK_TOKEN = 'a'.repeat(31);
    assert.throws(() => getAiCallbackToken(), /AI_CALLBACK_TOKEN/);

    process.env.AI_CALLBACK_TOKEN = 'a'.repeat(32);
    assert.equal(getAiCallbackToken(), 'a'.repeat(32));
  } finally {
    if (original === undefined) delete process.env.AI_CALLBACK_TOKEN;
    else process.env.AI_CALLBACK_TOKEN = original;
  }
});
