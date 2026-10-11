import { rosterIdFromTeamKey } from "./yahoo-api.js";

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundPoints(value) {
  return Math.round(asNumber(value, 0) * 100) / 100;
}

function leagueIdFor(providerLeagueId, season) {
  return `yahoo:nfl:${providerLeagueId}:${season}`;
}

function draftIdFor(providerLeagueId, season) {
  return `yahoo:nfl:${providerLeagueId}:${season}:draft`;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry != null && entry !== ""));
}

function managerForTeam(team) {
  const managers = team.managers;
  const list = Array.isArray(managers) ? managers : managers?.manager ? [managers] : [];
  const first = list[0]?.manager || list[0] || null;
  return first && typeof first === "object" ? first : null;
}

function userIdForManager(manager) {
  if (!manager) return null;
  const guid = manager.guid || manager.manager_id;
  return guid ? `yahoo_user:${guid}` : null;
}

function usersForSeason(teams, leagueId) {
  const users = [];
  const seen = new Set();

  for (const team of teams) {
    const manager = managerForTeam(team);
    const userId = userIdForManager(manager);
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);

    users.push({
      league_id: leagueId,
      user_id: userId,
      display_name: manager.nickname || team.name || `Manager ${team.team_id}`,
      avatar: team.team_logos?.[0]?.team_logo?.url || null,
      is_bot: false,
      is_owner: false,
      settings: {},
      metadata: compactObject({
        provider: "yahoo",
        yahoo_manager_id: manager.manager_id?.toString(),
        yahoo_guid: manager.guid
      })
    });
  }

  return users;
}

function rostersForSeason(teams, leagueId) {
  return teams.map((team) => {
    const manager = managerForTeam(team);
    const userId = userIdForManager(manager);
    const standings = team.team_standings || {};
    const outcomes = standings.outcome_totals || {};

    return {
      league_id: leagueId,
      roster_id: asNumber(team.team_id, 0),
      owner_id: userId,
      co_owners: [],
      players: [],
      starters: [],
      reserve: [],
      taxi: [],
      keepers: [],
      settings: compactObject({
        wins: asNumber(outcomes.wins),
        losses: asNumber(outcomes.losses),
        ties: asNumber(outcomes.ties),
        fpts: roundPoints(standings.points_for ?? team.team_points?.total),
        fpts_against: roundPoints(standings.points_against),
        rank: asNumber(standings.rank)
      }),
      metadata: compactObject({
        provider: "yahoo",
        yahoo_team_key: team.team_key,
        yahoo_team_id: team.team_id?.toString(),
        team_name: team.name
      })
    };
  });
}

function mergeSeasonTeams(bundle) {
  const standings = bundle.standingsTeams || [];
  const rosters = bundle.rosterTeams || [];
  if (!standings.length) return rosters;
  if (!rosters.length) return standings;

  const merged = new Map();
  for (const team of rosters) {
    merged.set(String(team.team_id), { ...team });
  }
  for (const team of standings) {
    const id = String(team.team_id);
    const existing = merged.get(id) || {};
    merged.set(id, {
      ...existing,
      ...team,
      team_standings: team.team_standings || existing.team_standings,
      team_points: team.team_points || existing.team_points
    });
  }
  return [...merged.values()];
}

function leagueStatusFromMetadata(metadata) {
  if (metadata.is_finished === "1" || metadata.is_finished === 1) return "complete";
  if (metadata.is_finished === "0" || metadata.is_finished === 0) return "in_season";
  return "complete";
}

export function playerIdForYahooKey(playerKey) {
  if (!playerKey) return null;
  return playerKey.startsWith("yahoo:") ? playerKey : `yahoo:${playerKey}`;
}

function isStarterPosition(position) {
  return Boolean(position) && !isBenchOrIrPosition(position);
}

function isBenchOrIrPosition(position) {
  const value = String(position || "").toUpperCase();
  return value === "BN" || value === "IR";
}

