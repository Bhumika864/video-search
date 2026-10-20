const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Video = require('../models/Video');
const { keywordSearch, semanticSearch } = require('../services/search');
const { evaluateQuery, summarizeMetrics } = require('../services/searchMetrics');

const vectorSearchIndex = process.env.VECTOR_SEARCH_INDEX || 'transcript_vector_index';

function printUsage() {
  console.log('Usage: npm run evaluate-search -- <benchmark.json> [--mode keyword|semantic|both]');
  console.log('       npm run evaluate-search -- --list-videos');
}

async function listVideos() {
  const videos = await Video.find({}, 'originalName status embeddingStatus ownerId')
    .sort({ createdAt: -1 })
    .lean();
  console.table(videos.map((video) => ({
    videoId: String(video._id),
    ownerId: String(video.ownerId),
    name: video.originalName,
    transcription: video.status,
    semanticIndex: video.embeddingStatus,
  })));
}

function validateBenchmark(benchmark) {
  if (!Array.isArray(benchmark.queries) || benchmark.queries.length === 0) {
    throw new Error('Benchmark JSON needs at least one labeled query.');
  }
  const tolerance = benchmark.toleranceSeconds ?? 3;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error('toleranceSeconds must be a non-negative number.');
  }
  for (const [index, query] of benchmark.queries.entries()) {
    if (
      typeof query.videoId !== 'string' ||
      !mongoose.isValidObjectId(query.videoId) ||
      typeof query.query !== 'string' ||
      !query.query.trim() ||
      !Array.isArray(query.relevantStarts) ||
      query.relevantStarts.length === 0 ||
      query.relevantStarts.some((start) => !Number.isFinite(start) || start < 0)
    ) {
      throw new Error(`Benchmark query ${index + 1} needs a valid videoId, query, and relevantStarts array.`);
    }
  }
}

async function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length === 0) {
    printUsage();
    return;
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured in server/.env.');
  await mongoose.connect(process.env.MONGODB_URI);

  if (args[0] === '--list-videos') {
    await listVideos();
    return;
  }

  const modeIndex = args.indexOf('--mode');
  const mode = modeIndex === -1 ? 'both' : args[modeIndex + 1];
  if (!['keyword', 'semantic', 'both'].includes(mode)) {
    throw new Error('Mode must be keyword, semantic, or both.');
  }
  const fileName = args[0];
  if (fileName.startsWith('--')) throw new Error('Provide a benchmark JSON file.');
  const benchmarkPath = path.resolve(process.cwd(), fileName);
  const benchmark = JSON.parse(await fs.readFile(benchmarkPath, 'utf8'));
  validateBenchmark(benchmark);
  const modes = mode === 'both' ? ['keyword', 'semantic'] : [mode];
  const rows = Object.fromEntries(modes.map((item) => [item, []]));

  for (const item of benchmark.queries) {
    const video = await Video.findById(item.videoId);
    if (!video) throw new Error(`Video ${item.videoId} was not found in the configured database.`);
    if (video.status !== 'completed') throw new Error(`Video ${item.videoId} has no completed transcript.`);
    for (const searchMode of modes) {
      if (searchMode === 'semantic' && video.embeddingStatus !== 'completed') {
        throw new Error(`Video ${item.videoId} is not semantically indexed.`);
      }
      const results = searchMode === 'keyword'
        ? keywordSearch(video, item.query.trim(), item.wholeWord === true)
        : await semanticSearch(video, video.ownerId, item.query.trim(), vectorSearchIndex);
      const row = {
        ...evaluateQuery(results, item.relevantStarts, benchmark.toleranceSeconds ?? 3, 10),
        recallAt5: evaluateQuery(results, item.relevantStarts, benchmark.toleranceSeconds ?? 3, 5).recall,
        query: item.query,
      };
      rows[searchMode].push(row);
    }
  }

  const report = Object.fromEntries(Object.entries(rows).map(([searchMode, values]) => [
    searchMode,
    {
      queryCount: values.length,
      recallAt5: summarizeMetrics(values.map((row) => ({ recall: row.recallAt5, reciprocalRank: 0, ndcg: 0 }))).recall,
      recallAt10: summarizeMetrics(values).recall,
      mrrAt10: summarizeMetrics(values).reciprocalRank,
      ndcgAt10: summarizeMetrics(values).ndcg,
    },
  ]));
  console.log(JSON.stringify(report, null, 2));
}

run()
  .catch((error) => {
    console.error(`Search evaluation failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
