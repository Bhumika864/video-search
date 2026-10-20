const BackgroundJob = require('../models/BackgroundJob');

async function enqueueJob(videoId, ownerId, type, retry = false) {
  const existing = await BackgroundJob.findOne({ videoId, type });
  if (existing) {
    if (['queued', 'processing'].includes(existing.status)) return existing;
    if (existing.status === 'completed' && !retry) return existing;
    existing.status = 'queued';
    existing.attempts = 0;
    existing.nextRunAt = new Date();
    existing.lockedUntil = null;
    existing.workerId = '';
    existing.providerJobId = '';
    existing.lastError = '';
    return existing.save();
  }

  try {
    return await BackgroundJob.create({ videoId, ownerId, type });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return BackgroundJob.findOne({ videoId, type });
  }
}

module.exports = { enqueueJob };
