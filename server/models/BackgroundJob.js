const mongoose = require('mongoose');

const backgroundJobSchema = new mongoose.Schema(
  {
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['transcription', 'indexing'], required: true },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
      default: 'queued',
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    nextRunAt: { type: Date, default: Date.now },
    lockedUntil: { type: Date, default: null },
    workerId: { type: String, default: '' },
    providerJobId: { type: String, default: '' },
    lastError: { type: String, default: '' },
  },
  { timestamps: true },
);

backgroundJobSchema.index({ videoId: 1, type: 1 }, { unique: true });
backgroundJobSchema.index({ status: 1, nextRunAt: 1, lockedUntil: 1, createdAt: 1 });

module.exports = mongoose.model('BackgroundJob', backgroundJobSchema);
