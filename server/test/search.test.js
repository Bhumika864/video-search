const test = require('node:test');
const assert = require('node:assert/strict');
const { keywordSearch, rankSemanticResults } = require('../services/search');

test('keyword search treats query punctuation literally and ignores case', () => {
  const video = { transcript: [
    { text: 'The C++ language is useful.', start: 1 },
    { text: 'The C language is useful.', start: 2 },
  ] };
  assert.deepEqual(keywordSearch(video, 'c++'), [video.transcript[0]]);
});

test('whole-word keyword search avoids partial-word matches', () => {
  const video = { transcript: [
    { text: 'A cat sat beside a catfish.', start: 1 },
    { text: 'The catfish ran away.', start: 2 },
  ] };
  assert.deepEqual(keywordSearch(video, 'cat', true), [video.transcript[0]]);
});

test('semantic ranking boosts direct query-term overlap and removes internal scores', () => {
  const ranked = rankSemanticResults('who is the speaker', [
    { text: 'A person speaking.', start: 1, score: 0.7 },
    { text: 'The speaker introduces herself.', start: 2, score: 0.68 },
  ]);
  assert.equal(ranked[0].start, 2);
  assert.equal(Object.hasOwn(ranked[0], 'score'), false);
});
