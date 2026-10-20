require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const Video = require('./models/Video');
const User = require('./models/User');
const TranscriptSegment = require('./models/TranscriptSegment');
const BackgroundJob = require('./models/BackgroundJob');
const { transcribe } = require('./services/transcription');
const { embedTexts } = require('./services/embeddings');
const { keywordSearch, semanticSearch } = require('./services/search');
const {
  createMediaToken,
  createToken,
  getTokenSecret,
  hashPassword,
  verifyMediaToken,
  verifyToken,
} = require('./services/auth');

const app = express();
const PORT = process.env.PORT || 5000;
const uploadsDir = path.join(__dirname, 'uploads');
const configuredUploadBytes = process.env.MAX_UPLOAD_BYTES === undefined
  ? 2 * 1024 * 1024 * 1024
  : Number(process.env.MAX_UPLOAD_BYTES);
if (!Number.isSafeInteger(configuredUploadBytes) || configuredUploadBytes <= 0) {
  throw new Error('MAX_UPLOAD_BYTES must be a positive safe integer.');
}
const maxUploadBytes = configuredUploadBytes;
const vectorSearchIndex = process.env.VECTOR_SEARCH_INDEX || 'transcript_vector_index';
const workerId = `${process.pid}-${crypto.randomUUID()}`;
const jobLeaseMs = 2 * 60 * 1000;
let stopWorker = false;

fs.mkdirSync(uploadsDir, { recursive: true });
app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
}));
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1200,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many requests. Please try again later.' }),
}));
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ error: 'Request body must be a JSON object.' });
    return;
  }
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many sign-in attempts. Please wait and try again.' }),
});
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Upload limit reached. Please try again later.' }),
});
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Search limit reached. Please wait a moment.' }),
});

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, callback) => {
    callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const upload = multer({
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

function validId(id) {
  return mongoose.isValidObjectId(id);
}

function videoResponse(video) {
  return {
    id: video.id,
    originalName: video.originalName,
    status: video.status,
    error: video.error,
    embeddingStatus: video.embeddingStatus,
    embeddingError: video.embeddingError,
    fileUrl: `/api/videos/${video.id}/file`,
    notes: video.notes.map((note) => ({
      id: note.id,
      text: note.text,
      timestamp: note.timestamp,
    })),
  };
}

function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const userId = verifyToken(token);
  if (!userId || !mongoose.isValidObjectId(userId)) {
    res.status(401).json({ error: 'Please sign in to continue.' });
    return;
  }
  req.userId = userId;
  next();
}

function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password;
  if (!validEmail(email) || typeof password !== 'string' || password.length < 10 || password.length > 128) {
    res.status(400).json({ error: 'Enter a valid email and a password of 10–128 characters.' });
    return;
  }
  try {
    const credentials = await hashPassword(password);
    const user = await User.create({
      email,
      passwordSalt: credentials.salt,
      passwordHash: credentials.hash,
    });
    res.status(201).json({ token: createToken(user.id), user: { id: user.id, email: user.email } });
  } catch (error) {
    if (error.code === 11000) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    next(error);
  }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password;
  if (typeof password !== 'string') {
    res.status(400).json({ error: 'Enter your email and password.' });
    return;
  }
  try {
    const user = await User.findOne({ email });
    if (!user || password.length > 128) {
      await hashPassword(password.slice(0, 128), 'video-search-login-timing-salt');
      res.status(401).json({ error: 'Email or password is incorrect.' });
      return;
    }
    if (
      typeof user.passwordSalt !== 'string' ||
      !user.passwordSalt ||
      typeof user.passwordHash !== 'string' ||
      !/^[a-f\d]{128}$/i.test(user.passwordHash)
    ) {
      await hashPassword(password, 'video-search-login-timing-salt');
      res.status(401).json({ error: 'Email or password is incorrect.' });
      return;
    }
    const credentials = await hashPassword(password, user.passwordSalt);
    const expectedHash = Buffer.from(user.passwordHash, 'hex');
    const actualHash = Buffer.from(credentials.hash, 'hex');
    if (expectedHash.length !== actualHash.length || !crypto.timingSafeEqual(expectedHash, actualHash)) {
      res.status(401).json({ error: 'Email or password is incorrect.' });
      return;
    }
    res.json({ token: createToken(user.id), user: { id: user.id, email: user.email } });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select('email');
    if (!user) {
      res.status(401).json({ error: 'Account no longer exists. Please sign in again.' });
      return;
    }
    res.json({ id: user.id, email: user.email });
  } catch (error) {
    next(error);
  }
});

app.get('/api/videos/:id/file', async (req, res, next) => {
  if (!validId(req.params.id)) {
    res.status(400).json({ error: 'Invalid video ID.' });
    return;
  }
  const ownerId = verifyMediaToken(req.query.access, req.params.id);
  if (!ownerId || !mongoose.isValidObjectId(ownerId)) {
    res.status(401).json({ error: 'Playback link is invalid or expired. Reopen this video from your library.' });
    return;
  }
  try {
    const video = await Video.findOne({ _id: req.params.id, ownerId });
    if (!video) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }
    res.set('Cache-Control', 'private, no-store').type(video.mimeType).sendFile(video.filePath, (error) => {
      if (error) next(error);
    });
  } catch (error) {
    next(error);
  }
});

