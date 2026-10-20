const express = require('express');
const { currentUser, login, register } = require('../controllers/authController');
const requireAuth = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimits');

const router = express.Router();

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.get('/me', requireAuth, currentUser);

module.exports = router;
