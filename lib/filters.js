// Hard-filter layer: narrows the full title pool down to titles that satisfy
// structured constraints (genre exclusion, year range, runtime range, a
// "made by" person) before any semantic ranking runs.
//
// Genre "want" is NOT a hard filter here — it returns a per-title boost
// score instead, to be blended with the embedding similarity score later.

/**
 * @typedef {object} FilterCriteria
 * @property {'movie'|'tv'|null} mediaType
 * @property {string[]} wantGenres     - soft signal, boosts matching titles
 * @property {string[]} excludeGenres  - hard filter, removes any overlap
 * @property {number|null} yearMin
 * @property {number|null} yearMax
 * @property {number|null} runtimeMin
 * @property {number|null} runtimeMax
 * @property {string|null} madeBy      - matches director, creator, or producer (case-insensitive substring)
 */

function normalize(str) {
  return str.trim().toLowerCase();
}

function matchesMadeBy(title, madeBy) {
  if (!madeBy) return true;
  const needle = normalize(madeBy);
  const people = [...title.directors, ...title.creators, ...title.producers];
  return people.some((name) => normalize(name).includes(needle));
}

function hasGenreOverlap(title, genres) {
  if (!genres.length) return false;
  const titleGenres = new Set(title.genres.map(normalize));
  return genres.some((g) => titleGenres.has(normalize(g)));
}

function countGenreOverlap(title, genres) {
  if (!genres.length) return 0;
  const titleGenres = new Set(title.genres.map(normalize));
  return genres.reduce((count, g) => count + (titleGenres.has(normalize(g)) ? 1 : 0), 0);
}

function inRange(value, min, max) {
  // Unknown values (null) are excluded once a range filter is actively set,
  // rather than given the benefit of the doubt — a runtime filter that
  // silently lets through titles of unknown length would be surprising.
  if (min == null && max == null) return true;
  if (value == null) return false;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

/**
 * @param {Array} titles - full dataset from data/titles.json
 * @param {FilterCriteria} criteria
 * @returns {Array<{title: object, genreBoost: number}>}
 */
export function applyHardFilters(titles, criteria) {
  const {
    mediaType = null,
    wantGenres = [],
    excludeGenres = [],
    yearMin = null,
    yearMax = null,
    runtimeMin = null,
    runtimeMax = null,
    madeBy = null,
  } = criteria;

  const results = [];

  for (const title of titles) {
    if (mediaType && title.media_type !== mediaType) continue;
    if (excludeGenres.length && hasGenreOverlap(title, excludeGenres)) continue;
    if (!inRange(title.year ? Number(title.year) : null, yearMin, yearMax)) continue;
    if (!inRange(title.runtime_minutes, runtimeMin, runtimeMax)) continue;
    if (!matchesMadeBy(title, madeBy)) continue;

    results.push({
      title,
      genreBoost: countGenreOverlap(title, wantGenres),
    });
  }

  return results;
}

/**
 * Builds a deduplicated, sorted list of names for the "made by" autocomplete,
 * pulling from directors, creators, and producers across the whole dataset.
 */
export function buildPeopleIndex(titles) {
  const names = new Set();
  for (const title of titles) {
    for (const name of [...title.directors, ...title.creators, ...title.producers]) {
      names.add(name);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/**
 * Autocomplete only — returns full-name candidates for a partial, as-typed
 * query. The UI should let the user pick one of these, then pass that exact
 * name as `madeBy` to applyHardFilters (not the partial query itself), so
 * two people who happen to share a surname don't collide.
 */
export function suggestPeople(peopleIndex, query, limit = 10) {
  if (!query) return [];
  const needle = normalize(query);
  return peopleIndex.filter((name) => normalize(name).includes(needle)).slice(0, limit);
}