function yahooMatchupLeg({
  team,
  opponentTeamId,
  leagueId,
  round,
  matchupId,
  matchupMeta
}) {
  const rosterId = Number(team.team_id);
  if (!Number.isFinite(rosterId)) return null;

  const score = teamWeekPointsFromTeam(team);
  const winnerKey = matchupMeta?.winner_team_key || null;
  const won =
    winnerKey && team.team_key
      ? winnerKey === team.team_key
        ? "true"
        : "false"
      : null;

  return {
    league_id: leagueId,
    round,
    leg: round,
    roster_bucket: 0,
    matchup_id: matchupId,
    roster_id: rosterId,
    players: [],
    starters: [],
    players_points: {},
    starters_points: {},
    points: score,
    custom_points: score,
    proj_points: null,
    max_points: null,
    metadata: compactObject({
      provider: "yahoo",
      opponent_roster_id: opponentTeamId?.toString(),
      winner_team_key: winnerKey,
      won_matchup: won,
      is_playoffs: matchupMeta?.is_playoffs?.toString(),
      is_consolation: matchupMeta?.is_consolation?.toString(),
      matchup_status: matchupMeta?.status,
      score_source: "yahoo_team_points",
      score_storage: "custom_points"
    })
  };
}

function teamWeekPointsFromTeam(team) {
  const weekPoints = team?.team_points;
  if (weekPoints && String(weekPoints.coverage_type || "").toLowerCase() === "week") {
    const total = Number(weekPoints.total);
    if (Number.isFinite(total)) return roundPoints(total);
  }

  const points = team?.points;
  if (points && String(points.coverage_type || "").toLowerCase() === "week") {
    const total = Number(points.total);
    if (Number.isFinite(total)) return roundPoints(total);
  }

  const direct = Number(team?.team_points?.total ?? team?.points?.total);
  return Number.isFinite(direct) ? roundPoints(direct) : 0;
}

export function matchupsByWeekFromScoreboards(scoreboardsByWeek, leagueId) {
  const grouped = {};

  for (const [weekKey, scoreboard] of Object.entries(scoreboardsByWeek || {})) {
    const round = Number(weekKey);
    if (!Number.isFinite(round)) continue;

    for (const matchup of scoreboard?.matchups || []) {
      const teams = matchup.teams || [];
      if (!teams.length) continue;

      if (!grouped[round]) grouped[round] = [];
      const matchupId =
        grouped[round].reduce((max, leg) => Math.max(max, Number(leg.matchup_id) || 0), 0) + 1;

      for (let index = 0; index < teams.length; index += 1) {
        const team = teams[index];
        const opponent = teams.length === 2 ? teams[index === 0 ? 1 : 0] : null;
        const leg = yahooMatchupLeg({
          team,
          opponentTeamId: opponent?.team_id,
          leagueId,
          round,
          matchupId,
          matchupMeta: matchup
        });
        if (leg) grouped[round].push(leg);
      }
    }
  }

  const normalized = {};
  for (const [round, legs] of Object.entries(grouped)) {
    normalized[String(round)] = legs;
  }
  return normalized;
}

function createLineupBucket() {
  return {
    players: [],
    starters: [],
    players_points: {},
    starters_points: {},
    entry_count: 0
  };
}

function pushUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function addPlayerPoints(pointsMap, playerId, points) {
  if (!playerId || !Number.isFinite(points)) return;
  pointsMap[playerId] = roundPoints((pointsMap[playerId] || 0) + points);
}

export function lineupBucketsForRosterPayloads(rosterPayloads) {
  const buckets = new Map();

  for (const entry of rosterPayloads || []) {
    const parsed = entry?.payload || entry;
    const week = Number(entry?.week ?? parsed?.week);
    const teamId = entry?.teamId ?? parsed?.teamId;
    if (!Number.isFinite(week) || teamId == null) continue;

    const key = `${week}:${teamId}`;
    const bucket = buckets.get(key) || createLineupBucket();

    for (const player of parsed?.players || []) {
      const playerId = playerIdForYahooKey(player.player_key);
      if (!playerId) continue;

      pushUnique(bucket.players, playerId);
      addPlayerPoints(bucket.players_points, playerId, player.points);
      bucket.entry_count += 1;

      if (isStarterPosition(player.selected_position)) {
        pushUnique(bucket.starters, playerId);
        addPlayerPoints(bucket.starters_points, playerId, player.points);
      }
    }

    buckets.set(key, bucket);
  }

  return buckets;
}

