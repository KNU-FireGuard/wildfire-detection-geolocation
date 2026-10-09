const { scrypt } = require('node:crypto');
const { promisify } = require('node:util');

const deriveKey = promisify(scrypt);
const MAX_SCRYPT_COST = 131072;

async function verifyPassword(password, encodedHash) {
  if (typeof password !== 'string' || typeof encodedHash !== 'string') return false;

  const [algorithm, costText, blockSizeText, parallelismText, saltHex, hashHex, ...extra] = encodedHash.split('$');
  const cost = Number(costText);
  const blockSize = Number(blockSizeText);
  const parallelism = Number(parallelismText);
  if (
    extra.length > 0
    || algorithm !== 'scrypt'
    || !Number.isInteger(cost)
    || cost < 1024
    || cost > MAX_SCRYPT_COST
    || (cost & (cost - 1)) !== 0
    || !Number.isInteger(blockSize)
    || blockSize < 1
    || blockSize > 32
    || !Number.isInteger(parallelism)
    || parallelism < 1
    || parallelism > 16
    || !/^[a-f\d]{32}$/i.test(saltHex || '')
    || !/^[a-f\d]{128}$/i.test(hashHex || '')
  ) {
    return false;
  }

  const expected = Buffer.from(hashHex, 'hex');
  try {
    const actual = await deriveKey(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: cost,
      r: blockSize,
      p: parallelism,
      maxmem: 256 * 1024 * 1024,
    });
    return actual.length === expected.length && require('node:crypto').timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

module.exports = { verifyPassword };
