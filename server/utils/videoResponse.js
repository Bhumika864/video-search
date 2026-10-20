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

module.exports = videoResponse;
