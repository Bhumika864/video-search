const crypto = require('node:crypto');
const BackgroundJob = require('../models/BackgroundJob');
const Video = require('../models/Video');
const TranscriptSegment = require('../models/TranscriptSegment');
const { jobLeaseMs } = require('../config');
const { embedTexts } = require('../services/embeddings');
const { enqueueJob } = require('../services/backgroundJobs');
const { transcribe } = require('../services/transcription');

const workerId = `${process.pid}-${crypto.randomUUID()}`;
let stopWorker = false;

async function claimJob() {
  const now = new Date();
  return BackgroundJob.findOneAndUpdate(
    {
      $or: [
        { status: 'queued', nextRunAt: { $lte: now } },
        { status: 'processing', $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: null }] },
      ],
    },
    {
      $set: { status: 'processing', workerId, lockedUntil: new Date(now.getTime() + jobLeaseMs) },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, new: true },
  );
}

async function runJob(job) {
  const video = await Video.findOne({ _id: job.videoId, ownerId: job.ownerId });
  if (!video) throw new Error('The video for this background job no longer exists.');

  if (job.type === 'transcription') {
    if (video.status !== 'completed' || !video.transcript.length) {
      video.status = 'processing';
      await video.save();
      video.transcript = await transcribe(video.filePath, {
        providerJobId: job.providerJobId,
        onJobCreated: async (providerJobId) => {
          const updated = await BackgroundJob.updateOne(
            { _id: job._id, workerId },
            { $set: { providerJobId, lockedUntil: new Date(Date.now() + jobLeaseMs) } },
          );
          if (!updated.modifiedCount) throw new Error('The transcription job lease was lost.');
          job.providerJobId = providerJobId;
        },
      });
      video.status = 'completed';
      video.error = '';
      await video.save();
    }
    await enqueueJob(video.id, video.ownerId, 'indexing');
    return;
  }

  if (video.embeddingStatus === 'completed') return;
  if (video.status !== 'completed') throw new Error('Transcription must complete before indexing.');
  video.embeddingStatus = 'processing';
  video.embeddingError = '';
  await video.save();

  const embeddings = await embedTexts(video.transcript.map((segment) => segment.text));
  if (
    embeddings.length !== video.transcript.length ||
    embeddings.some((vector) => vector.length !== 384 || vector.some((value) => !Number.isFinite(value)))
  ) {
    throw new Error('The local embedding model returned an unexpected vector.');
  }
  await TranscriptSegment.deleteMany({ videoId: video._id, ownerId: video.ownerId });
  await TranscriptSegment.insertMany(video.transcript.map((segment, index) => ({
    videoId: video._id,
    ownerId: video.ownerId,
    text: segment.text,
    start: segment.start,
    end: segment.end,
    embedding: embeddings[index],
  })));
  video.embeddingStatus = 'completed';
  video.embeddingError = '';
  await video.save();
}

async function processClaimedJob(job) {
  const heartbeat = setInterval(() => {
    BackgroundJob.updateOne(
      { _id: job._id, workerId },
      { $set: { lockedUntil: new Date(Date.now() + jobLeaseMs) } },
    ).catch((error) => console.error(`Could not renew background job ${job.id}:`, error));
  }, Math.floor(jobLeaseMs / 3));

  try {
    await runJob(job);
    await BackgroundJob.updateOne(
      { _id: job._id, workerId },
      { $set: { status: 'completed', lockedUntil: null, workerId: '', lastError: '' } },
    );
  } catch (error) {
    const terminalFailure = error.retryable === false || job.attempts >= job.maxAttempts;
    const retryDelay = Math.min(60_000 * (2 ** Math.max(job.attempts - 1, 0)), 15 * 60_000);
    await BackgroundJob.updateOne(
      { _id: job._id, workerId },
      {
        $set: {
          status: terminalFailure ? 'failed' : 'queued',
          nextRunAt: new Date(Date.now() + retryDelay),
          lockedUntil: null,
          workerId: '',
          lastError: String(error.message || 'Background job failed').slice(0, 1000),
          ...(job.type === 'transcription' && error.retryable === false ? { providerJobId: '' } : {}),
        },
      },
    );
    console.error(`Background ${job.type} job ${job.id} failed${terminalFailure ? ' permanently' : '; it will retry'}:`, error);

    if (terminalFailure) {
      const video = await Video.findOne({ _id: job.videoId, ownerId: job.ownerId });
      if (video && job.type === 'transcription') {
        video.status = 'failed';
        video.error = String(error.message || 'Transcription failed').slice(0, 1000);
        await video.save();
      } else if (video && job.type === 'indexing') {
        video.embeddingStatus = 'failed';
        video.embeddingError = String(error.message || 'Semantic indexing failed').slice(0, 1000);
        await video.save();
      }
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function runWorker() {
  while (!stopWorker) {
    try {
      const job = await claimJob();
      if (job) await processClaimedJob(job);
      else await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error('Background worker could not claim a job:', error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function recoverJobs() {
  const recoverableVideos = await Video.find({
    $or: [
      { status: { $in: ['queued', 'processing'] } },
      { status: 'completed', embeddingStatus: 'processing' },
    ],
  }).select('_id ownerId status').lean();
  for (const video of recoverableVideos) {
    const type = video.status === 'completed' ? 'indexing' : 'transcription';
    await enqueueJob(video._id, video.ownerId, type);
  }
}

function startWorker() {
  stopWorker = false;
  return runWorker();
}

function stop() {
  stopWorker = true;
}

module.exports = { recoverJobs, startWorker, stop };
