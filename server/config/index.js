const path = require('node:path');

const configuredUploadBytes = process.env.MAX_UPLOAD_BYTES === undefined
  ? 2 * 1024 * 1024 * 1024
  : Number(process.env.MAX_UPLOAD_BYTES);

if (!Number.isSafeInteger(configuredUploadBytes) || configuredUploadBytes <= 0) {
  throw new Error('MAX_UPLOAD_BYTES must be a positive safe integer.');
}

module.exports = {
  port: process.env.PORT || 5000,
  uploadsDir: path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads')),
  maxUploadBytes: configuredUploadBytes,
  vectorSearchIndex: process.env.VECTOR_SEARCH_INDEX || 'transcript_vector_index',
  jobLeaseMs: 2 * 60 * 1000,
};
