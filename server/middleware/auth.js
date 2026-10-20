const mongoose = require('mongoose');
const { verifyToken } = require('../services/auth');

function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const userId = verifyToken(token);
  if (!userId || !mongoose.isValidObjectId(userId)) {
    res.status(401).json({ error: 'Please sign in to continue.' });
    return;
  }
  req.userId = userId;
  next();
}

module.exports = requireAuth;