export function applyLineupsToMatchups(matchupsByWeek, rosterPayloads) {
  const buckets = lineupBucketsForRosterPayloads(rosterPayloads);
  if (!buckets.size) return matchupsByWeek;

  for (const legs of Object.values(matchupsByWeek)) {
    for (const leg of legs) {
      const bucket = buckets.get(`${leg.round}:${leg.roster_id}`);
      if (!bucket) continue;

      leg.players = bucket.players;
      leg.starters = bucket.starters;
      leg.players_points = { ...bucket.players_points };
      leg.starters_points = { ...bucket.starters_points };
      leg.metadata = compactObject({
        ...leg.metadata,
        lineup_source: "yahoo_roster",
        lineup_entry_count: bucket.entry_count.toString()
      });
    }
  }

  return matchupsByWeek;
}

function playerRecordFromYahooFields({ player_key, player_id, name, position, nfl_team }) {
  const playerId = playerIdForYahooKey(player_key);
  if (!playerId) return null;
  return compactObject({
    player_id: playerId,
    full_name: name || playerId,
    position: position || null,
    team: nfl_team || null,
    metadata: compactObject({
      provider: "yahoo",
      yahoo_player_key: player_key,
      yahoo_player_id: player_id?.toString()
    })
  });
}

export function mergePlayerCatalog(...catalogs) {
  const players = {};
  for (const catalog of catalogs) {
    for (const [playerId, record] of Object.entries(catalog || {})) {
      if (!players[playerId]) {
        players[playerId] = record;
        continue;
      }
      players[playerId] = compactObject({
        ...players[playerId],
        ...record,
        metadata: { ...players[playerId].metadata, ...record.metadata }
      });
    }
  }
  return players;
}

export function playersFromRosterPayloads(rosterPayloads) {
  const players = {};

  for (const entry of rosterPayloads || []) {
    const parsed = entry?.payload || entry;
    for (const player of parsed?.players || []) {
      const record = playerRecordFromYahooFields(player);
      if (!record || players[record.player_id]) continue;
      players[record.player_id] = record;
    }
  }

  return players;
}

export function playersFromDraftPicks(draftPicks) {
  const players = {};
  for (const pick of draftPicks || []) {
    const playerId = pick.player_id;
    if (!playerId || players[playerId]) continue;
    players[playerId] = compactObject({
      player_id: playerId,
      full_name: playerId,
      position: null,
      team: null,
      metadata: compactObject({
        provider: "yahoo",
        yahoo_player_key: pick.metadata?.yahoo_player_key,
        source: "draft_pick"
      })
    });
  }
  return players;
}

