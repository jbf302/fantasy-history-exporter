// Sleeper → export format (docs/export-format.md). The export format borrows
// Sleeper's own field names, so most of this is id prefixing and filling in
// what Sleeper leaves implicit (final ranks, playoff flags, winners).
import {
  asNumber,
  buildArchive,
  compactObject,
  historyDetailFor,
  matchupLeg,
  recordString,
  roundPoints,
  seasonDraftId,
  seasonLeagueId
} from "./archive-utils.js";

const PROVIDER = "sleeper";
const LINEUP_SOURCE = "sleeper_matchups";

export function sleeperPlayerId(id) {
  return id == null || id === "" || id === "0" ? null : `sleeper:${id}`;
}

function sleeperUserId(id) {
  return id == null || id === "" ? null : `sleeper_user:${id}`;
}

function mapIds(list, toId) {
  return (list || []).map(toId).filter(Boolean);
}

function decimalPoints(whole, decimal) {
  return roundPoints(asNumber(whole) + asNumber(decimal) / 100);
}

function rosterRecord(roster) {
  const settings = roster.settings || {};
  return {
    wins: asNumber(settings.wins),
    losses: asNumber(settings.losses),
    ties: asNumber(settings.ties),
    fpts: decimalPoints(settings.fpts, settings.fpts_decimal),
    fpts_against: decimalPoints(settings.fpts_against, settings.fpts_against_decimal)
  };
}

function compareRecords(a, b) {
  return b.wins - a.wins || b.ties - a.ties || b.fpts - a.fpts;
}

/**
 * Final place for every roster. Placement games in the winners bracket (`p`: 1
 * for the final, 3 for third place, ...) decide the top spots; everyone else is
 * ordered by how deep they went in the playoffs, then regular-season record.
 */
export function sleeperFinalRanks(rosters, winnersBracket) {
  const placed = new Map();
  const deepestRound = new Map();
  for (const game of winnersBracket || []) {
    for (const team of [game.t1, game.t2]) {
      if (team == null) continue;
      deepestRound.set(Number(team), Math.max(deepestRound.get(Number(team)) || 0, asNumber(game.r)));
    }
    const place = asNumber(game.p, 0);
    if (!place || game.w == null || game.l == null) continue;
    placed.set(Number(game.w), place);
    placed.set(Number(game.l), place + 1);
  }

  const taken = new Set(placed.values());
  const ranks = new Map(placed);
  const rest = rosters
    .filter((roster) => !placed.has(Number(roster.roster_id)))
    .sort(
      (a, b) =>
        (deepestRound.get(Number(b.roster_id)) || 0) - (deepestRound.get(Number(a.roster_id)) || 0) ||
        compareRecords(rosterRecord(a), rosterRecord(b))
    );
  let next = 1;
  for (const roster of rest) {
    while (taken.has(next)) next += 1;
    ranks.set(Number(roster.roster_id), next);
    taken.add(next);
  }
  return ranks;
}

function pairKey(a, b) {
  return [Number(a), Number(b)].sort((x, y) => x - y).join("-");
}

/** Pair key → "playoffs" | "consolation" for each bracket game. */
function bracketGames(winnersBracket, losersBracket) {
  const games = new Map();
  for (const game of losersBracket || []) {
    if (game.t1 != null && game.t2 != null) games.set(pairKey(game.t1, game.t2), "consolation");
  }
  for (const game of winnersBracket || []) {
    if (game.t1 == null || game.t2 == null) continue;
    // A placement game below first (third place, fifth place, ...) is a consolation game.
    games.set(pairKey(game.t1, game.t2), asNumber(game.p, 1) > 1 ? "consolation" : "playoffs");
  }
  return games;
}

