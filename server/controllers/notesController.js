const Video = require('../models/Video');
const videoResponse = require('../utils/videoResponse');
const { validId } = require('../utils/validation');

async function addNote(req, res, next) {
  if (!validId(req.params.id)) {
    res.status(400).json({ error: 'Invalid video ID.' });
    return;
  }
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  const timestamp = req.body.timestamp;
  if (!text || text.length > 1000 || typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) {
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
    res.status(201).json({ note: videoResponse(video).notes.at(-1) });
  } catch (error) {
    next(error);
  }
}

async function deleteNote(req, res, next) {
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
}

module.exports = { addNote, deleteNote };
