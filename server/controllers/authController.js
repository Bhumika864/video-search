const crypto = require('node:crypto');
const User = require('../models/User');
const {
  createToken,
  hashPassword,
} = require('../services/auth');
const { validEmail } = require('../utils/validation');

async function register(req, res, next) {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password;
  if (!validEmail(email) || typeof password !== 'string' || password.length < 10 || password.length > 128) {
    res.status(400).json({ error: 'Enter a valid email and a password of 10–128 characters.' });
    return;
  }
  try {
    const credentials = await hashPassword(password);
    const user = await User.create({
      email,
      passwordSalt: credentials.salt,
      passwordHash: credentials.hash,
    });
    res.status(201).json({ token: createToken(user.id), user: { id: user.id, email: user.email } });
  } catch (error) {
    if (error.code === 11000) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    next(error);
  }
}

async function login(req, res, next) {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password;
  if (typeof password !== 'string') {
    res.status(400).json({ error: 'Enter your email and password.' });
    return;
  }
  try {
    const user = await User.findOne({ email });
    if (!user || password.length > 128) {
      await hashPassword(password.slice(0, 128), 'video-search-login-timing-salt');
      res.status(401).json({ error: 'Email or password is incorrect.' });
      return;
    }
    if (
      typeof user.passwordSalt !== 'string' ||
      !user.passwordSalt ||
      typeof user.passwordHash !== 'string' ||
      !/^[a-f\d]{128}$/i.test(user.passwordHash)
    ) {
      await hashPassword(password, 'video-search-login-timing-salt');
      res.status(401).json({ error: 'Email or password is incorrect.' });
      return;
    }
    const credentials = await hashPassword(password, user.passwordSalt);
    const expectedHash = Buffer.from(user.passwordHash, 'hex');
    const actualHash = Buffer.from(credentials.hash, 'hex');
    if (expectedHash.length !== actualHash.length || !crypto.timingSafeEqual(expectedHash, actualHash)) {
      res.status(401).json({ error: 'Email or password is incorrect.' });
      return;
    }
    res.json({ token: createToken(user.id), user: { id: user.id, email: user.email } });
  } catch (error) {
    next(error);
  }
}

async function currentUser(req, res, next) {
  try {
    const user = await User.findById(req.userId).select('email');
    if (!user) {
      res.status(401).json({ error: 'Account no longer exists. Please sign in again.' });
      return;
    }
    res.json({ id: user.id, email: user.email });
  } catch (error) {
    next(error);
  }
}

module.exports = { currentUser, login, register };