function lineupFromMatchup(matchup) {
  const starters = mapIds(matchup.starters, sleeperPlayerId);
  const startersPoints = {};
  (matchup.starters || []).forEach((id, index) => {
    const playerId = sleeperPlayerId(id);
    const points = matchup.starters_points?.[index] ?? matchup.players_points?.[id];
    if (playerId && points != null) startersPoints[playerId] = roundPoints(points);
  });
  const playersPoints = {};
  for (const [id, points] of Object.entries(matchup.players_points || {})) {
    const playerId = sleeperPlayerId(id);
    if (playerId) playersPoints[playerId] = roundPoints(points);
  }
  return {
    players: mapIds(matchup.players, sleeperPlayerId),
    starters,
    players_points: playersPoints,
    starters_points: startersPoints
  };
}

function matchupScore(matchup) {
  return roundPoints(matchup.custom_points ?? matchup.points);
}

export function sleeperMatchupsByWeek({ matchupsByWeek, league, leagueId, winnersBracket, losersBracket }) {
  const playoffStart = asNumber(league?.settings?.playoff_week_start, 0);
  const games = bracketGames(winnersBracket, losersBracket);
  const currentWeek = asNumber(league?.settings?.leg, 0);
  const finished = (week) => league?.status === "complete" || (currentWeek && week < currentWeek);
  const result = {};

  for (const [weekKey, matchups] of Object.entries(matchupsByWeek || {})) {
    const week = Number(weekKey);
    const byMatchup = new Map();
    for (const matchup of matchups || []) {
      if (matchup.matchup_id == null) continue;
      const list = byMatchup.get(matchup.matchup_id) || [];
      list.push(matchup);
      byMatchup.set(matchup.matchup_id, list);
    }

    const legs = [];
    for (const [matchupId, sides] of [...byMatchup.entries()].sort((a, b) => a[0] - b[0])) {
      const isPlayoffs = playoffStart > 0 && week >= playoffStart;
      const pair = sides.length === 2 ? pairKey(sides[0].roster_id, sides[1].roster_id) : null;
      // In playoff weeks, games outside the winners bracket are consolation games.
      const isConsolation = isPlayoffs && games.get(pair) !== "playoffs";

      for (const side of sides) {
        const opponent = sides.length === 2 ? sides.find((other) => other !== side) : null;
        const points = matchupScore(side);
        let won = null;
        if (opponent && finished(week)) {
          const theirs = matchupScore(opponent);
          won = points === theirs ? null : points > theirs ? "true" : "false";
        }
        legs.push(
          matchupLeg({
            leagueId,
            round: week,
            matchupId,
            rosterId: Number(side.roster_id),
            points,
            lineup: lineupFromMatchup(side),
            metadata: {
              provider: PROVIDER,
              opponent_roster_id: opponent?.roster_id?.toString(),
              won_matchup: won,
              is_playoffs: isPlayoffs ? "1" : "0",
              is_consolation: isConsolation ? "1" : "0",
              score_source: side.custom_points != null ? "sleeper_custom_points" : "sleeper_points",
              lineup_source: LINEUP_SOURCE,
              lineup_entry_count: String((side.players || []).length)
            }
          })
        );
      }
    }
    if (legs.length) result[String(week)] = legs;
  }
  return result;
}

