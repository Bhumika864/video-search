function evaluateQuery(results, relevantStarts, toleranceSeconds = 3, cutoff = 10) {
  if (!relevantStarts.length) throw new Error('Each benchmark query needs at least one relevant start time.');

  const topResults = results.slice(0, cutoff);
  const unmatchedStarts = new Set(relevantStarts);
  const relevance = topResults.map((result) => {
    const matchedStart = [...unmatchedStarts].find(
      (start) => Math.abs(result.start - start) <= toleranceSeconds,
    );
    if (matchedStart === undefined) return 0;
    unmatchedStarts.delete(matchedStart);
    return 1;
  });
  const hitCount = relevance.reduce((sum, isHit) => sum + isHit, 0);
  const firstRelevantIndex = relevance.indexOf(1);
  const dcg = relevance.reduce(
    (score, isHit, index) => score + (isHit ? 1 / Math.log2(index + 2) : 0),
    0,
  );
  const idealCount = Math.min(relevantStarts.length, cutoff);
  const idealDcg = Array.from(
    { length: idealCount },
    (_, index) => 1 / Math.log2(index + 2),
  ).reduce((sum, score) => sum + score, 0);

  return {
    recall: hitCount / relevantStarts.length,
    reciprocalRank: firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1),
    ndcg: idealDcg ? dcg / idealDcg : 0,
  };
}

function summarizeMetrics(rows) {
  if (!rows.length) throw new Error('No benchmark queries were evaluated.');
  return rows.reduce((summary, row) => ({
    recall: summary.recall + row.recall / rows.length,
    reciprocalRank: summary.reciprocalRank + row.reciprocalRank / rows.length,
    ndcg: summary.ndcg + row.ndcg / rows.length,
  }), { recall: 0, reciprocalRank: 0, ndcg: 0 });
}

module.exports = { evaluateQuery, summarizeMetrics };
