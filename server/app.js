const fs = require('node:fs');
const express = require('express');
const helmet = require('helmet');
const { uploadsDir } = require('./config');
const errorHandler = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimits');
const authRoutes = require('./routes/authRoutes');
const videoRoutes = require('./routes/videoRoutes');

fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();

app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
}));
app.use('/api', apiLimiter);
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ error: 'Request body must be a JSON object.' });
    return;
  }
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use(errorHandler);

module.exports = app;