export function draftDataForSeason({
  leagueId,
  providerLeagueId,
  season,
  teams,
  draftResults,
  draftSettings,
  leagueMetadata
}) {
  const picks = draftResults?.picks || [];
  if (!picks.length) {
    return { draft_id: null, drafts: [], draft_picks: [] };
  }

  const draftId = draftIdFor(providerLeagueId, season);
  const rosterOwners = new Map();
  for (const team of teams || []) {
    const manager = managerForTeam(team);
    const userId = userIdForManager(manager);
    if (team.team_id != null && userId) rosterOwners.set(Number(team.team_id), userId);
  }

  const firstRound = picks.filter((pick) => pick.round === 1).sort((a, b) => a.pick - b.pick);
  const draftOrder = {};
  for (const pick of firstRound) {
    const rosterId = rosterIdFromTeamKey(pick.team_key);
    const userId = rosterId != null ? rosterOwners.get(rosterId) : null;
    if (userId && pick.pick) draftOrder[userId] = pick.pick;
  }

  const rounds = Math.max(...picks.map((pick) => pick.round || 0));
  // Yahoo snake drafts omit `cost`, so a priced pick also marks an auction when settings don't say so.
  const hasPrices = picks.some((pick) => pick.cost != null && Number.isFinite(pick.cost));
  const draftType = draftSettings?.draft_type === "auction" || hasPrices ? "auction" : "snake";
  const status = leagueMetadata?.draft_status === "predraft" ? "pre_draft" : "complete";

  const draft = {
    draft_id: draftId,
    league_id: leagueId,
    sport: "nfl",
    season,
    season_type: "regular",
    type: draftType,
    status,
    start_time: draftSettings?.draft_time || null,
    created: null,
    last_picked: draftSettings?.draft_time || null,
    draft_order: draftOrder,
    settings: compactObject({
      teams: teams?.length,
      rounds,
      budget: draftType === "auction" ? draftSettings?.budget : null,
      pick_timer: draftSettings?.pick_time ? Number(draftSettings.pick_time) : null
    }),
    metadata: compactObject({
      provider: "yahoo",
      yahoo_draft_status: leagueMetadata?.draft_status,
      yahoo_pick_fields: draftResults?.pick_fields,
      yahoo_picks_priced: hasPrices,
      scoring_type: leagueMetadata?.scoring_type
    })
  };

  const draftPicks = picks.map((pick) => {
    const rosterId = rosterIdFromTeamKey(pick.team_key);
    const playerId = playerIdForYahooKey(pick.player_key);
    const picksInRound = picks.filter((entry) => entry.round === pick.round);
    const slotInRound = picksInRound.findIndex((entry) => entry.pick === pick.pick) + 1;
    return {
      draft_id: draftId,
      pick_no: pick.pick,
      round: pick.round,
      draft_slot: slotInRound > 0 ? slotInRound : null,
      roster_id: rosterId,
      picked_by: rosterId != null ? rosterOwners.get(rosterId) || null : null,
      player_id: playerId,
      is_keeper: false,
      amount: draftType === "auction" && pick.cost != null ? pick.cost : undefined,
      metadata: compactObject({
        provider: "yahoo",
        yahoo_player_key: pick.player_key,
        yahoo_team_key: pick.team_key,
        bid_amount: draftType === "auction" && pick.cost != null ? String(pick.cost) : undefined
      })
    };
  });

  return { draft_id: draftId, drafts: [draft], draft_picks: draftPicks };
}

