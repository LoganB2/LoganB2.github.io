// Loads the pre-computed title embeddings (from scripts/embed-titles.js)
// into memory once, keyed by title id, for fast lookup during ranking.

import fs from 'node:fs/promises';
import path from 'node:path';

export const EMBED_DIM = 384;

let cached = null;

export async function loadEmbeddingsStore() {
  if (cached) return cached;

  const buf = await fs.readFile(path.join(process.cwd(), 'data', 'embeddings.bin'));
  const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const index = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'data', 'embeddings-index.json'), 'utf8')
  );

  const offsetById = new Map();
  index.forEach((entry, row) => offsetById.set(entry.id, row * EMBED_DIM));

  cached = { vectors, index, offsetById };
  return cached;
}

/** Cosine similarity where `vectors` are already L2-normalized (dot product == cosine sim). */
export function cosineFromOffset(queryVec, vectors, offset, dim = EMBED_DIM) {
  let dot = 0;
  for (let i = 0; i < dim; i++) dot += queryVec[i] * vectors[offset + i];
  return dot;
}
