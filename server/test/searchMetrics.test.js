const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateQuery, summarizeMetrics } = require('../services/searchMetrics');

test('evaluates one-to-one relevance within timestamp tolerance', () => {
  const metrics = evaluateQuery(
    [{ start: 10.5 }, { start: 11 }, { start: 40 }],
    [10, 40],
    1,
    3,
  );
  assert.equal(metrics.recall, 1);
  assert.equal(metrics.reciprocalRank, 1);
  assert.ok(metrics.ndcg > 0.9 && metrics.ndcg < 1);
});

test('returns zero for queries with no relevant result', () => {
  assert.deepEqual(
    evaluateQuery([{ start: 100 }], [10], 2),
    { recall: 0, reciprocalRank: 0, ndcg: 0 },
  );
});

test('averages metrics across benchmark queries', () => {
  assert.deepEqual(
    summarizeMetrics([
      { recall: 1, reciprocalRank: 1, ndcg: 1 },
      { recall: 0, reciprocalRank: 0, ndcg: 0 },
    ]),
    { recall: 0.5, reciprocalRank: 0.5, ndcg: 0.5 },
  );
});