function draftsForSeason({ drafts, providerLeagueId, season, leagueId, league }) {
  const out = { draft_id: null, drafts: [], draft_picks: [] };
  const sorted = (drafts || [])
    .slice()
    .sort((a, b) => (a.draft.draft_id === league?.draft_id ? -1 : b.draft.draft_id === league?.draft_id ? 1 : 0));

  sorted.forEach(({ draft, picks }, index) => {
    const draftId =
      index === 0 ? seasonDraftId(PROVIDER, providerLeagueId, season) : `${seasonDraftId(PROVIDER, providerLeagueId, season)}:${index + 1}`;
    const type = draft.type === "auction" ? "auction" : draft.type === "linear" ? "linear" : "snake";
    if (index === 0) out.draft_id = draftId;

    out.drafts.push({
      draft_id: draftId,
      league_id: leagueId,
      sport: "nfl",
      season,
      season_type: draft.season_type || "regular",
      type,
      status: draft.status === "complete" ? "complete" : draft.status || "pre_draft",
      start_time: draft.start_time ?? null,
      created: draft.created ?? null,
      last_picked: draft.last_picked ?? null,
      draft_order: Object.fromEntries(
        Object.entries(draft.draft_order || {}).map(([userId, slot]) => [sleeperUserId(userId), slot])
      ),
      settings: compactObject({
        teams: draft.settings?.teams,
        rounds: draft.settings?.rounds,
        budget: type === "auction" ? draft.settings?.budget : null,
        pick_timer: draft.settings?.pick_timer
      }),
      metadata: compactObject({ provider: PROVIDER, sleeper_draft_id: draft.draft_id })
    });

    for (const pick of picks || []) {
      const amount = type === "auction" && pick.metadata?.amount != null ? asNumber(pick.metadata.amount, null) : null;
      out.draft_picks.push({
        draft_id: draftId,
        pick_no: pick.pick_no,
        round: pick.round,
        draft_slot: pick.draft_slot ?? null,
        roster_id: pick.roster_id ?? null,
        picked_by: sleeperUserId(pick.picked_by),
        player_id: sleeperPlayerId(pick.player_id),
        is_keeper: Boolean(pick.is_keeper),
        amount: amount ?? undefined,
        metadata: compactObject({ provider: PROVIDER, sleeper_player_id: pick.player_id })
      });
    }
  });
  return out;
}

function playerRecord(playerId, sleeperId, catalog, pickMetadata) {
  const known = catalog?.[sleeperId];
  const name =
    known?.full_name ||
    [known?.first_name, known?.last_name].filter(Boolean).join(" ") ||
    [pickMetadata?.first_name, pickMetadata?.last_name].filter(Boolean).join(" ") ||
    playerId;
  return compactObject({
    player_id: playerId,
    full_name: name,
    position: known?.position || pickMetadata?.position || null,
    team: known?.team || pickMetadata?.team || null,
    metadata: compactObject({ provider: PROVIDER, sleeper_player_id: sleeperId })
  });
}

function playersForSeason({ bundle, matchups, draftPicks, catalog }) {
  const pickMetadata = new Map();
  for (const { picks } of bundle.drafts || []) {
    for (const pick of picks || []) pickMetadata.set(String(pick.player_id), pick.metadata);
  }
  const ids = new Set();
  for (const legs of Object.values(matchups)) for (const leg of legs) leg.players.forEach((id) => ids.add(id));
  for (const roster of bundle.rosters || []) mapIds(roster.players, sleeperPlayerId).forEach((id) => ids.add(id));
  for (const pick of draftPicks) if (pick.player_id) ids.add(pick.player_id);

  const players = {};
  for (const playerId of [...ids].sort()) {
    const sleeperId = playerId.slice(`${PROVIDER}:`.length);
    players[playerId] = playerRecord(playerId, sleeperId, catalog, pickMetadata.get(sleeperId));
  }
  return players;
}

function leagueStatus(status) {
  if (status === "complete") return "complete";
  if (status === "in_season" || status === "post_season") return "in_season";
  return "pre_draft";
}

