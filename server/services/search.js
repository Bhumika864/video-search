const mongoose = require('mongoose');
const TranscriptSegment = require('../models/TranscriptSegment');
const { embedTexts } = require('./embeddings');

const ignoredWords = new Set([
  'about', 'after', 'again', 'and', 'are', 'for', 'from', 'have', 'her', 'his',
  'how', 'into', 'is', 'its', 'that', 'the', 'their', 'them', 'there', 'these',
  'they', 'this', 'those', 'what', 'when', 'where', 'which', 'who', 'why', 'with',
  'would', 'you', 'your',
]);

function rankSemanticResults(query, results, limit = 10) {
  const queryWords = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])]
    .filter((word) => word.length > 2 && !ignoredWords.has(word));

  return results
    .map((result) => {
      const segmentWords = new Set(result.text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
      const overlap = queryWords.filter((word) => segmentWords.has(word)).length;
      return { result, rank: result.score + overlap * 0.03 };
    })
    .sort((a, b) => b.rank - a.rank || b.result.score - a.result.score)
    .slice(0, limit)
    .map(({ result }) => {
      const { score, ...segment } = result;
      return segment;
    });
}

function keywordSearch(video, query, wholeWord = false) {
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = wholeWord
    ? `(?<![\\p{L}\\p{N}_])${escapedQuery}(?![\\p{L}\\p{N}_])`
    : escapedQuery;
  return video.transcript.filter((segment) =>
    new RegExp(pattern, 'iu').test(segment.text),
  );
}

async function semanticSearch(video, ownerId, query, indexName, limit = 10) {
  const [queryEmbedding] = await embedTexts([query]);
  const candidates = await TranscriptSegment.aggregate([
    {
      $vectorSearch: {
        index: indexName,
        path: 'embedding',
        queryVector: queryEmbedding,
        numCandidates: Math.max(limit * 40, 400),
        limit: Math.max(limit * 2, 20),
        filter: {
          ownerId: new mongoose.Types.ObjectId(ownerId),
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
  return rankSemanticResults(query, candidates, limit);
}

module.exports = { keywordSearch, rankSemanticResults, semanticSearch };
