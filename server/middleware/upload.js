const crypto = require('node:crypto');
const path = require('node:path');
const multer = require('multer');
const { maxUploadBytes, uploadsDir } = require('../config');

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, callback) => {
    callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  },
});

module.exports = multer({
  storage,
  limits: {
    fileSize: maxUploadBytes,
    files: 1,
    fields: 5,
    fieldSize: 16 * 1024,
    parts: 6,
  },
  fileFilter: (req, file, callback) => {
    if (file.originalname.length > 255) {
      callback(new Error('Video file name must be 255 characters or fewer.'));
      return;
    }
    if (!file.mimetype.startsWith('video/')) {
      callback(new Error('Choose a valid video file.'));
      return;
    }
    callback(null, true);
  },
});