function normalizeSeason({ providerLeagueId, bundle, catalog }) {
  const league = bundle.league || {};
  const season = String(league.season);
  const leagueId = seasonLeagueId(PROVIDER, providerLeagueId, season);
  const rosters = bundle.rosters || [];
  const usersById = new Map((bundle.users || []).map((user) => [String(user.user_id), user]));
  const ranks = sleeperFinalRanks(rosters, bundle.winnersBracket);
  const teamName = (roster) => usersById.get(String(roster.owner_id))?.metadata?.team_name || null;

  const matchups = sleeperMatchupsByWeek({
    matchupsByWeek: bundle.matchupsByWeek,
    league,
    leagueId,
    winnersBracket: bundle.winnersBracket,
    losersBracket: bundle.losersBracket
  });
  const draftBundle = draftsForSeason({ drafts: bundle.drafts, providerLeagueId, season, leagueId, league });

  const users = (bundle.users || []).map((user) => ({
    league_id: leagueId,
    user_id: sleeperUserId(user.user_id),
    display_name: user.display_name || `User ${user.user_id}`,
    avatar: user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : null,
    is_bot: Boolean(user.is_bot),
    is_owner: Boolean(user.is_owner),
    settings: {},
    metadata: compactObject({ provider: PROVIDER, sleeper_user_id: String(user.user_id), team_name: user.metadata?.team_name })
  }));

  const normalizedRosters = rosters.map((roster) => {
    const record = rosterRecord(roster);
    return {
      league_id: leagueId,
      roster_id: Number(roster.roster_id),
      owner_id: sleeperUserId(roster.owner_id),
      co_owners: mapIds(roster.co_owners, sleeperUserId),
      players: mapIds(roster.players, sleeperPlayerId),
      starters: mapIds(roster.starters, sleeperPlayerId),
      reserve: mapIds(roster.reserve, sleeperPlayerId),
      taxi: mapIds(roster.taxi, sleeperPlayerId),
      keepers: mapIds(roster.keepers, sleeperPlayerId),
      settings: compactObject({ ...record, rank: ranks.get(Number(roster.roster_id)) }),
      metadata: compactObject({ provider: PROVIDER, team_name: teamName(roster), sleeper_league_id: String(league.league_id) })
    };
  });

  const standings = normalizedRosters
    .slice()
    .sort((a, b) => a.settings.rank - b.settings.rank)
    .map((roster) => {
      const { wins, losses, ties, fpts, fpts_against: against } = roster.settings;
      return {
        league_id: leagueId,
        round: 0,
        roster_id: roster.roster_id,
        rank: roster.settings.rank,
        points: fpts,
        points_against: against,
        wins,
        losses,
        ties,
        record: recordString(wins, losses, ties),
        metadata: { provider: PROVIDER, type: league.status === "complete" ? "final" : "current" }
      };
    });

  const historyDetail = historyDetailFor(matchups, LINEUP_SOURCE);
  return {
    league: {
      league_id: leagueId,
      previous_league_id: null,
      name: league.name || "Sleeper League",
      sport: "nfl",
      season,
      season_type: league.season_type || "regular",
      status: leagueStatus(league.status),
      draft_id: draftBundle.draft_id,
      total_rosters: asNumber(league.total_rosters, rosters.length),
      roster_positions: league.roster_positions || [],
      scoring_settings: league.scoring_settings || {},
      settings: league.settings || {},
      metadata: compactObject({
        provider: PROVIDER,
        sleeper_league_id: String(league.league_id),
        sleeper_previous_league_id: league.previous_league_id || null,
        history_detail: historyDetail
      })
    },
    users,
    rosters: normalizedRosters,
    standings,
    matchups_by_week: matchups,
    drafts: draftBundle.drafts,
    draft_picks: draftBundle.draft_picks,
    players: playersForSeason({ bundle, matchups, draftPicks: draftBundle.draft_picks, catalog })
  };
}

/**
 * `providerLeagueId` is the newest season's Sleeper league id (Sleeper gives
 * every season a new id). `players` is the optional /players/nfl catalog.
 */
export function normalizeSleeperImport({ providerLeagueId, seasonBundles, players = null }) {
  const seasons = {};
  for (const bundle of seasonBundles) {
    seasons[String(bundle.league.season)] = normalizeSeason({ providerLeagueId, bundle, catalog: players });
  }
  return buildArchive({ provider: PROVIDER, providerLeagueId, seasons, lineupSource: LINEUP_SOURCE });
}