app.use('/api/videos', requireAuth);

async function enqueueJob(videoId, ownerId, type, retry = false) {
  let existing = await BackgroundJob.findOne({ videoId, type });
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

async function claimJob() {
  const now = new Date();
  return BackgroundJob.findOneAndUpdate(
    {
      $or: [
        { status: 'queued', nextRunAt: { $lte: now } },
        {
          status: 'processing',
          $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: null }],
        },
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
      if (job) {
        await processClaimedJob(job);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error('Background worker could not claim a job:', error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

app.get('/api/videos', async (req, res, next) => {
  try {
    const videos = await Video.find({ ownerId: req.userId }).sort({ createdAt: -1 });
    res.json({ videos: videos.map(videoResponse) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/videos', uploadLimiter, upload.single('video'), async (req, res, next) => {
  if (!req.file) {
    res.status(400).json({ error: 'Choose a video file to upload.' });
    return;
  }
  let video;
  try {
    video = await Video.create({
      originalName: req.file.originalname,
      fileName: req.file.filename,
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      size: req.file.size,
      ownerId: req.userId,
    });
    await enqueueJob(video.id, video.ownerId, 'transcription');
    res.status(202).json(videoResponse(video));
  } catch (error) {
    if (video) {
      await Video.deleteOne({ _id: video._id }).catch((deleteError) => {
        console.error('Could not remove video record after queuing failed:', deleteError);
      });
    }
    if (req.file) {
      fs.unlink(req.file.path, (unlinkError) => {
        if (unlinkError) console.error('Could not remove unrecorded upload:', unlinkError);
      });
    }
    next(error);
  }
});

app.get('/api/videos/:id', async (req, res, next) => {
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
    res.json(videoResponse(video));
  } catch (error) {
    next(error);
  }
});

app.get('/api/videos/:id/playback', async (req, res, next) => {
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
    const access = createMediaToken(req.userId, video.id);
    res.set('Cache-Control', 'no-store')
      .json({ fileUrl: `/api/videos/${video.id}/file?access=${encodeURIComponent(access)}` });
  } catch (error) {
    next(error);
  }
});

app.get('/api/videos/:id/search', searchLimiter, async (req, res, next) => {
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
});

app.post('/api/videos/:id/semantic-index', async (req, res, next) => {
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
});

app.post('/api/videos/:id/notes', async (req, res, next) => {
  if (!validId(req.params.id)) {
    res.status(400).json({ error: 'Invalid video ID.' });
    return;
  }
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  const timestamp = req.body.timestamp;
  if (
    !text ||
    text.length > 1000 ||
    typeof timestamp !== 'number' ||
    !Number.isFinite(timestamp) ||
    timestamp < 0
  ) {
    res.status(400).json({ error: 'Enter a note (up to 1000 characters) and a valid timestamp.' });
    return;
  }
  try {
    const video = await Video.findOne({ _id: req.params.id, ownerId: req.userId });
    if (!video) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }
    video.notes.push({ text, timestamp });
    await video.save();
    res.status(201).json({
      note: videoResponse(video).notes.at(-1),
    });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/videos/:id/notes/:noteId', async (req, res, next) => {
  if (!validId(req.params.id) || !validId(req.params.noteId)) {
    res.status(400).json({ error: 'Invalid video or note ID.' });
    return;
  }
  try {
    const video = await Video.findOne({ _id: req.params.id, ownerId: req.userId });
    if (!video) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }
    const note = video.notes.id(req.params.noteId);
    if (!note) {
      res.status(404).json({ error: 'Note not found.' });
      return;
    }
    note.deleteOne();
    await video.save();
    res.json({ notes: videoResponse(video).notes });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
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
});

async function start() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured.');
  getTokenSecret();
  await mongoose.connect(process.env.MONGODB_URI);
  await BackgroundJob.init();

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

  const httpServer = app.listen(PORT, () => {
    console.log(`JumpToThis API listening on port ${PORT}`);
  });
  const workerPromise = runWorker();
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopWorker = true;
    const closeHttpServer = new Promise((resolve) => httpServer.close(resolve));
    await workerPromise;
    await closeHttpServer;
    await mongoose.disconnect();
  };
  process.once('SIGINT', () => shutdown().catch((error) => {
    console.error('Could not shut down cleanly:', error);
    process.exitCode = 1;
  }));
  process.once('SIGTERM', () => shutdown().catch((error) => {
    console.error('Could not shut down cleanly:', error);
    process.exitCode = 1;
  }));
}

start().catch((error) => {
  console.error('Could not start JumpToThis API:', error);
  process.exitCode = 1;
});
