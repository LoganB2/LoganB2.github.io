// One-time (or periodic) TMDB data pull.
// Usage: npm run pull-tmdb
//
// Pulls the top ~5,000 movies and ~3,000 TV shows by vote count, fetches full
// detail (credits + keywords) for each, and writes a single normalized
// dataset to data/titles.json for the embedding step to consume.

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.TMDB_READ_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('Missing TMDB_READ_ACCESS_TOKEN in .env');
  process.exit(1);
}

const BASE_URL = 'https://api.themoviedb.org/3';
const MOVIE_TARGET = 5000;
const TV_TARGET = 3000;
const MIN_VOTE_COUNT = 100;
const PAGE_SIZE = 20; // fixed by TMDB
const DETAIL_CONCURRENCY = 15;
const DETAIL_DELAY_MS = 50; // small pause between batches, polite to the API

const OUTPUT_PATH = path.join(process.cwd(), 'data', 'titles.json');

async function tmdbFetch(pathname, params = {}) {
  const url = new URL(BASE_URL + pathname);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`TMDB ${res.status} ${res.statusText} — ${url.pathname}${url.search}`);
  }
  return res.json();
}

async function discoverIds(mediaType, targetCount) {
  const ids = [];
  let page = 1;
  const maxPages = Math.ceil(targetCount / PAGE_SIZE);

  while (ids.length < targetCount && page <= maxPages) {
    const data = await tmdbFetch(`/discover/${mediaType}`, {
      sort_by: 'vote_count.desc',
      'vote_count.gte': MIN_VOTE_COUNT,
      page,
      include_adult: false,
    });
    if (!data.results || data.results.length === 0) break;
    for (const item of data.results) ids.push(item.id);
    if (page >= data.total_pages) break;
    page += 1;
  }

  return ids.slice(0, targetCount);
}

function pickCrew(crew, jobs) {
  return crew
    .filter((person) => jobs.includes(person.job))
    .map((person) => person.name);
}

function extractRecord(mediaType, detail) {
  const isMovie = mediaType === 'movie';
  const credits = detail.credits ?? { cast: [], crew: [] };
  const keywords = isMovie
    ? detail.keywords?.keywords ?? []
    : detail.keywords?.results ?? [];

  return {
    id: detail.id,
    media_type: mediaType,
    title: isMovie ? detail.title : detail.name,
    overview: detail.overview ?? '',
    genres: (detail.genres ?? []).map((g) => g.name),
    year: (isMovie ? detail.release_date : detail.first_air_date)?.slice(0, 4) ?? null,
    runtime_minutes: isMovie
      ? detail.runtime ?? null
      : detail.episode_run_time?.[0] ?? null,
    number_of_seasons: isMovie ? null : detail.number_of_seasons ?? null,
    status: isMovie ? null : detail.status ?? null, // e.g. "Ended", "Returning Series"
    poster_path: detail.poster_path ?? null,
    vote_average: detail.vote_average ?? null,
    vote_count: detail.vote_count ?? null,
    directors: isMovie ? pickCrew(credits.crew, ['Director']) : [],
    // TV has no single "director" per series; use the creators field instead.
    creators: isMovie ? [] : (detail.created_by ?? []).map((c) => c.name),
    producers: pickCrew(credits.crew, ['Producer', 'Executive Producer']),
    cast: (credits.cast ?? []).slice(0, 5).map((c) => c.name),
    keywords: keywords.map((k) => k.name),
  };
}

async function fetchDetail(mediaType, id) {
  return tmdbFetch(`/${mediaType}/${id}`, {
    append_to_response: 'credits,keywords',
  });
}

async function fetchDetailsInBatches(mediaType, ids) {
  const records = [];
  for (let i = 0; i < ids.length; i += DETAIL_CONCURRENCY) {
    const batch = ids.slice(i, i + DETAIL_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((id) => fetchDetail(mediaType, id))
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        records.push(extractRecord(mediaType, result.value));
      } else {
        console.warn(`  skip ${mediaType} — ${result.reason?.message ?? result.reason}`);
      }
    }
    console.log(`  ${mediaType}: ${Math.min(i + DETAIL_CONCURRENCY, ids.length)}/${ids.length}`);
    await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
  }
  return records;
}

async function main() {
  console.log('Discovering movie ids...');
  const movieIds = await discoverIds('movie', MOVIE_TARGET);
  console.log(`  found ${movieIds.length} movies`);

  console.log('Discovering tv ids...');
  const tvIds = await discoverIds('tv', TV_TARGET);
  console.log(`  found ${tvIds.length} tv shows`);

  console.log('Fetching movie details (credits + keywords)...');
  const movies = await fetchDetailsInBatches('movie', movieIds);

  console.log('Fetching tv details (credits + keywords)...');
  const tvShows = await fetchDetailsInBatches('tv', tvIds);

  const titles = [...movies, ...tvShows];

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(titles, null, 2));

  console.log(`\nWrote ${titles.length} titles to ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
