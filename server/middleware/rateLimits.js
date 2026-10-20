const { rateLimit } = require('express-rate-limit');

function limiter(windowMs, limit, message) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: message }),
  });
}

module.exports = {
  apiLimiter: limiter(15 * 60 * 1000, 1200, 'Too many requests. Please try again later.'),
  authLimiter: limiter(15 * 60 * 1000, 10, 'Too many sign-in attempts. Please wait and try again.'),
  uploadLimiter: limiter(60 * 60 * 1000, 5, 'Upload limit reached. Please try again later.'),
  searchLimiter: limiter(60 * 1000, 30, 'Search limit reached. Please wait a moment.'),
};
