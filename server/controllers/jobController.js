const Video = require('../models/Video');
const { enqueueJob } = require('../services/backgroundJobs');
const { validId } = require('../utils/validation');

async function reindexVideo(req, res, next) {
  if (!validId(req.params.id)) {
    res.status(400).json({ error: 'Invalid video ID.' });
    return;
  }
  try {
    const video = await Video.findOne({ _id: req.params.id, ownerId: req.userId });
    if (!video) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }
    if (video.status !== 'completed') {
      res.status(409).json({ error: 'Transcription must finish before semantic indexing.' });
      return;
    }
    const job = await enqueueJob(video.id, video.ownerId, 'indexing', true);
    if (job.status === 'processing') {
      res.status(409).json({ error: 'Semantic indexing is already in progress.' });
      return;
    }
    video.embeddingStatus = 'processing';
    video.embeddingError = '';
    await video.save();
    res.status(202).json({ embeddingStatus: 'processing' });
  } catch (error) {
    next(error);
  }
}

module.exports = { reindexVideo };
