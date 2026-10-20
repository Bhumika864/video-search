const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

function getTokenSecret() {
  const secret = process.env.AUTH_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_TOKEN_SECRET must contain at least 32 characters.');
  }
  return secret;
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: hash.toString('hex') };
}

function createToken(userId) {
  const payload = Buffer.from(JSON.stringify({
    userId,
    expiresAt: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', getTokenSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function createMediaToken(userId, videoId) {
  const payload = Buffer.from(JSON.stringify({
    userId,
    videoId,
    expiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', getTokenSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyMediaToken(token, videoId) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra) return '';
  const expected = crypto.createHmac('sha256', getTokenSecret()).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return '';

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (
      typeof data.userId !== 'string' ||
      data.videoId !== videoId ||
      data.expiresAt <= Math.floor(Date.now() / 1000)
    ) return '';
    return data.userId;
  } catch {
    return '';
  }
}

function verifyToken(token) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra) return '';
  const expected = crypto.createHmac('sha256', getTokenSecret()).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return '';
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return '';

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.userId !== 'string' || data.expiresAt <= Math.floor(Date.now() / 1000)) return '';
    return data.userId;
  } catch {
    return '';
  }
}

module.exports = {
  createMediaToken,
  createToken,
  getTokenSecret,
  hashPassword,
  verifyMediaToken,
  verifyToken,
};
