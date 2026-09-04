// Recommendation engine front end. No explanation text yet (that's the next
// build step) — this wires up media type -> tags/filters -> ranked results,
// plus the "already seen it" feedback loop that re-ranks live.

(function () {
  const GENRES_BY_MEDIA = {
    movie: ["Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy", "History", "Horror", "Music", "Mystery", "Romance", "Science Fiction", "Thriller", "War", "Western"],
    tv: ["Action & Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family", "History", "Mystery", "Reality", "Romance", "Sci-Fi & Fantasy", "War & Politics", "Western"],
  };

  const SOFT_TAG_GROUPS = [
    { label: "Mood / Tone", tags: ["Feel-good", "Heartwarming", "Dark / bleak", "Funny", "Tense / suspenseful", "Bittersweet", "Disturbing", "Whimsical", "Inspiring", "Nostalgic"] },
    { label: "Narrative style", tags: ["Twist ending", "Slow burn", "Fast-paced", "Nonlinear timeline", "Mind-bending", "Based on a novel or book", "Ensemble cast", "Anthology"] },
    { label: "Setting", tags: ["Futuristic", "Historical", "Space", "Fantasy world", "Small town", "Dystopian"] },
    { label: "Commitment", tags: ["Easy binge", "Limited series", "Long-running"] },
  ];

  const STORAGE_KEY = "rec-taste-profile";

  const state = {
    mediaType: null,
    genreState: {}, // name -> 'want' | 'avoid'
    softTagState: {}, // name -> 'want' | 'avoid'
    madeBy: null,
    ratings: [], // { titleId, mediaType, rating, title, year, posterUrl, genres, ratedAt }
    seenIds: [], // dismissed without a rating
    watchlist: [], // { titleId, mediaType, title, year, posterUrl, genres, addedAt }
    searchHistory: [], // { at, mediaType, wantGenres, excludeGenres, wantTags, avoidTags, madeBy, yearMin, yearMax, runtimeMin, runtimeMax, nlText }
  };

  function loadProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state.ratings = Array.isArray(parsed.ratings) ? parsed.ratings : [];
      state.seenIds = Array.isArray(parsed.seenIds) ? parsed.seenIds : [];
      state.watchlist = Array.isArray(parsed.watchlist) ? parsed.watchlist : [];
      state.searchHistory = Array.isArray(parsed.searchHistory) ? parsed.searchHistory : [];
    } catch (e) {
      // corrupt/blocked storage — just start fresh
    }
  }

  function saveProfile() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ratings: state.ratings,
          seenIds: state.seenIds,
          watchlist: state.watchlist,
          searchHistory: state.searchHistory,
        })
      );
    } catch (e) {
      // storage unavailable (private mode, quota) — feedback still works for this page load
    }
  }

  function cycleState(current) {
    if (current === undefined) return "want";
    if (current === "want") return "avoid";
    return undefined; // clear
  }

  function renderGenreChips() {
    const container = document.getElementById("genre-chips");
    container.innerHTML = "";
    state.genreState = {};
    const genres = GENRES_BY_MEDIA[state.mediaType] || [];
    for (const genre of genres) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "rec-chip";
      chip.textContent = genre;
      chip.dataset.name = genre;
      chip.addEventListener("click", () => {
        const next = cycleState(state.genreState[genre]);
        if (next) state.genreState[genre] = next;
        else delete state.genreState[genre];
        chip.dataset.state = next || "";
        updateSelectionSummary();
      });
      container.appendChild(chip);
    }
  }

  function renderSoftTagGroups() {
    const container = document.getElementById("soft-tag-groups");
    container.innerHTML = "";
    state.softTagState = {};
    for (const group of SOFT_TAG_GROUPS) {
      const groupEl = document.createElement("div");
      groupEl.className = "rec-chip-group";
      const label = document.createElement("p");
      label.className = "rec-chip-group-label";
      label.textContent = group.label;
      groupEl.appendChild(label);

      const chipsEl = document.createElement("div");
      chipsEl.className = "rec-chips";
      for (const tag of group.tags) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "rec-chip";
        chip.textContent = tag;
        chip.addEventListener("click", () => {
          const next = cycleState(state.softTagState[tag]);
          if (next) state.softTagState[tag] = next;
          else delete state.softTagState[tag];
          chip.dataset.state = next || "";
          updateSelectionSummary();
        });
        chipsEl.appendChild(chip);
      }
      groupEl.appendChild(chipsEl);
      container.appendChild(groupEl);
    }
  }

  function selectMediaType(mediaType) {
    state.mediaType = mediaType;
    document.querySelectorAll(".rec-media-btn").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.media === mediaType);
    });
    document.getElementById("step-details").classList.remove("rec-hidden");
    document.getElementById("runtime-label").textContent =
      mediaType === "tv" ? "Avg episode runtime (minutes)" : "Runtime (minutes)";
    renderGenreChips();
    renderSoftTagGroups();
    document.getElementById("results-area").innerHTML = "";
    updateSelectionSummary();
  }

  // --- "made by" autocomplete ---
  let madeByDebounce = null;
  function setupMadeByAutocomplete() {
    const input = document.getElementById("madeby-input");
    const suggestionsEl = document.getElementById("madeby-suggestions");
    const selectedEl = document.getElementById("madeby-selected");

    input.addEventListener("input", () => {
      clearTimeout(madeByDebounce);
      const q = input.value.trim();
      if (!q) {
        suggestionsEl.classList.add("rec-hidden");
        return;
      }
      madeByDebounce = setTimeout(async () => {
        try {
          const res = await fetch(`/api/people?q=${encodeURIComponent(q)}`);
          const data = await res.json();
          renderSuggestions(data.suggestions || []);
        } catch (e) {
          suggestionsEl.classList.add("rec-hidden");
        }
      }, 200);
    });

    function renderSuggestions(names) {
      suggestionsEl.innerHTML = "";
      if (!names.length) {
        suggestionsEl.classList.add("rec-hidden");
        return;
      }
      names.forEach((name) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = name;
        btn.addEventListener("click", () => {
          state.madeBy = name;
          input.value = "";
          suggestionsEl.classList.add("rec-hidden");
          renderMadeBySelected();
          updateSelectionSummary();
        });
        suggestionsEl.appendChild(btn);
      });
      suggestionsEl.classList.remove("rec-hidden");
    }

    function renderMadeBySelected() {
      selectedEl.innerHTML = "";
      if (!state.madeBy) return;
      const chip = document.createElement("span");
      chip.className = "rec-madeby-chip";
      chip.innerHTML = `${state.madeBy} <button type="button" aria-label="Remove">×</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        state.madeBy = null;
        renderMadeBySelected();
        updateSelectionSummary();
      });
      selectedEl.appendChild(chip);
    }

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".rec-autocomplete")) suggestionsEl.classList.add("rec-hidden");
    });
  }

  function namesByState(stateMap, want) {
    return Object.entries(stateMap)
      .filter(([, v]) => v === want)
      .map(([k]) => k);
  }

  // The "selections" shape shared between the API request and the search
  // history log — kept as one function so the two can never drift apart.
  function buildSelections() {
    return {
      mediaType: state.mediaType,
      wantGenres: namesByState(state.genreState, "want"),
      excludeGenres: namesByState(state.genreState, "avoid"),
      yearMin: numOrNull("year-min"),
      yearMax: numOrNull("year-max"),
      runtimeMin: numOrNull("runtime-min"),
      runtimeMax: numOrNull("runtime-max"),
      madeBy: state.madeBy,
      wantTags: namesByState(state.softTagState, "want"),
      avoidTags: namesByState(state.softTagState, "avoid"),
      nlText: document.getElementById("nl-text").value,
    };
  }

  function buildRequestBody() {
    return {
      ...buildSelections(),
      ratings: state.ratings.filter((r) => r.mediaType === state.mediaType),
      seenIds: state.seenIds,
      watchlist: state.watchlist.filter((w) => w.mediaType === state.mediaType),
    };
  }

  // Logged only on an explicit "Find a recommendation" click (not on the
  // automatic re-fetch after a rating, or on reset) — this is meant to be a
  // timeline of distinct searches the reader made, not every internal re-rank.
  function logSearchHistory() {
    const selections = buildSelections();
    // Skip logging an empty/unchanged search (e.g. just clicking through)
    const hasAnySelection =
      selections.wantGenres.length ||
      selections.excludeGenres.length ||
      selections.wantTags.length ||
      selections.avoidTags.length ||
      selections.madeBy ||
      selections.nlText.trim() ||
      selections.yearMin != null ||
      selections.yearMax != null ||
      selections.runtimeMin != null ||
      selections.runtimeMax != null;
    if (!hasAnySelection) return;

    state.searchHistory.push({ at: new Date().toISOString(), ...selections });
    saveProfile();
  }

  function numOrNull(id) {
    const val = document.getElementById(id).value;
    return val === "" ? null : Number(val);
  }

  // Renders exactly what will be sent on the next search, so a leftover
  // selection from an earlier search (e.g. a genre chip left on "want" from
  // a prior query) is visible before submitting, not just discovered in the
  // results afterward.
  function updateSelectionSummary() {
    const summaryEl = document.getElementById("selection-summary");
    if (!summaryEl) return;

    const wantGenres = namesByState(state.genreState, "want");
    const excludeGenres = namesByState(state.genreState, "avoid");
    const wantTags = namesByState(state.softTagState, "want");
    const avoidTags = namesByState(state.softTagState, "avoid");
    const yearMin = numOrNull("year-min");
    const yearMax = numOrNull("year-max");
    const runtimeMin = numOrNull("runtime-min");
    const runtimeMax = numOrNull("runtime-max");
    const nlText = document.getElementById("nl-text")?.value.trim();

    const lines = [];
    if (wantGenres.length || wantTags.length) {
      lines.push(`<strong>Want:</strong> ${[...wantGenres, ...wantTags].map(escapeHtml).join(", ")}`);
    }
    if (excludeGenres.length || avoidTags.length) {
      lines.push(`<strong>Avoid:</strong> ${[...excludeGenres, ...avoidTags].map(escapeHtml).join(", ")}`);
    }
    if (state.madeBy) lines.push(`<strong>Made by:</strong> ${escapeHtml(state.madeBy)}`);
    if (yearMin != null || yearMax != null) {
      lines.push(`<strong>Year:</strong> ${yearMin ?? "any"}–${yearMax ?? "any"}`);
    }
    if (runtimeMin != null || runtimeMax != null) {
      lines.push(`<strong>Runtime:</strong> ${runtimeMin ?? "any"}–${runtimeMax ?? "any"} min`);
    }
    if (nlText) lines.push(`<strong>Description:</strong> "${escapeHtml(nlText)}"`);

    summaryEl.innerHTML = lines.length
      ? lines.join(" &nbsp;·&nbsp; ")
      : '<span class="rec-summary-empty">Nothing selected yet.</span>';
  }

  function clearAllSelections() {
    state.genreState = {};
    state.softTagState = {};
    state.madeBy = null;

    document.querySelectorAll("#genre-chips .rec-chip, #soft-tag-groups .rec-chip").forEach((chip) => {
      chip.dataset.state = "";
    });
    document.getElementById("madeby-selected").innerHTML = "";
    document.getElementById("nl-text").value = "";
    ["year-min", "year-max", "runtime-min", "runtime-max"].forEach((id) => {
      document.getElementById(id).value = "";
    });

    updateSelectionSummary();
  }

  async function fetchRecommendations() {
    const resultsArea = document.getElementById("results-area");
    resultsArea.innerHTML = '<p class="rec-status">Finding matches…</p>';
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody()),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      renderResults(data.results || [], data.explainedCount ?? 5);
    } catch (e) {
      resultsArea.innerHTML = `<p class="rec-status">Something went wrong: ${e.message}</p>`;
    }
  }

  function renderResults(results, explainedCount) {
    const resultsArea = document.getElementById("results-area");
    document.getElementById("reset-row").classList.remove("rec-hidden");
    if (!results.length) {
      resultsArea.innerHTML = '<p class="rec-status">No matches left with these filters — try loosening a filter or a tag.</p>';
      return;
    }

    resultsArea.innerHTML = "";
    const shown = results.slice(0, explainedCount);
    const more = results.slice(explainedCount);

    shown.forEach((item, idx) => {
      resultsArea.appendChild(renderResultCard(item, idx + 1, explainedCount));
    });

    if (more.length) {
      const moreContainer = document.createElement("div");
      moreContainer.className = "rec-hidden";
      more.forEach((item, idx) => {
        moreContainer.appendChild(renderResultCard(item, explainedCount + idx + 1, explainedCount));
      });

      const seeMoreRow = document.createElement("div");
      seeMoreRow.className = "rec-see-more-row";
      const seeMoreBtn = document.createElement("button");
      seeMoreBtn.type = "button";
      seeMoreBtn.className = "btn btn-secondary";
      seeMoreBtn.textContent = `See ${more.length} more match${more.length === 1 ? "" : "es"}`;
      seeMoreBtn.addEventListener("click", () => {
        moreContainer.classList.remove("rec-hidden");
        seeMoreRow.remove();
      });
      seeMoreRow.appendChild(seeMoreBtn);

      resultsArea.appendChild(seeMoreRow);
      resultsArea.appendChild(moreContainer);
    }
  }

  function renderResultCard(item, rank, explainedCount) {
    const card = document.createElement("div");
    card.className = "rec-result-card";

    const lengthLabel =
      item.mediaType === "tv"
        ? item.numberOfSeasons
          ? `${item.numberOfSeasons} season${item.numberOfSeasons === 1 ? "" : "s"}`
          : "TV series"
        : item.runtimeMinutes
        ? `${item.runtimeMinutes} min`
        : "";

    card.innerHTML = `
      <div class="rec-result-rank">#${rank}</div>
      ${item.posterUrl ? `<img class="rec-poster" src="${item.posterUrl}" alt="${escapeHtml(item.title)} poster" />` : '<div class="rec-poster"></div>'}
      <div class="rec-result-body">
        <p class="rec-result-title">${escapeHtml(item.title)} ${item.year ? `(${item.year})` : ""}</p>
        <p class="rec-result-meta">${escapeHtml((item.genres || []).join(" · "))}${lengthLabel ? " · " + lengthLabel : ""}${item.voteAverage ? " · ★ " + item.voteAverage.toFixed(1) : ""}</p>
        <p class="rec-result-overview">${escapeHtml(item.overview || "")}</p>
        ${item.overview && item.overview.length > 130 ? '<button type="button" class="rec-overview-toggle">Show more</button>' : ""}
        ${
          item.explanation
            ? `<p class="rec-explanation">${escapeHtml(item.explanation)}</p>`
            : `<p class="rec-explanation rec-explanation-note">A full explanation is written for your top ${explainedCount} matches only, to keep things quick — this one still cleared every filter and ranked well, just outside that cut.</p>`
        }
        <div class="rec-actions rec-actions-primary"></div>
        <div class="rec-actions rec-actions-rating rec-hidden"></div>
      </div>
    `;

    const overviewToggle = card.querySelector(".rec-overview-toggle");
    if (overviewToggle) {
      const overviewEl = card.querySelector(".rec-result-overview");
      overviewToggle.addEventListener("click", () => {
        const expanded = overviewEl.classList.toggle("rec-expanded");
        overviewToggle.textContent = expanded ? "Show less" : "Show more";
      });
    }

    const primaryActions = card.querySelector(".rec-actions-primary");
    const ratingActions = card.querySelector(".rec-actions-rating");

    const seenBtn = document.createElement("button");
    seenBtn.type = "button";
    seenBtn.className = "rec-btn-small";
    seenBtn.textContent = "Already seen it";
    seenBtn.addEventListener("click", () => {
      primaryActions.classList.add("rec-hidden");
      ratingActions.classList.remove("rec-hidden");
    });
    primaryActions.appendChild(seenBtn);

    const alreadyOnWatchlist = state.watchlist.some((w) => w.titleId === item.id);
    const watchlistBtn = document.createElement("button");
    watchlistBtn.type = "button";
    watchlistBtn.className = "rec-btn-small";
    watchlistBtn.textContent = alreadyOnWatchlist ? "✓ On watchlist" : "+ Add to watchlist";
    if (alreadyOnWatchlist) watchlistBtn.disabled = true;
    watchlistBtn.addEventListener("click", () => {
      addToWatchlist(item);
      watchlistBtn.textContent = "✓ On watchlist";
      watchlistBtn.disabled = true;
    });
    primaryActions.appendChild(watchlistBtn);

    ["hated", "disliked", "liked", "loved"].forEach((rating) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rec-btn-small rec-rating-btn";
      btn.dataset.rating = rating;
      btn.textContent = rating[0].toUpperCase() + rating.slice(1);
      btn.addEventListener("click", () => submitRating(item, rating));
      ratingActions.appendChild(btn);
    });

    return card;
  }

  function submitRating(item, rating) {
    state.ratings.push({
      titleId: item.id,
      mediaType: item.mediaType,
      rating,
      title: item.title,
      year: item.year,
      posterUrl: item.posterUrl,
      genres: item.genres,
      // Snapshot of the mood/style tags active in this search — titles don't
      // carry our own tag taxonomy, so this is the only way "About You" can
      // describe typical tags rather than just genres. Only reflects tags
      // selected from this point forward, not retroactively.
      wantTagsAtTime: namesByState(state.softTagState, "want"),
      ratedAt: new Date().toISOString(),
    });
    saveProfile();
    fetchRecommendations();
  }

  function addToWatchlist(item) {
    if (state.watchlist.some((w) => w.titleId === item.id)) return;
    state.watchlist.push({
      titleId: item.id,
      mediaType: item.mediaType,
      title: item.title,
      year: item.year,
      posterUrl: item.posterUrl,
      genres: item.genres,
      wantTagsAtTime: namesByState(state.softTagState, "want"),
      addedAt: new Date().toISOString(),
    });
    saveProfile();
  }

  function removeFromWatchlist(titleId) {
    state.watchlist = state.watchlist.filter((w) => w.titleId !== titleId);
    saveProfile();
    renderPreferencesTab();
  }

  function removeRating(titleId) {
    state.ratings = state.ratings.filter((r) => r.titleId !== titleId);
    saveProfile();
    renderPreferencesTab();
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function setupResetButton() {
    document.getElementById("reset-btn").addEventListener("click", () => {
      state.ratings = [];
      state.seenIds = [];
      saveProfile();
      fetchRecommendations();
    });
  }

  // --- "My Preferences" tab ---

  function switchTab(tab) {
    document.querySelectorAll(".rec-tab-btn").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.tab === tab);
    });
    document.getElementById("tab-find").classList.toggle("rec-hidden", tab !== "find");
    document.getElementById("tab-preferences").classList.toggle("rec-hidden", tab !== "preferences");
    if (tab === "preferences") renderPreferencesTab();
  }

  function summarizeSelections(sel) {
    const parts = [];
    if (sel.wantGenres?.length || sel.wantTags?.length) {
      parts.push(`wanted ${[...sel.wantGenres, ...sel.wantTags].join(", ")}`);
    }
    if (sel.excludeGenres?.length || sel.avoidTags?.length) {
      parts.push(`avoided ${[...sel.excludeGenres, ...sel.avoidTags].join(", ")}`);
    }
    if (sel.madeBy) parts.push(`made by ${sel.madeBy}`);
    if (sel.yearMin != null || sel.yearMax != null) parts.push(`${sel.yearMin ?? "any"}–${sel.yearMax ?? "any"}`);
    if (sel.nlText?.trim()) parts.push(`"${sel.nlText.trim()}"`);
    const mediaLabel = sel.mediaType === "tv" ? "TV" : "Movie";
    return `${mediaLabel} · ${parts.length ? parts.join(" — ") : "no filters set"}`;
  }

  function renderPrefCard(item, { removable, badge } = {}) {
    const card = document.createElement("div");
    card.className = "rec-pref-card";
    card.innerHTML = `
      ${item.posterUrl ? `<img src="${item.posterUrl}" alt="${escapeHtml(item.title)} poster" />` : ""}
      <div class="rec-pref-info">
        <p class="rec-pref-title">${escapeHtml(item.title)}</p>
        <p class="rec-pref-meta">${item.year || ""}</p>
        ${badge ? `<span class="rec-rating-badge ${badge}">${badge}</span>` : ""}
      </div>
      ${removable ? '<button type="button" class="rec-pref-remove" aria-label="Remove">×</button>' : ""}
    `;
    if (removable) {
      card.querySelector(".rec-pref-remove").addEventListener("click", () => removable(item.titleId));
    }
    return card;
  }

  const MEDIA_LABELS = { movie: "🎬 Movies", tv: "📺 TV Shows" };

  // Renders a media-type-split section (used for both Watchlist and Seen &
  // Rated): one subgroup per media type, each with its own grid, and a
  // "nothing yet" line for a media type with no entries rather than hiding
  // it entirely — keeps the movie/TV split visible and predictable.
  function renderSplitByMedia(container, items, emptyMessage, cardOptions) {
    container.innerHTML = "";
    ["movie", "tv"].forEach((mediaType) => {
      const group = document.createElement("div");
      group.className = "rec-pref-media-group";
      const heading = document.createElement("p");
      heading.className = "rec-pref-subheading";
      heading.textContent = MEDIA_LABELS[mediaType];
      group.appendChild(heading);

      const filtered = items.filter((i) => i.mediaType === mediaType);
      if (!filtered.length) {
        const empty = document.createElement("p");
        empty.className = "rec-status";
        empty.textContent = emptyMessage;
        group.appendChild(empty);
      } else {
        const grid = document.createElement("div");
        grid.className = "rec-pref-grid";
        [...filtered].reverse().forEach((item) => {
          grid.appendChild(renderPrefCard(item, cardOptions(item)));
        });
        group.appendChild(grid);
      }
      container.appendChild(group);
    });
  }

  // --- "About You" aggregation ---

  function tally(arrayOfArrays) {
    const counts = new Map();
    for (const arr of arrayOfArrays) {
      for (const name of arr || []) {
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
    return counts;
  }

  function topN(counts, n = 4) {
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name]) => name);
  }

  function typicalDecade(items) {
    const decadeCounts = tally(
      items.filter((i) => i.year).map((i) => [`${Math.floor(Number(i.year) / 10) * 10}s`])
    );
    const top = topN(decadeCounts, 1);
    return top[0] || null;
  }

  function describeGroup(items) {
    if (!items.length) return null;
    const genres = topN(tally(items.map((i) => i.genres)), 4);
    const tags = topN(tally(items.map((i) => i.wantTagsAtTime)), 3);
    const decade = typicalDecade(items);
    const parts = [];
    if (genres.length) parts.push(genres.join(", "));
    if (tags.length) parts.push(tags.join(", "));
    return { line: parts.join(" · ") || "not enough detail yet", decade, count: items.length };
  }

  function renderAboutYouCard(title, group) {
    const card = document.createElement("div");
    card.className = "rec-about-card";
    if (!group) {
      card.innerHTML = `<h4>${title}</h4><p class="rec-status" style="padding:8px 0;">Not enough data yet.</p>`;
      return card;
    }
    card.innerHTML = `
      <h4>${title}</h4>
      <div class="rec-about-row">
        <span class="rec-about-label">Genres &amp; tags</span>
        <span class="rec-about-value">${escapeHtml(group.line)}</span>
      </div>
      ${
        group.decade
          ? `<div class="rec-about-row"><span class="rec-about-label">Mostly from</span><span class="rec-about-value">${group.decade}</span></div>`
          : ""
      }
      <div class="rec-about-row">
        <span class="rec-about-label">Based on</span>
        <span class="rec-about-value">${group.count} title${group.count === 1 ? "" : "s"}</span>
      </div>
    `;
    return card;
  }

  function renderAboutYou() {
    const container = document.getElementById("pref-about-you");
    container.innerHTML = "";

    ["movie", "tv"].forEach((mediaType) => {
      const mediaGroup = document.createElement("div");
      mediaGroup.className = "rec-pref-media-group";
      const heading = document.createElement("p");
      heading.className = "rec-pref-subheading";
      heading.textContent = MEDIA_LABELS[mediaType];
      mediaGroup.appendChild(heading);

      const grid = document.createElement("div");
      grid.className = "rec-about-you";

      const searches = state.searchHistory.filter((s) => s.mediaType === mediaType);
      const searchTerms = topN(tally(searches.map((s) => [...s.wantGenres, ...s.wantTags])), 5);
      const searchGroup = searches.length ? { line: searchTerms.join(", ") || "no clear pattern yet", decade: null, count: searches.length } : null;

      const watchlistItems = state.watchlist.filter((w) => w.mediaType === mediaType);
      const likedItems = state.ratings.filter((r) => r.mediaType === mediaType && (r.rating === "loved" || r.rating === "liked"));
      const dislikedItems = state.ratings.filter((r) => r.mediaType === mediaType && (r.rating === "hated" || r.rating === "disliked"));

      grid.appendChild(renderAboutYouCard("You often search for", searchGroup));
      grid.appendChild(renderAboutYouCard("Your watchlist leans toward", describeGroup(watchlistItems)));
      grid.appendChild(renderAboutYouCard("What you tend to like", describeGroup(likedItems)));
      grid.appendChild(renderAboutYouCard("What you tend to dislike", describeGroup(dislikedItems)));

      mediaGroup.appendChild(grid);
      container.appendChild(mediaGroup);
    });
  }

  function renderPreferencesTab() {
    const watchlistEl = document.getElementById("pref-watchlist");
    const ratingsEl = document.getElementById("pref-ratings");
    const historyEl = document.getElementById("pref-history");

    renderSplitByMedia(
      watchlistEl,
      state.watchlist,
      "Nothing here yet — add titles from your recommendations.",
      () => ({ removable: removeFromWatchlist })
    );

    renderSplitByMedia(
      ratingsEl,
      state.ratings,
      'Nothing rated yet — mark a recommendation as "Already seen it" to start building this out.',
      (item) => ({ removable: removeRating, badge: item.rating })
    );

    renderAboutYou();

    historyEl.innerHTML = "";
    if (!state.searchHistory.length) {
      historyEl.innerHTML = '<p class="rec-status">No searches logged yet — this fills in each time you click "Find a recommendation."</p>';
    } else {
      [...state.searchHistory].reverse().forEach((entry) => {
        const item = document.createElement("div");
        item.className = "rec-history-item";
        const date = new Date(entry.at);
        item.innerHTML = `
          <p class="rec-history-date">${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
          <p class="rec-history-summary">${escapeHtml(summarizeSelections(entry))}</p>
        `;
        historyEl.appendChild(item);
      });
    }
  }

  // One-time trigger: visiting this page with ?demo=1 loads realistic sample
  // data (real titles, spread across the last ~3 weeks) into this browser's
  // localStorage, so "My Preferences" has something to show without needing
  // to manually rate/watchlist a dozen things first. Only for exploring the
  // UI — safe to run more than once (just overwrites with the same sample).
  async function maybeLoadDemoData() {
    const params = new URLSearchParams(location.search);
    if (params.get("demo") !== "1") return;
    try {
      const res = await fetch("../data/demo-profile.json");
      const demo = await res.json();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(demo));
      // Reload without the ?demo=1 param so a page refresh doesn't
      // re-overwrite anything the person changes afterward.
      const url = new URL(location.href);
      url.searchParams.delete("demo");
      location.replace(url.toString());
    } catch (e) {
      console.error("Failed to load demo data:", e);
    }
  }

  async function init() {
    await maybeLoadDemoData();
    loadProfile();
    document.querySelectorAll(".rec-media-btn").forEach((btn) => {
      btn.addEventListener("click", () => selectMediaType(btn.dataset.media));
    });
    document.querySelectorAll(".rec-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
    document.getElementById("submit-btn").addEventListener("click", () => {
      logSearchHistory();
      fetchRecommendations();
    });
    document.getElementById("clear-all-btn").addEventListener("click", clearAllSelections);
    ["year-min", "year-max", "runtime-min", "runtime-max", "nl-text"].forEach((id) => {
      document.getElementById(id).addEventListener("input", updateSelectionSummary);
    });
    setupMadeByAutocomplete();
    setupResetButton();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
