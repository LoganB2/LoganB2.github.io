// GET /api/search-titles?q=dune&mediaType=movie
// Direct title-name search, for quickly adding something to the watchlist
// without going through the full genre/tag/NL recommendation flow. Matches
// are ranked by vote_count so well-known titles surface first among
// same-name matches (e.g. remakes, franchises).

import fs from 'node:fs/promises';
import path from 'node:path';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
const RESULT_LIMIT = 8;

let titlesCache = null;
async function loadTitles() {
  if (!titlesCache) {
    const filePath = path.join(process.cwd(), 'data', 'titles.json');
    titlesCache = JSON.parse(await fs.readFile(filePath, 'utf8'));
  }
  return titlesCache;
}

function formatResult(t) {
  return {
    id: t.id,
    mediaType: t.media_type,
    title: t.title,
    year: t.year,
    genres: t.genres,
    posterUrl: t.poster_path ? POSTER_BASE + t.poster_path : null,
  };
}

export default async function handler(req, res) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const mediaType = req.query.mediaType === 'movie' || req.query.mediaType === 'tv' ? req.query.mediaType : null;

  if (!q) {
    res.status(200).json({ results: [] });
    return;
  }

  try {
    const titles = await loadTitles();
    const needle = q.toLowerCase();

    const matches = titles
      .filter((t) => (!mediaType || t.media_type === mediaType) && t.title.toLowerCase().includes(needle))
      .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))
      .slice(0, RESULT_LIMIT)
      .map(formatResult);

    res.status(200).json({ results: matches });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
