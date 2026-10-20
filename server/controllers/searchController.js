const Video = require('../models/Video');
const { keywordSearch, semanticSearch } = require('../services/search');
const { vectorSearchIndex } = require('../config');
const { validId } = require('../utils/validation');

async function searchVideo(req, res, next) {
  if (!validId(req.params.id)) {
    res.status(400).json({ error: 'Invalid video ID.' });
    return;
  }
  const query = String(req.query.q || '').trim();
  if (!query) {
    res.status(400).json({ error: 'Enter a word or phrase to search.' });
    return;
  }
  if (query.length > 300) {
    res.status(400).json({ error: 'Search text must be 300 characters or fewer.' });
    return;
  }

  try {
    const video = await Video.findOne({ _id: req.params.id, ownerId: req.userId });
    if (!video) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }
    if (video.status !== 'completed') {
      res.status(409).json({ error: 'This video is not ready to search.' });
      return;
    }
    if (req.query.mode === 'semantic') {
      if (video.embeddingStatus !== 'completed') {
        res.status(409).json({
          error: video.embeddingStatus === 'failed'
            ? `Semantic indexing failed: ${video.embeddingError}`
            : 'Semantic search is still being prepared for this video.',
        });
        return;
      }
      res.json({ results: await semanticSearch(video, req.userId, query, vectorSearchIndex) });
      return;
    }
    res.json({ results: keywordSearch(video, query, req.query.wholeWord === 'true') });
  } catch (error) {
    next(error);
  }
}

module.exports = { searchVideo };
