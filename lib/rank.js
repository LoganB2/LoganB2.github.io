// Combines hard-filtered candidates with semantic similarity, genre boost,
// an avoid-signal penalty, and a light quality prior into one ranked buffer.

import path from 'node:path';
import { pipeline, env } from '@huggingface/transformers';
import { applyHardFilters } from './filters.js';
import { loadEmbeddingsStore, cosineFromOffset, EMBED_DIM } from './embeddings-store.js';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

// The model is bundled directly into the repo (models/) rather than
// downloaded at runtime. Serverless platforms (Vercel included) give
// functions a read-only filesystem outside of /tmp, so transformers.js's
// default behavior — download from the Hugging Face hub on first use, then
// write it to a cache dir under node_modules — fails outright there
// ("ENOENT: no such file or directory, mkdir '.../node_modules/@huggingface/
// transformers/.cache'"), confirmed by an actual failed production request.
// Loading from a bundled local path needs no network call and no writable
// disk at all, which sidesteps that entirely (and is faster besides).
env.localModelPath = path.join(process.cwd(), 'models');
env.allowRemoteModels = false;
env.useFSCache = false;

// Tunable weights — these are starting points, not settled science. Expect
// to adjust them once we run real queries and eyeball whether the ordering
// feels right.
export const WEIGHTS = {
  semantic: 1.0, // want-vector similarity to the title
  avoid: 1.2, // weight applied to avoidSim once it clears AVOID_THRESHOLD
  genre: 0.15, // genre-overlap fraction (0..1), from the hard-filter step's genreBoost
  quality: 0.05, // vote_average normalized to 0..1, a light popularity/quality tiebreaker
};

// Cosine similarity has no natural zero — two unrelated pieces of text
// still land somewhere around 0, not a clean "no relation" value, and small
// positive readings there are noise rather than signal. Verified empirically:
// titles genuinely matching an avoid-query (e.g. actual space movies against
// "space travel, astronauts") scored ~0.40-0.47, while unrelated titles sat
// at ~-0.01-0.06. Below this threshold we treat avoidSim as noise and apply
// no penalty at all, so a merely-weak want-match can't win just by coincidentally
// having near-zero avoid similarity.
export const AVOID_THRESHOLD = 0.2;

export const BUFFER_SIZE = 20;

let extractorPromise = null;
function getExtractor() {
  if (!extractorPromise) extractorPromise = pipeline('feature-extraction', MODEL_NAME);
  return extractorPromise;
}

/** Embeds free text into a single normalized vector. Returns null for empty/blank text. */
export async function embedText(text) {
  if (!text || !text.trim()) return null;
  const extractor = await getExtractor();
  const out = await extractor([text], { pooling: 'mean', normalize: true });
  return out.data; // Float32Array, length EMBED_DIM
}

/**
 * Pure scoring step: given already-filtered candidates and already-computed
 * want/avoid vectors, produce the ranked buffer. Split out from rankTitles so
 * the feedback loop can inject session-nudged vectors without re-embedding
 * the original query text every time.
 *
 * @param {Array<{title: object, genreBoost: number}>} candidates
 * @param {Float32Array|null} wantVec
 * @param {Float32Array|null} avoidVec
 * @param {number} wantGenreCount
 * @param {Set<number>} [excludeIds] - title ids to omit entirely (seen/rated this session)
 */
export function scoreCandidates(candidates, wantVec, avoidVec, wantGenreCount, excludeIds) {
  const { vectors, offsetById } = loadEmbeddingsStoreSync();

  const scored = [];
  for (const { title, genreBoost } of candidates) {
    if (excludeIds?.has(title.id)) continue;

    const offset = offsetById.get(title.id);
    if (offset === undefined) continue; // shouldn't happen, but don't crash on a gap

    const semanticSim = wantVec ? cosineFromOffset(wantVec, vectors, offset, EMBED_DIM) : 0;
    const avoidSimRaw = avoidVec ? cosineFromOffset(avoidVec, vectors, offset, EMBED_DIM) : 0;
    const avoidSim = avoidSimRaw > AVOID_THRESHOLD ? avoidSimRaw - AVOID_THRESHOLD : 0;
    const genreFrac = wantGenreCount > 0 ? genreBoost / wantGenreCount : 0;
    const qualityNorm = title.vote_average != null ? title.vote_average / 10 : 0;

    const score =
      WEIGHTS.semantic * semanticSim -
      WEIGHTS.avoid * avoidSim +
      WEIGHTS.genre * genreFrac +
      WEIGHTS.quality * qualityNorm;

    scored.push({
      title,
      score,
      breakdown: { semanticSim, avoidSim, genreFrac, qualityNorm },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, BUFFER_SIZE);
}

// loadEmbeddingsStore is async (file I/O) but internally caches after the
// first call, so scoreCandidates — which needs to be callable synchronously
// once ranking is underway — just reaches into that same cache directly.
let storeCache = null;
export async function ensureStoreLoaded() {
  storeCache = await loadEmbeddingsStore();
  return storeCache;
}
function loadEmbeddingsStoreSync() {
  if (!storeCache) throw new Error('Embeddings store not loaded — call ensureStoreLoaded() first');
  return storeCache;
}

/**
 * @param {object} options
 * @param {Array} options.titles - full dataset (data/titles.json)
 * @param {import('./filters.js').FilterCriteria} options.filters - hard filter criteria
 * @param {string} options.wantText - NL box text + want-tags, joined into one string
 * @param {string} options.avoidText - avoid-tags joined into one string (may be empty)
 * @returns {Promise<Array<{title: object, score: number, breakdown: object}>>}
 */
export async function rankTitles({ titles, filters, wantText, avoidText }) {
  const candidates = applyHardFilters(titles, filters);
  const wantGenreCount = filters.wantGenres?.length ?? 0;

  const [wantVec, avoidVec] = await Promise.all([embedText(wantText), embedText(avoidText)]);
  await ensureStoreLoaded();

  return scoreCandidates(candidates, wantVec, avoidVec, wantGenreCount);
}