function standingsForSeason(teams, leagueId) {
  return teams
    .slice()
    .sort((a, b) => asNumber(a.team_standings?.rank, 999) - asNumber(b.team_standings?.rank, 999))
    .map((team, index) => {
      const standings = team.team_standings || {};
      const outcomes = standings.outcome_totals || {};
      const wins = asNumber(outcomes.wins);
      const losses = asNumber(outcomes.losses);
      const ties = asNumber(outcomes.ties);

      return {
        league_id: leagueId,
        round: 0,
        roster_id: asNumber(team.team_id, index + 1),
        rank: asNumber(standings.rank, index + 1),
        points: roundPoints(standings.points_for ?? team.team_points?.total),
        points_against: roundPoints(standings.points_against),
        wins,
        losses,
        ties,
        record: ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`,
        metadata: {
          provider: "yahoo",
          type: "final"
        }
      };
    });
}

function normalizeSeason({
  providerLeagueId,
  bundle,
  sortedSeasons,
  historyDetail = "standings_only",
  scoreboardsByWeek = null,
  rosterPayloads = null,
  draftResults = null,
  draftSettings = null
}) {
  const metadata = bundle.metadata || {};
  const season = String(metadata.season);
  const leagueId = leagueIdFor(providerLeagueId, season);
  const previousSeason = sortedSeasons[sortedSeasons.indexOf(season) - 1];
  const teams = mergeSeasonTeams(bundle);

  const hasMatchups = Boolean(
    scoreboardsByWeek &&
      Object.values(scoreboardsByWeek).some((scoreboard) => scoreboard?.matchups?.length)
  );
  const hasLineups = Boolean(rosterPayloads?.length);
  const resolvedHistoryDetail = hasMatchups ? (hasLineups ? "full" : "standings_and_matchups") : historyDetail;

  let matchupsByWeek = {};
  if (hasMatchups) {
    matchupsByWeek = applyLineupsToMatchups(
      matchupsByWeekFromScoreboards(scoreboardsByWeek, leagueId),
      rosterPayloads
    );
  }

  const draftBundle = draftDataForSeason({
    leagueId,
    providerLeagueId,
    season,
    teams,
    draftResults,
    draftSettings,
    leagueMetadata: metadata
  });
  const players = mergePlayerCatalog(
    hasLineups ? playersFromRosterPayloads(rosterPayloads) : {},
    playersFromDraftPicks(draftBundle.draft_picks)
  );

  const league = {
    league_id: leagueId,
    previous_league_id: previousSeason ? leagueIdFor(providerLeagueId, previousSeason) : null,
    name: metadata.name || "Yahoo Import",
    sport: "nfl",
    season,
    season_type: "regular",
    status: leagueStatusFromMetadata(metadata),
    draft_id: draftBundle.draft_id,
    total_rosters: asNumber(metadata.num_teams, teams.length),
    roster_positions: [],
    scoring_settings: {},
    settings: {},
    metadata: compactObject({
      provider: "yahoo",
      yahoo_league_id: providerLeagueId,
      yahoo_league_key: metadata.league_key,
      yahoo_season: season,
      scoring_type: metadata.scoring_type,
      scoring_label: metadata.scoring_label,
      history_detail: resolvedHistoryDetail
    })
  };

  return {
    league,
    users: usersForSeason(teams, leagueId),
    rosters: rostersForSeason(teams, leagueId),
    standings: standingsForSeason(teams, leagueId),
    matchups_by_week: matchupsByWeek,
    drafts: draftBundle.drafts,
    draft_picks: draftBundle.draft_picks,
    players,
    raw_refs: {
      league_core: `rawResponses/yahoo/nfl/${providerLeagueId}/${season}/core`
    }
  };
}

export function relinkYahooSeasonChain(seasons, providerLeagueId) {
  const sortedSeasons = Object.keys(seasons || {}).sort((a, b) => Number(a) - Number(b));
  for (let index = 0; index < sortedSeasons.length; index += 1) {
    const season = sortedSeasons[index];
    const seasonData = seasons[season];
    if (!seasonData?.league) continue;
    seasonData.league.league_id = leagueIdFor(providerLeagueId, season);
    seasonData.league.previous_league_id =
      index > 0 ? leagueIdFor(providerLeagueId, sortedSeasons[index - 1]) : null;
    if (!seasonData.league.draft_id && seasonData.drafts?.length) {
      seasonData.league.draft_id = draftIdFor(providerLeagueId, season);
    }
  }
  return sortedSeasons;
}

function archiveSeasonFlags(seasons) {
  let anyMatchups = false;
  let anyLineups = false;
  for (const seasonData of Object.values(seasons || {})) {
    const scoreboards = seasonData.matchups_by_week || {};
    if (Object.values(scoreboards).some((week) => week?.length)) {
      anyMatchups = true;
    }
    if (seasonData.metadata?.lineup_enrichment === "yahoo_roster") {
      anyLineups = true;
    }
    for (const week of Object.values(scoreboards)) {
      for (const leg of week || []) {
        if (leg?.metadata?.lineup_source === "yahoo_roster") {
          anyLineups = true;
          break;
        }
      }
      if (anyLineups) break;
    }
  }
  return { anyMatchups, anyLineups };
}

export function buildYahooArchiveSummary(seasons) {
  const sortedSeasons = Object.keys(seasons || {}).sort((a, b) => Number(a) - Number(b));
  const latestKey = sortedSeasons[sortedSeasons.length - 1];
  const latestSeason = latestKey ? seasons[latestKey] : null;
  const standingsOnlySeasons = sortedSeasons.filter((season) => {
    const detail = seasons[season]?.league?.metadata?.history_detail;
    return detail === "standings_only";
  });
  const fullSeasons = sortedSeasons.filter((season) => seasons[season]?.league?.metadata?.history_detail === "full");

  return {
    seasons: sortedSeasons,
    total_seasons: sortedSeasons.length,
    total_rosters: latestSeason?.league?.total_rosters || 0,
    score_storage: "custom_points",
    lineup_enrichment: "not_requested",
    history_coverage: {
      full_seasons: fullSeasons,
      standings_only_seasons: standingsOnlySeasons.length
        ? standingsOnlySeasons
        : sortedSeasons.filter((season) => !fullSeasons.includes(season))
    }
  };
}

function yahooArchiveMetadata(seasons, { historyDetail = "standings_only" } = {}) {
  const { anyMatchups, anyLineups } = archiveSeasonFlags(seasons);
  return {
    provider: "yahoo",
    history_detail: anyMatchups ? (anyLineups ? "full" : "standings_and_matchups") : historyDetail,
    import_phase: anyMatchups ? "matchups_and_lineups" : "standings_slice",
    lineup_enrichment: anyLineups ? "yahoo_roster" : "not_requested"
  };
}

export function mergeYahooImportIntoArchive(existingArchive, { providerLeagueId, seasonBundles }) {
  const delta = normalizeYahooImport({ providerLeagueId, seasonBundles });
  if (!existingArchive?.seasons || !Object.keys(existingArchive.seasons).length) {
    return delta;
  }

  const mergedSeasons = { ...existingArchive.seasons, ...delta.seasons };
  relinkYahooSeasonChain(mergedSeasons, providerLeagueId);
  const sortedSeasons = Object.keys(mergedSeasons).sort((a, b) => Number(a) - Number(b));
  const latestKey = sortedSeasons[sortedSeasons.length - 1];
  const latestSeason = mergedSeasons[latestKey];

  const merged = {
    ...existingArchive,
    schema_version: 1,
    provider: "yahoo",
    sport: "nfl",
    import_id: existingArchive.import_id || delta.import_id,
    provider_league_id: providerLeagueId,
    name: latestSeason?.league?.name || existingArchive.name || delta.name,
    imported_at: existingArchive.imported_at || delta.imported_at,
    updated_at: new Date().toISOString(),
    seasons: mergedSeasons,
    summary: buildYahooArchiveSummary(mergedSeasons),
    raw_refs: { ...existingArchive.raw_refs, ...delta.raw_refs },
    metadata: yahooArchiveMetadata(mergedSeasons)
  };

  return merged;
}

export function normalizeYahooImport({
  providerLeagueId,
  seasonBundles,
  historyDetail = "standings_only"
}) {
  const now = new Date().toISOString();
  const sortedSeasons = seasonBundles
    .map((bundle) => String(bundle.metadata?.season))
    .filter(Boolean)
    .sort();

  const seasons = {};
  let anyMatchups = false;
  let anyLineups = false;

  for (const bundle of seasonBundles) {
    const season = String(bundle.metadata?.season);
    const scoreboardsByWeek = bundle.yahooScoreboardsByWeek || null;
    const rosterPayloads = bundle.yahooRosterPayloads || null;
    const draftResults = bundle.yahooDraftResults || null;
    const draftSettings = bundle.yahooDraftSettings || null;
    if (
      scoreboardsByWeek &&
      Object.values(scoreboardsByWeek).some((scoreboard) => scoreboard?.matchups?.length)
    ) {
      anyMatchups = true;
    }
    if (rosterPayloads?.length) anyLineups = true;

    seasons[season] = normalizeSeason({
      providerLeagueId,
      bundle,
      sortedSeasons,
      historyDetail,
      scoreboardsByWeek,
      rosterPayloads,
      draftResults,
      draftSettings
    });
  }

  relinkYahooSeasonChain(seasons, providerLeagueId);

  const importId = `yahoo:nfl:${providerLeagueId}`;
  const latestSeason = seasons[sortedSeasons[sortedSeasons.length - 1]];

  return {
    schema_version: 1,
    provider: "yahoo",
    sport: "nfl",
    import_id: importId,
    provider_league_id: providerLeagueId,
    name: latestSeason?.league?.name || "Yahoo Import",
    imported_at: now,
    updated_at: now,
    seasons,
    summary: buildYahooArchiveSummary(seasons),
    raw_refs: {
      discovery: `rawResponses/yahoo/nfl/${providerLeagueId}/discovery`
    },
    metadata: {
      provider: "yahoo",
      history_detail: anyMatchups ? (anyLineups ? "full" : "standings_and_matchups") : historyDetail,
      import_phase: anyMatchups ? "matchups_and_lineups" : "standings_slice",
      lineup_enrichment: anyLineups ? "yahoo_roster" : "not_requested"
    }
  };
}
