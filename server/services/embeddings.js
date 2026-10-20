const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const BATCH_SIZE = 16;

let extractorPromise;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = import('@huggingface/transformers')
      .then(({ pipeline }) => pipeline('feature-extraction', MODEL_NAME));
    extractorPromise.catch(() => {
      extractorPromise = null;
    });
  }
  return extractorPromise;
}

async function embedTexts(texts) {
  const extractor = await getExtractor();
  const embeddings = [];
  for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
    const batch = texts.slice(offset, offset + BATCH_SIZE);
    const output = await extractor(batch, { pooling: 'mean', normalize: true });
    embeddings.push(...output.tolist());
  }
  return embeddings;
}

module.exports = { embedTexts, MODEL_NAME };
