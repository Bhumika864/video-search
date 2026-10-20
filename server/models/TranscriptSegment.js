const mongoose = require('mongoose');

const transcriptSegmentSchema = new mongoose.Schema(
  {
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    embedding: { type: [Number], required: true },
  },
  { timestamps: true },
);

transcriptSegmentSchema.index({ videoId: 1, ownerId: 1 });

module.exports = mongoose.model('TranscriptSegment', transcriptSegmentSchema);
