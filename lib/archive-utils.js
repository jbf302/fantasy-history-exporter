// Helpers shared by the ESPN and Sleeper normalizers. Both produce the same
// archive shape as the Yahoo normalizer (see docs/export-format.md).

export function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function roundPoints(value) {
  return Math.round(asNumber(value, 0) * 100) / 100;
}

export function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry != null && entry !== ""));
}

export function seasonLeagueId(provider, providerLeagueId, season) {
  return `${provider}:nfl:${providerLeagueId}:${season}`;
}

export function seasonDraftId(provider, providerLeagueId, season) {
  return `${seasonLeagueId(provider, providerLeagueId, season)}:draft`;
}

export function sortedSeasonKeys(seasons) {
  return Object.keys(seasons || {}).sort((a, b) => Number(a) - Number(b));
}

export function recordString(wins, losses, ties) {
  return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

/** "full" with lineups, "standings_and_matchups" with scores only, else "standings_only". */
export function historyDetailFor(matchupsByWeek, lineupSource) {
  const legs = Object.values(matchupsByWeek || {}).flat();
  if (!legs.length) return "standings_only";
  return legs.some((leg) => leg.metadata?.lineup_source === lineupSource) ? "full" : "standings_and_matchups";
}

/** One matchup leg (one team's side of a matchup) in the shared export shape. */
export function matchupLeg({ leagueId, round, matchupId, rosterId, points, metadata, lineup = null }) {
  return {
    league_id: leagueId,
    round,
    leg: round,
    roster_bucket: 0,
    matchup_id: matchupId,
    roster_id: rosterId,
    players: lineup?.players || [],
    starters: lineup?.starters || [],
    players_points: lineup?.players_points || {},
    starters_points: lineup?.starters_points || {},
    points,
    custom_points: points,
    proj_points: null,
    max_points: null,
    metadata: compactObject({ ...metadata, score_storage: "custom_points" })
  };
}

/**
 * Wraps normalized seasons in the top-level archive: links each season to the
 * one before it and adds the summary and metadata blocks.
 */
export function buildArchive({ provider, providerLeagueId, seasons, lineupSource }) {
  const sorted = sortedSeasonKeys(seasons);
  sorted.forEach((season, index) => {
    seasons[season].league.previous_league_id =
      index > 0 ? seasonLeagueId(provider, providerLeagueId, sorted[index - 1]) : null;
  });

  const latest = seasons[sorted[sorted.length - 1]];
  const detailBySeason = Object.fromEntries(
    sorted.map((season) => [season, seasons[season].league.metadata?.history_detail])
  );
  const fullSeasons = sorted.filter((season) => detailBySeason[season] === "full");
  const anyMatchups = sorted.some((season) => detailBySeason[season] !== "standings_only");
  const anyLineups = fullSeasons.length > 0;
  const now = new Date().toISOString();

  return {
    schema_version: 1,
    provider,
    sport: "nfl",
    import_id: `${provider}:nfl:${providerLeagueId}`,
    provider_league_id: String(providerLeagueId),
    name: latest?.league?.name || "League",
    imported_at: now,
    updated_at: now,
    seasons,
    summary: {
      seasons: sorted,
      total_seasons: sorted.length,
      total_rosters: latest?.league?.total_rosters || 0,
      score_storage: "custom_points",
      lineup_enrichment: anyLineups ? lineupSource : "not_requested",
      history_coverage: {
        full_seasons: fullSeasons,
        standings_only_seasons: sorted.filter((season) => !fullSeasons.includes(season))
      }
    },
    metadata: {
      provider,
      history_detail: anyMatchups ? (anyLineups ? "full" : "standings_and_matchups") : "standings_only",
      import_phase: anyMatchups ? "matchups_and_lineups" : "standings_slice",
      lineup_enrichment: anyLineups ? lineupSource : "not_requested"
    }
  };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Spaces calls to `request` at least `minIntervalMs` apart and retries 429/5xx
 * after each delay in `backoffMs`. `request(url, ...args)` must throw errors with
 * a numeric `status`.
 */
export function pacedRequester(request, { minIntervalMs = 150, backoffMs = [2000, 6000] } = {}) {
  let lastRequestAt = 0;
  return async function paced(...args) {
    for (let retry = 0; ; retry += 1) {
      const wait = lastRequestAt + minIntervalMs - Date.now();
      if (wait > 0) await delay(wait);
      lastRequestAt = Date.now();
      try {
        return await request(...args);
      } catch (error) {
        const status = error?.status;
        const throttled = status === 429 || (status >= 500 && status <= 599);
        if (throttled && retry < backoffMs.length) {
          await delay(backoffMs[retry]);
          continue;
        }
        throw error;
      }
    }
  };
}
