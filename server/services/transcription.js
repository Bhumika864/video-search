const fs = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');

const API_URL = 'https://api.assemblyai.com/v2';

function getApiKey() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY is not configured.');
  return apiKey;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30_000),
    headers: {
      authorization: getApiKey(),
      'content-type': 'application/json',
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Speech-to-text API returned HTTP ${response.status}.`);
  }
  return body;
}

async function uploadAudio(filePath) {
  const fileSize = fs.statSync(filePath).size;
  const response = await fetch(`${API_URL}/upload`, {
    method: 'POST',
    headers: {
      authorization: getApiKey(),
      'content-type': 'application/octet-stream',
      'content-length': String(fileSize),
    },
    body: fs.createReadStream(filePath),
    duplex: 'half',
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.upload_url) {
    throw new Error(body.error || `Speech-to-text upload returned HTTP ${response.status}.`);
  }
  return body.upload_url;
}

async function waitForTranscript(transcriptId) {
  const deadline = Date.now() + 4 * 60 * 60 * 1000;

  while (Date.now() < deadline) {
    const transcript = await requestJson(`${API_URL}/transcript/${transcriptId}`);
    if (transcript.status === 'completed') return transcript;
    if (transcript.status === 'error') {
      const error = new Error(transcript.error || 'The speech-to-text provider could not transcribe this video.');
      error.retryable = false;
      throw error;
    }
    await delay(5000);
  }

  throw new Error('Transcription did not finish within four hours.');
}

async function transcribe(filePath, { providerJobId = '', onJobCreated = async () => {} } = {}) {
  let transcriptId = providerJobId;
  if (!transcriptId) {
    const audioUrl = await uploadAudio(filePath);
    const job = await requestJson(`${API_URL}/transcript`, {
      method: 'POST',
      body: JSON.stringify({
        audio_url: audioUrl,
        speech_models: ['universal-3-5-pro', 'universal-2'],
      }),
    });
    if (typeof job.id !== 'string' || !job.id) {
      throw new Error('The speech-to-text provider did not return a transcription job ID.');
    }
    transcriptId = job.id;
    await onJobCreated(transcriptId);
  }
  const transcript = await waitForTranscript(transcriptId);
  const sentenceData = await requestJson(`${API_URL}/transcript/${transcriptId}/sentences`);
  const sentences = sentenceData.sentences || [];
  const segments = sentences.length ? sentences : transcript.utterances || [];

  const timestampedSegments = segments
    .filter((segment) => segment.text && Number.isFinite(segment.start))
    .map((segment) => ({
      text: segment.text,
      start: segment.start / 1000,
      end: (segment.end || segment.start) / 1000,
    }));
  if (timestampedSegments.length === 0) {
    throw new Error('The speech-to-text provider returned no timestamped speech segments.');
  }
  return timestampedSegments;
}

module.exports = { transcribe };
