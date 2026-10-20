const mongoose = require('mongoose');

function validId(id) {
  return mongoose.isValidObjectId(id);
}

function validEmail(email) {
  return typeof email === 'string' &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = { validEmail, validId };
