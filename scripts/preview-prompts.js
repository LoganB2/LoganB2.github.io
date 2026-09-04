// Prints the EXACT system + user prompt that would be sent to Claude for a
// handful of real scenarios — no API calls, $0 cost. For reviewing/tuning
// the explanation prompt before spending anything on it.
//
// Usage: node scripts/preview-prompts.js

import fs from 'node:fs/promises';
import { buildEvidence, buildClausePrompt } from '../lib/explain.js';

const titles = JSON.parse(await fs.readFile(new URL('../data/titles.json', import.meta.url)));
const byTitle = (name) => {
  const t = titles.find((x) => x.title === name);
  if (!t) throw new Error(`Title not found in dataset: ${name}`);
  return t;
};

const scenarios = [
  {
    label: '1. Sci-fi, twist ending, heavy NL text',
    title: byTitle('Interstellar'),
    wantGenres: ['Science Fiction'],
    wantTags: ['Twist ending', 'Mind-bending'],
    madeBy: null,
    wantText: 'I want a movie that will make me think, with a twist at the end, sci-fi or futuristic',
  },
  {
    label: '2. Comedy/feel-good, tags only, no free text',
    title: byTitle('The Fundamentals of Caring'),
    wantGenres: ['Comedy'],
    wantTags: ['Feel-good'],
    madeBy: null,
    wantText: '',
  },
  {
    label: '3. TV, mood-driven, anthology',
    title: byTitle('Black Mirror'),
    wantGenres: ['Sci-Fi & Fantasy'],
    wantTags: ['Dark / bleak', 'Anthology'],
    madeBy: null,
    wantText: 'something that will genuinely mess with my head',
  },
  {
    label: '4. Horror, explicit exclusion language in the NL text',
    title: byTitle('Hereditary'),
    wantGenres: ['Horror'],
    wantTags: ['Slow burn', 'Disturbing'],
    madeBy: null,
    wantText: "a horror movie that's genuinely unsettling, not jump-scares",
  },
  {
    label: '5. Director filter, minimal other signal',
    title: byTitle('Dunkirk'),
    wantGenres: [],
    wantTags: [],
    madeBy: 'Christopher Nolan',
    wantText: 'something with great direction',
  },
];

for (const s of scenarios) {
  const evidence = buildEvidence({
    title: s.title,
    wantGenres: s.wantGenres,
    wantTags: s.wantTags,
    madeBy: s.madeBy,
  });
  const { system, user } = buildClausePrompt({ title: s.title, wantText: s.wantText, evidence });

  console.log('='.repeat(80));
  console.log(s.label);
  console.log('-'.repeat(80));
  console.log('Selections:', JSON.stringify({ wantGenres: s.wantGenres, wantTags: s.wantTags, madeBy: s.madeBy, nlText: s.wantText }));
  console.log('Evidence computed:', JSON.stringify(evidence));
  console.log();
  console.log('--- SYSTEM ---');
  console.log(system);
  console.log();
  console.log('--- USER ---');
  console.log(user);
  console.log();
}
