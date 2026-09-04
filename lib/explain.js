// Builds the "why this pick" explanation as: [deterministic template] + [one
// short Claude-generated clause] + ".". The template does all the bookkeeping
// (which genres/tags actually matched, director match) for free; Claude is
// only asked for the one thing that needs real language understanding —
// connecting the plot to what the person described, without spoiling it.
// This keeps Claude's output to a single short clause, not a full paragraph
// re-stating facts we already know.
//
// Note: this deliberately does NOT tie a recommendation to a specific
// previously-rated title ("echoing what you loved in X"). That was tried
// and removed — even gated behind a high similarity threshold, the
// connection read as a stretch more often than genuine insight.

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 40;

// In-memory cache, keyed by title + the exact preference inputs that
// produced this recommendation. Resets on server restart — fine for a
// personal-site scale project; avoids re-billing identical repeat renders
// within a session (e.g. re-showing #1 after a re-rank).
const cache = new Map();

function joinList(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function matchedGenreNames(title, wantGenres) {
  const set = new Set(title.genres.map((g) => g.toLowerCase()));
  return wantGenres.filter((g) => set.has(g.toLowerCase()));
}

// Approximate, conservative: only cites a soft tag as "matched" if it
// literally appears in the overview/keywords text. Tags that contributed to
// the semantic ranking without a literal match just aren't cited here —
// Claude's clause, which actually reads the overview, picks up that slack.
function matchedTagNames(title, wantTags) {
  const haystack = [title.overview, ...(title.keywords || [])].join(' ').toLowerCase();
  return wantTags.filter((tag) => haystack.includes(tag.toLowerCase()));
}

function matchedMadeBy(title, madeBy) {
  if (!madeBy) return null;
  const people = [...title.directors, ...title.creators, ...title.producers];
  return people.some((n) => n.toLowerCase() === madeBy.toLowerCase()) ? madeBy : null;
}

export function buildEvidence({ title, wantGenres, wantTags, madeBy }) {
  return {
    matchedGenres: matchedGenreNames(title, wantGenres),
    matchedTags: matchedTagNames(title, wantTags),
    madeByMatch: matchedMadeBy(title, madeBy),
  };
}

function buildDeterministicPrefix(title, evidence) {
  const parts = [];
  if (evidence.matchedGenres.length) parts.push(`your want for ${joinList(evidence.matchedGenres)}`);
  if (evidence.matchedTags.length) parts.push(joinList(evidence.matchedTags));
  if (evidence.madeByMatch) parts.push(`being made by ${evidence.madeByMatch}`);

  // A little phrasing variety, chosen deterministically per title (so caching
  // stays stable), so a batch of 5 results doesn't read as the exact same
  // sentence skeleton five times in a row.
  const verbs = ['matches', 'lines up with', 'connects with'];
  const noPartsPhrases = ['stood out as a strong match', 'earned its spot here', 'is a strong pick'];
  const pick = (arr) => arr[title.id % arr.length];

  const matchLine = parts.length ? `${pick(verbs)} ${joinList(parts)}` : pick(noPartsPhrases);
  return `${title.title} (${title.year || 'n/a'}) ${matchLine} because `;
}

// Pure prompt construction, split out from generateClause so the exact
// system/user text can be inspected (e.g. for prompt review) without
// spending an API call.
export function buildClausePrompt({ title, wantText, evidence }) {
  const system = [
    "You're a knowledgeable video store clerk giving a customer a quick, friendly reason to pick this title — not writing a formal analysis.",
    'A sentence elsewhere ends with the word "because" and then a blank. You write ONLY the text that fills that blank, inserted verbatim.',
    'Keep it SHORT: 8-15 words. Casual and confident, like you\'re talking to them in person.',
    'Name ONE vivid, specific thing about the story — a hook, a vibe, a standout quality. Don\'t try to explicitly prove it matches everything they asked for or restate their words back at them; trust that\'s already been said elsewhere. Just sell it, briefly.',
    'CRITICAL grammar rule: your reply must be a full clause with its own subject and verb, not a bare noun phrase — it has to complete the sentence "..because ___" so it actually reads correctly out loud. WRONG (a noun phrase, not a real clause — do not do this): "a mind-bending trip through space and time you won\'t forget". RIGHT (has a subject + verb): "it follows a washed-up boxer chasing one last shot at redemption". Before answering, check: does my reply have a verb acting on a subject? If not, rewrite it so it does.',
    'Examples of the right tone AND correct grammar, in full, with nothing else: "it follows a mind-bending trip through space and time you won\'t forget" / "it\'s an odd-couple story that sneaks up on you emotionally" / "it delivers twisted standalone stories that mess with your head"',
    'Hard rules: do not include the word "because" yourself. Do not include the movie/show title. Do not use quotation marks, ellipses, dashes, or any preamble like "Sure" or "Here is". Do not end with a period. Start with a lowercase word.',
    'You are NEVER allowed to ask a question, request clarification, or comment on missing/insufficient information — there is no back-and-forth, this is your only turn. Always produce a short, confident answer no matter how little input you are given.',
    'Never reveal the ending or what a twist/reveal actually is — you may say a story "has a twist" but never describe it.',
  ].join(' ');

  const alreadyMentioned = [...evidence.matchedGenres, ...evidence.matchedTags];
  const userLines = [];
  if (wantText && wantText.trim()) userLines.push(`Reader wants: "${wantText}"`);
  else if (alreadyMentioned.length) userLines.push(`Reader wants: ${alreadyMentioned.join(', ')}`);
  userLines.push(`Plot summary: "${title.overview || '(no summary available)'}"`);
  const user = userLines.join('\n');

  return { system, user };
}

async function generateClause({ title, wantText, evidence }) {
  const { system, user } = buildClausePrompt({ title, wantText, evidence });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const clause = sanitizeClause((data.content?.[0]?.text || '').trim(), title.title);

  if (!isValidClause(clause)) {
    throw new Error(`Claude returned an unusable clause: ${JSON.stringify(clause)}`);
  }
  return clause;
}

// Defense in depth: the prompt asks for a bare clause, but strip common
// slip-ups (a leading "because", stray quotes, an echoed title, a trailing
// period) rather than trust the model never produces them.
function sanitizeClause(text, titleName) {
  let clause = text;
  clause = clause.replace(/^["'“‘]+|["'”’]+$/g, '');
  clause = clause.replace(/^because\s+/i, '');
  if (titleName) {
    const escaped = titleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clause = clause.replace(new RegExp(`^${escaped}\\s*(\\.\\.\\.|—|-)?\\s*(because\\s+)?`, 'i'), '');
  }
  clause = clause.replace(/\.+$/, '');
  return clause.trim();
}

// Catches the case the prompt is supposed to prevent — Claude breaking
// format to ask a question or comment on missing information — before it
// can get spliced into the template and shown to a user. If a clause fails
// this check, the caller falls back to the deterministic-only line instead.
const META_PATTERNS = [
  /\?/,
  /\bi need\b/i,
  /\bclarify\b/i,
  /\blet me know\b/i,
  /\bcould you\b/i,
  /\bcan you\b/i,
  /\bmore information\b/i,
  /\bplease (provide|specify|clarify)\b/i,
  /\bspecify\b/i,
  /\bhelp you\b/i,
  /\byour request\b/i,
  /\bas an ai\b/i,
];

// Distinguishes "the API account is out of budget" from an ordinary
// transient error, so the fallback text can say so honestly instead of
// silently pretending everything's fine. Covers both a hard credit-balance
// failure (400) and simple rate limiting (429) — the former needs a person
// to add funds, the latter usually clears on its own, but both mean no
// explanation is coming back right now.
function isQuotaError(err) {
  const msg = err?.message || '';
  return /credit balance|429|rate_limit_error|insufficient_quota|billing/i.test(msg);
}

function isValidClause(clause) {
  if (!clause) return false;
  const wordCount = clause.split(/\s+/).filter(Boolean).length;
  if (wordCount < 3 || wordCount > 24) return false;
  return !META_PATTERNS.some((pattern) => pattern.test(clause));
}

/**
 * @param {object} options
 * @param {object} options.title - full title record
 * @param {string} options.wantText - the NL box text (not tags — those are cited via evidence)
 * @param {string[]} options.wantGenres
 * @param {string[]} options.wantTags
 * @param {string|null} options.madeBy
 */
export async function explainRecommendation({ title, wantText, wantGenres, wantTags, madeBy }) {
  const key = JSON.stringify([title.id, wantText, wantGenres, wantTags, madeBy]);
  if (cache.has(key)) return cache.get(key);

  const evidence = buildEvidence({ title, wantGenres, wantTags, madeBy });
  const prefix = buildDeterministicPrefix(title, evidence);

  let explanation;
  let quotaHit = false;
  try {
    const clause = await generateClause({ title, wantText, evidence });
    explanation = clause ? `${prefix}${clause}.` : `${prefix}its plot and tone line up with what you described.`;
  } catch (err) {
    console.error('explainRecommendation fallback:', err.message);
    if (isQuotaError(err)) {
      quotaHit = true;
      explanation = `${prefix}the AI usage budget for this project has been reached, so this part is unavailable right now — the match above is still accurate.`;
    } else {
      explanation = `${prefix}its plot and tone line up with what you described.`;
    }
  }

  // Don't cache a quota failure — it's often transient (rate limit) and
  // even when it's a real hard cap, we want the next request to retry
  // rather than being stuck showing "unavailable" forever until a restart.
  if (!quotaHit) cache.set(key, explanation);
  return explanation;
}
