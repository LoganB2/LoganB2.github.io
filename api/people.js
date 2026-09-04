// GET /api/people?q=nolan
// Autocomplete suggestions for the "made by" filter. Returns exact full
// names — the client must send back one of these (not the raw query text)
// as `madeBy` on /api/recommend, so two people sharing a surname don't collide.

import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPeopleIndex, suggestPeople } from '../lib/filters.js';

let peopleIndexCache = null;
async function loadPeopleIndex() {
  if (!peopleIndexCache) {
    const filePath = path.join(process.cwd(), 'data', 'titles.json');
    const titles = JSON.parse(await fs.readFile(filePath, 'utf8'));
    peopleIndexCache = buildPeopleIndex(titles);
  }
  return peopleIndexCache;
}

export default async function handler(req, res) {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const people = await loadPeopleIndex();
  res.status(200).json({ suggestions: suggestPeople(people, q, 8) });
}
