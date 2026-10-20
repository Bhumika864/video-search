const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordSalt: { type: String, required: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('User', userSchema);
