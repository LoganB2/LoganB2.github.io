// POST /api/recommend
// Body: { mediaType, wantGenres, excludeGenres, yearMin, yearMax, runtimeMin,
//         runtimeMax, madeBy, wantTags, avoidTags, nlText, ratings, seenIds, watchlist }
// Returns the top 5 ranked titles, each with a "why this pick" explanation
// (template facts + one short Claude-generated clause, see lib/explain.js).

import fs from 'node:fs/promises';
import path from 'node:path';
import { rankTitles } from '../lib/rank.js';
import { rankWithFeedback } from '../lib/session-feedback.js';
import { explainRecommendation } from '../lib/explain.js';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';

let titlesCache = null;
async function loadTitles() {
  if (!titlesCache) {
    const filePath = path.join(process.cwd(), 'data', 'titles.json');
    titlesCache = JSON.parse(await fs.readFile(filePath, 'utf8'));
  }
  return titlesCache;
}

function formatResult(r) {
  const t = r.title;
  return {
    id: t.id,
    mediaType: t.media_type,
    title: t.title,
    year: t.year,
    genres: t.genres,
    runtimeMinutes: t.runtime_minutes,
    numberOfSeasons: t.number_of_seasons,
    voteAverage: t.vote_average,
    posterUrl: t.poster_path ? POSTER_BASE + t.poster_path : null,
    overview: t.overview,
    directors: t.directors,
    creators: t.creators,
    score: r.score,
    explanation: null,
  };
}

// How many results to explain with Claude vs. return unexplained for "See
// more". Explaining is the expensive/slow part — capping it to the top 5
// keeps the initial response fast and cheap; the rest are still genuinely
// ranked matches, just not worth an API call unless the reader asks to see
// them.
const EXPLAINED_COUNT = 5;
const TOTAL_RETURNED = 20;

// Note: explanations do NOT cite specific rated titles ("echoing what you
// loved in X") — that was tried and removed. Even gated behind a high
// similarity threshold, the connection read as a stretch more often than
// it read as genuine insight. Feedback still shapes the ranking itself
// (see lib/session-feedback.js) — it's just not asserted in the prose.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  try {
    const {
      mediaType = null,
      wantGenres = [],
      excludeGenres = [],
      yearMin = null,
      yearMax = null,
      runtimeMin = null,
      runtimeMax = null,
      madeBy = null,
      wantTags = [],
      avoidTags = [],
      nlText = '',
      ratings = [],
      seenIds = [],
      watchlist = [],
    } = req.body ?? {};

    const titles = await loadTitles();
    const filters = { mediaType, wantGenres, excludeGenres, yearMin, yearMax, runtimeMin, runtimeMax, madeBy };
    const wantText = [nlText, wantTags.join(', ')].filter(Boolean).join('. ');
    const avoidText = avoidTags.join(', ');

    const hasFeedback = ratings.length > 0 || seenIds.length > 0 || watchlist.length > 0;
    const ranked = hasFeedback
      ? await rankWithFeedback({ titles, filters, wantText, avoidText, ratings, seenIds, watchlist })
      : await rankTitles({ titles, filters, wantText, avoidText });

    const top5 = ranked.slice(0, EXPLAINED_COUNT);
    const rest = ranked.slice(EXPLAINED_COUNT, TOTAL_RETURNED);

    const explained = await Promise.all(
      top5.map(async (r) => {
        const explanation = await explainRecommendation({
          title: r.title,
          wantText: nlText,
          wantGenres,
          wantTags,
          madeBy,
        });
        return { ...formatResult(r), explanation };
      })
    );

    const unexplained = rest.map((r) => formatResult(r));

    res.status(200).json({ results: [...explained, ...unexplained], explainedCount: EXPLAINED_COUNT });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
