const fs = require('node:fs');
const mongoose = require('mongoose');
const Video = require('../models/Video');
const { createMediaToken, verifyMediaToken } = require('../services/auth');
const { enqueueJob } = require('../services/backgroundJobs');
const videoResponse = require('../utils/videoResponse');
const { validId } = require('../utils/validation');

async function listVideos(req, res, next) {
  try {
    const videos = await Video.find({ ownerId: req.userId }).sort({ createdAt: -1 });
    res.json({ videos: videos.map(videoResponse) });
  } catch (error) {
    next(error);
  }
}

async function uploadVideo(req, res, next) {
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
    fs.unlink(req.file.path, (unlinkError) => {
      if (unlinkError) console.error('Could not remove unrecorded upload:', unlinkError);
    });
    next(error);
  }
}

async function getVideo(req, res, next) {
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
}

async function playbackUrl(req, res, next) {
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
}

async function streamVideo(req, res, next) {
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
}

module.exports = { getVideo, listVideos, playbackUrl, streamVideo, uploadVideo };
