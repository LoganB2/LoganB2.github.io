// Turns a reader's history (in-session ratings, plus persisted ratings and
// watchlist from past visits) into a live adjustment of the want/avoid
// vectors, without training anything — just re-weighting the centroid those
// vectors are drawn from.

import { applyHardFilters } from './filters.js';
import { embedText, scoreCandidates, ensureStoreLoaded } from './rank.js';
import { loadEmbeddingsStore, cosineFromOffset, EMBED_DIM } from './embeddings-store.js';

// How much the original stated preference (the anchor) outweighs any single
// nudge source. "Moderate": roughly double any one nudge, so it takes a
// couple of same-direction signals before results visibly shift.
const ANCHOR_WEIGHT = 2.0;

// Weight for the ENTIRE history-derived nudge (ratings + watchlist,
// filtered to this search and collapsed into one centroid per direction —
// see below). Deliberately modest and fixed regardless of how many titles
// qualify: a watchlist of 20 shouldn't pull harder than a watchlist of 2,
// it should just be a more confident version of the same nudge. This is
// what keeps historical preference from overpowering the current search.
const HISTORY_WEIGHT = 0.6;

/** Weighted average of several normalized vectors, re-normalized to unit length. */
function weightedCentroid(parts) {
  if (!parts.length) return null;
  const sum = new Float32Array(EMBED_DIM);
  let totalWeight = 0;
  for (const { vec, weight } of parts) {
    for (let i = 0; i < EMBED_DIM; i++) sum[i] += vec[i] * weight;
    totalWeight += weight;
  }
  for (let i = 0; i < EMBED_DIM; i++) sum[i] /= totalWeight;

  // re-normalize to unit length so cosine similarity math downstream stays valid
  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += sum[i] * sum[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < EMBED_DIM; i++) sum[i] /= norm;

  return sum;
}

/**
 * @typedef {object} Rating
 * @property {number} titleId
 * @property {'hated'|'disliked'|'liked'|'loved'} rating
 */

/**
 * @typedef {object} WatchlistEntry
 * @property {number} titleId
 */

/**
 * @param {object} options
 * @param {Array} options.titles - full dataset
 * @param {import('./filters.js').FilterCriteria} options.filters
 * @param {string} options.wantText
 * @param {string} options.avoidText
 * @param {Rating[]} options.ratings - all of the reader's ratings (in-session and persisted — the client sends its full history each time)
 * @param {number[]} [options.seenIds] - additional titles to exclude that weren't rated
 * @param {WatchlistEntry[]} [options.watchlist] - titles the reader has saved for later
 */
export async function rankWithFeedback({ titles, filters, wantText, avoidText, ratings, seenIds = [], watchlist = [] }) {
  const candidates = applyHardFilters(titles, filters);
  const wantGenreCount = filters.wantGenres?.length ?? 0;

  const [baseWantVec, baseAvoidVec] = await Promise.all([embedText(wantText), embedText(avoidText)]);
  await ensureStoreLoaded();
  const { vectors, offsetById } = await loadEmbeddingsStore();

  function vectorForTitle(titleId) {
    const offset = offsetById.get(titleId);
    if (offset === undefined) return null;
    return vectors.subarray(offset, offset + EMBED_DIM);
  }

  // Only let a past rating/watchlist entry influence today's ranking if that
  // title would ALSO satisfy today's hard filters (genre-exclude, year,
  // runtime, made-by) — a loved horror movie shouldn't nudge a feel-good
  // comedy search just because it exists somewhere in the reader's history.
  // Reuses the exact same hard-filter logic as the main search, just applied
  // to a single title at a time.
  const titlesById = new Map(titles.map((t) => [t.id, t]));
  function qualifiesForCurrentSearch(titleId) {
    const t = titlesById.get(titleId);
    return t ? applyHardFilters([t], filters).length > 0 : false;
  }

  const positiveIds = [
    ...ratings
      .filter((r) => (r.rating === 'loved' || r.rating === 'liked') && qualifiesForCurrentSearch(r.titleId))
      .map((r) => r.titleId),
    ...watchlist.filter((w) => qualifiesForCurrentSearch(w.titleId)).map((w) => w.titleId),
  ];
  const negativeIds = ratings
    .filter((r) => (r.rating === 'hated' || r.rating === 'disliked') && qualifiesForCurrentSearch(r.titleId))
    .map((r) => r.titleId);

  // Collapse each direction into ONE centroid rather than nudging per item —
  // this, combined with the fixed HISTORY_WEIGHT above, is what keeps the
  // signal bounded regardless of how much history exists.
  function collapsedCentroid(ids) {
    const vecs = ids.map(vectorForTitle).filter(Boolean);
    return vecs.length ? weightedCentroid(vecs.map((vec) => ({ vec, weight: 1 }))) : null;
  }
  const historyPositiveVec = collapsedCentroid(positiveIds);
  const historyNegativeVec = collapsedCentroid(negativeIds);

  const wantParts = baseWantVec ? [{ vec: baseWantVec, weight: ANCHOR_WEIGHT }] : [];
  const avoidParts = baseAvoidVec ? [{ vec: baseAvoidVec, weight: ANCHOR_WEIGHT }] : [];
  if (historyPositiveVec) wantParts.push({ vec: historyPositiveVec, weight: HISTORY_WEIGHT });
  if (historyNegativeVec) avoidParts.push({ vec: historyNegativeVec, weight: HISTORY_WEIGHT });

  const wantVec = weightedCentroid(wantParts);
  const avoidVec = weightedCentroid(avoidParts);

  // Don't re-recommend something already rated, dismissed, or on the watchlist.
  const excludeIds = new Set([...ratings.map((r) => r.titleId), ...seenIds, ...watchlist.map((w) => w.titleId)]);

  return scoreCandidates(candidates, wantVec, avoidVec, wantGenreCount, excludeIds);
}

/** Cosine similarity between two title vectors — used only for debugging/inspection. */
export function titleSimilarity(offsetById, vectors, idA, idB) {
  const a = offsetById.get(idA);
  const b = offsetById.get(idB);
  if (a === undefined || b === undefined) return null;
  return cosineFromOffset(vectors.subarray(a, a + EMBED_DIM), vectors, b, EMBED_DIM);
}
