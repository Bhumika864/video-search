const express = require('express');
const {
  getVideo,
  listVideos,
  playbackUrl,
  streamVideo,
  uploadVideo,
} = require('../controllers/videoController');
const { deleteNote, addNote } = require('../controllers/notesController');
const { reindexVideo } = require('../controllers/jobController');
const { searchVideo } = require('../controllers/searchController');
const requireAuth = require('../middleware/auth');
const upload = require('../middleware/upload');
const { searchLimiter, uploadLimiter } = require('../middleware/rateLimits');

const router = express.Router();

router.get('/:id/file', streamVideo);
router.use(requireAuth);

router.get('/', listVideos);
router.post('/', uploadLimiter, upload.single('video'), uploadVideo);
router.get('/:id/search', searchLimiter, searchVideo);
router.post('/:id/semantic-index', reindexVideo);
router.post('/:id/notes', addNote);
router.delete('/:id/notes/:noteId', deleteNote);
router.get('/:id/playback', playbackUrl);
router.get('/:id', getVideo);

module.exports = router;
