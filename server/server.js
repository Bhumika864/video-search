require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const Video = require('./models/Video');
const User = require('./models/User');
const TranscriptSegment = require('./models/TranscriptSegment');
const { transcribe } = require('./services/transcription');
const { embedTexts } = require('./services/embeddings');
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
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES) || 2 * 1024 * 1024 * 1024;
const vectorSearchIndex = process.env.VECTOR_SEARCH_INDEX || 'transcript_vector_index';

fs.mkdirSync(uploadsDir, { recursive: true });
app.use(express.json({ limit: '16kb' }));

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, callback) => {
    callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: maxUploadBytes },
  fileFilter: (req, file, callback) => {
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

function rankSemanticResults(query, results) {
  const ignoredWords = new Set([
    'about', 'after', 'again', 'and', 'are', 'for', 'from', 'have', 'her', 'his',
    'how', 'into', 'is', 'its', 'that', 'the', 'their', 'them', 'there', 'these',
    'they', 'this', 'those', 'what', 'when', 'where', 'which', 'who', 'why', 'with',
    'would', 'you', 'your',
  ]);
  const queryWords = [...new Set(
    query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [],
  )].filter((word) => word.length > 2 && !ignoredWords.has(word));

  return results
    .map((result) => {
      const segmentWords = new Set(result.text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
      const overlap = queryWords.filter((word) => segmentWords.has(word)).length;
      return { result, rank: result.score + overlap * 0.03 };
    })
    .sort((a, b) => b.rank - a.rank || b.result.score - a.result.score)
    .slice(0, 10)
    .map(({ result }) => {
      const { score, ...segment } = result;
      return segment;
    });
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

app.post('/api/auth/register', async (req, res, next) => {
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

app.post('/api/auth/login', async (req, res, next) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password;
  if (typeof password !== 'string') {
    res.status(400).json({ error: 'Enter your email and password.' });
    return;
  }
  try {
    const user = await User.findOne({ email });
    if (!user || password.length > 128) {
      res.status(401).json({ error: 'Email or password is incorrect.' });
      return;
    }
    if (
      typeof user.passwordSalt !== 'string' ||
      !user.passwordSalt ||
      typeof user.passwordHash !== 'string' ||
      !/^[a-f\d]{128}$/i.test(user.passwordHash)
    ) {
      res.status(409).json({
        error: 'This account is missing valid password credentials. Remove the incomplete database user and register again.',
      });
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
    res.type(video.mimeType).sendFile(video.filePath, (error) => {
      if (error) next(error);
    });
  } catch (error) {
    next(error);
  }
});

app.use('/api/videos', requireAuth);

async function processVideo(videoId) {
  let video;
  try {
    video = await Video.findById(videoId);
    if (!video) throw new Error(`Video ${videoId} was not found.`);
    video.status = 'processing';
    await video.save();
    video.transcript = await transcribe(video.filePath);
    video.status = 'completed';
    video.error = '';
    await video.save();
  } catch (error) {
    console.error(`Transcription failed for video ${videoId}:`, error);
    if (video) {
      video.status = 'failed';
      video.error = error.message;
      await video.save();
    }
    return;
  }
  indexVideo(video.id, video.ownerId).catch((error) => {
    console.error(`Could not start semantic indexing for video ${video.id}:`, error);
  });
}

async function indexVideo(videoId, ownerId) {
  const video = await Video.findOneAndUpdate(
    { _id: videoId, ownerId, status: 'completed', embeddingStatus: { $ne: 'processing' } },
    { $set: { embeddingStatus: 'processing', embeddingError: '' } },
    { new: true },
  );
  if (!video) return;

  try {
    const embeddings = await embedTexts(video.transcript.map((segment) => segment.text));
    if (embeddings.length !== video.transcript.length || embeddings.some((vector) => vector.length !== 384)) {
      throw new Error('The local embedding model returned an unexpected vector size.');
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
    await video.save();
  } catch (error) {
    console.error(`Could not index transcript for video ${videoId}:`, error);
    video.embeddingStatus = 'failed';
    video.embeddingError = error.message;
    await video.save();
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

app.post('/api/videos', upload.single('video'), async (req, res, next) => {
  if (!req.file) {
    res.status(400).json({ error: 'Choose a video file to upload.' });
    return;
  }
  try {
    const video = await Video.create({
      originalName: req.file.originalname,
      fileName: req.file.filename,
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      size: req.file.size,
      ownerId: req.userId,
    });

    res.status(202).json(videoResponse(video));
    processVideo(video.id).catch((error) => {
      console.error(`Could not start transcription for video ${video.id}:`, error);
    });
  } catch (error) {
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
    res.json({ fileUrl: `/api/videos/${video.id}/file?access=${encodeURIComponent(access)}` });
  } catch (error) {
    next(error);
  }
});

app.get('/api/videos/:id/search', async (req, res, next) => {
  if (!validId(req.params.id)) {
    res.status(400).json({ error: 'Invalid video ID.' });
    return;
  }
  const query = String(req.query.q || '').trim();
  if (!query) {
    res.status(400).json({ error: 'Enter a word or phrase to search.' });
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
      const [queryEmbedding] = await embedTexts([query]);
      const results = await TranscriptSegment.aggregate([
        {
          $vectorSearch: {
            index: vectorSearchIndex,
            path: 'embedding',
            queryVector: queryEmbedding,
            numCandidates: 400,
            limit: 20,
            filter: {
              ownerId: new mongoose.Types.ObjectId(req.userId),
              videoId: video._id,
            },
          },
        },
        {
          $project: {
            _id: 0,
            text: 1,
            start: 1,
            end: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ]);
      res.json({ results: rankSemanticResults(query, results) });
      return;
    }
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wholeWord = req.query.wholeWord === 'true';
    const pattern = wholeWord
      ? `(?<![\\p{L}\\p{N}_])${escapedQuery}(?![\\p{L}\\p{N}_])`
      : escapedQuery;
    const matches = video.transcript.filter((segment) =>
      new RegExp(pattern, 'iu').test(segment.text),
    );
    res.json({ results: matches });
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
    if (video.embeddingStatus === 'processing') {
      res.status(409).json({ error: 'Semantic indexing is already in progress.' });
      return;
    }
    res.status(202).json({ embeddingStatus: 'processing' });
    indexVideo(video.id, video.ownerId).catch((error) => {
      console.error(`Could not start semantic indexing for video ${video.id}:`, error);
    });
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
    error.message === 'Choose a video file to upload.'
  ) {
    res.status(400).json({ error: error.message });
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
  app.listen(PORT, () => console.log(`JumpToThis API listening on port ${PORT}`));
}

start().catch((error) => {
  console.error('Could not start JumpToThis API:', error);
  process.exitCode = 1;
});
