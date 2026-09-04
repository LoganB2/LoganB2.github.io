// Generates a semantic embedding vector for every title in data/titles.json,
// using a small open-source model that runs locally (no API key, no cost).
//
// Usage: npm run embed-titles
//
// Output:
//   data/embeddings.bin        - raw Float32 vectors, one after another (N * DIM floats)
//   data/embeddings-index.json - ordered list of {id, media_type} matching each vector's row

import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from '@huggingface/transformers';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBED_DIM = 384; // fixed by this model
const BATCH_SIZE = 32;

const TITLES_PATH = path.join(process.cwd(), 'data', 'titles.json');
const VECTORS_PATH = path.join(process.cwd(), 'data', 'embeddings.bin');
const INDEX_PATH = path.join(process.cwd(), 'data', 'embeddings-index.json');

// This is the "document" per title — the text that actually gets embedded.
// Overview carries the plot/semantic core; genres and keywords reinforce
// tone/theme. Genres are repeated once to weight them a bit more heavily
// than any single keyword, since they're a more reliable signal.
function buildDocument(title) {
  const genres = title.genres?.join(', ') ?? '';
  const keywords = title.keywords?.join(', ') ?? '';
  return [
    title.overview,
    genres && `Genres: ${genres}. ${genres}.`,
    keywords && `Keywords: ${keywords}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

async function main() {
  console.log('Loading titles...');
  const titles = JSON.parse(await fs.readFile(TITLES_PATH, 'utf8'));
  console.log(`  ${titles.length} titles`);

  console.log(`Loading model (${MODEL_NAME})... first run downloads it, then it's cached.`);
  const extractor = await pipeline('feature-extraction', MODEL_NAME);

  const vectors = new Float32Array(titles.length * EMBED_DIM);
  const index = [];

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const batch = titles.slice(i, i + BATCH_SIZE);
    const docs = batch.map(buildDocument);

    const output = await extractor(docs, { pooling: 'mean', normalize: true });
    // output.data is a flat Float32Array of shape [batch.length, EMBED_DIM]
    vectors.set(output.data, i * EMBED_DIM);

    for (const t of batch) {
      index.push({ id: t.id, media_type: t.media_type, title: t.title });
    }

    if ((i / BATCH_SIZE) % 10 === 0) {
      console.log(`  embedded ${Math.min(i + BATCH_SIZE, titles.length)}/${titles.length}`);
    }
  }

  await fs.writeFile(VECTORS_PATH, Buffer.from(vectors.buffer));
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2));

  console.log(`\nWrote ${index.length} vectors (${EMBED_DIM}d) to ${path.relative(process.cwd(), VECTORS_PATH)}`);
  console.log(`Wrote index to ${path.relative(process.cwd(), INDEX_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
