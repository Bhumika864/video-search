const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    fileName: { type: String, default: '' },
    filePath: { type: String, default: '' },
    mimeType: { type: String, required: true },
    size: { type: Number, default: 0 },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
      default: 'queued',
    },
    error: { type: String, default: '' },
    transcript: [
      {
        text: { type: String, required: true },
        start: { type: Number, required: true },
        end: { type: Number, required: true },
      },
    ],
    notes: [
      {
        text: { type: String, required: true },
        timestamp: { type: Number, required: true, min: 0 },
      },
    ],
  },
  { timestamps: true },
);

module.exports = mongoose.model('Video', videoSchema);
