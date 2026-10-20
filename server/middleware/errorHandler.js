const multer = require('multer');
const { maxUploadBytes } = require('../config');

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: `Video exceeds the ${maxUploadBytes} byte upload limit.` });
    return;
  }
  if (
    error instanceof multer.MulterError ||
    error.message === 'Choose a valid video file.' ||
    error.message === 'Choose a video file to upload.' ||
    error.message === 'Video file name must be 255 characters or fewer.'
  ) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error.status === 400 && error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body must contain valid JSON.' });
    return;
  }
  if (error.status === 413 && error.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large.' });
    return;
  }
  if (error.code === 31082 || error.codeName === 'SearchNotEnabled') {
    res.status(503).json({
      error: 'Semantic search requires MongoDB Atlas or an AtlasCLI local deployment. Your current MongoDB server does not support Vector Search. Connect to Atlas, create the transcript vector index, and try again. Keyword search is still available.',
    });
    return;
  }
  console.error('Request failed:', error);
  res.status(500).json({ error: 'The server could not complete the request.' });
}

module.exports = errorHandler;
