// ESPN → export format (docs/export-format.md).
//
// Rounds are NFL weeks (ESPN "scoring periods"), as with Yahoo and Sleeper. When
// an ESPN matchup spans two weeks (common for playoff rounds), each week gets
// its own leg with that week's points, and the leg's metadata carries the
// matchup period, its total, and who won it.
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
import {
  ESPN_BENCH_SLOT,
  ESPN_IR_SLOT,
  ESPN_LINEUP_SLOTS,
  ESPN_POSITIONS,
  ESPN_PRO_TEAMS,
  espnMatchupPeriods,
  espnScoringPeriods
} from "./espn-api.js";

const PROVIDER = "espn";
const LINEUP_SOURCE = "espn_boxscore";

export function espnPlayerId(id) {
  return id == null || id === "" ? null : `espn:${id}`;
}

/** ESPN member ids are GUIDs in braces: "{E29D...}". */
export function espnUserId(memberId) {
  const id = String(memberId || "").replace(/[{}]/g, "");
  return id ? `espn_user:${id}` : null;
}

function teamName(team) {
  return team.name || [team.location, team.nickname].filter(Boolean).join(" ").trim() || `Team ${team.id}`;
}

function teamOwners(team) {
  const owners = (team.owners || []).map((owner) => (typeof owner === "string" ? owner : owner?.id)).filter(Boolean);
  const primary = team.primaryOwner || owners[0] || null;
  return { primary, others: owners.filter((owner) => owner !== primary) };
}

function overallRecord(team) {
  const overall = team.record?.overall || {};
  return {
    wins: asNumber(overall.wins),
    losses: asNumber(overall.losses),
    ties: asNumber(overall.ties),
    fpts: roundPoints(overall.pointsFor ?? team.points),
    fpts_against: roundPoints(overall.pointsAgainst)
  };
}

/** Final rank when ESPN has one, otherwise playoff seed, otherwise record. */
export function espnRanks(teams) {
  const ranks = new Map();
  const taken = new Set();
  for (const team of teams) {
    const rank = asNumber(team.rankCalculatedFinal, 0) || asNumber(team.rankFinal, 0) || asNumber(team.playoffSeed, 0);
    if (rank && !taken.has(rank)) {
      ranks.set(team.id, rank);
      taken.add(rank);
    }
  }
  const rest = teams
    .filter((team) => !ranks.has(team.id))
    .sort((a, b) => {
      const x = overallRecord(a);
      const y = overallRecord(b);
      return y.wins - x.wins || y.ties - x.ties || y.fpts - x.fpts;
    });
  let next = 1;
  for (const team of rest) {
    while (taken.has(next)) next += 1;
    ranks.set(team.id, next);
    taken.add(next);
  }
  return ranks;
}

function lineupBuckets(lineups) {
  const buckets = new Map();
  for (const lineup of lineups || []) {
    const bucket = { players: [], starters: [], players_points: {}, starters_points: {}, entry_count: 0 };
    for (const entry of lineup.entries || []) {
      const playerId = espnPlayerId(entry.playerId);
      if (!playerId) continue;
      const points = entry.points == null ? null : roundPoints(entry.points);
      if (!bucket.players.includes(playerId)) bucket.players.push(playerId);
      if (points != null) bucket.players_points[playerId] = points;
      bucket.entry_count += 1;
      if (entry.slotId !== ESPN_BENCH_SLOT && entry.slotId !== ESPN_IR_SLOT) {
        if (!bucket.starters.includes(playerId)) bucket.starters.push(playerId);
        if (points != null) bucket.starters_points[playerId] = points;
      }
    }
    buckets.set(`${lineup.week}:${lineup.teamId}`, bucket);
  }
  return buckets;
}

function sidePoints(side, week, weeksInPeriod) {
  const byWeek = side?.pointsByScoringPeriod;
  if (byWeek && byWeek[week] != null) return roundPoints(byWeek[week]);
  return weeksInPeriod.length === 1 ? roundPoints(side?.totalPoints) : 0;
}

function wonMatchup(winner, isHome) {
  if (winner === "HOME") return isHome ? "true" : "false";
  if (winner === "AWAY") return isHome ? "false" : "true";
  return null;
}

export function espnMatchupsByWeek({ core, schedule, lineups, leagueId }) {
  const periods = espnMatchupPeriods(core, schedule);
  const playedWeeks = new Set(espnScoringPeriods(core, schedule));
  const buckets = lineupBuckets(lineups);
  const result = {};

  const ordered = (schedule || []).slice().sort((a, b) => a.matchupPeriodId - b.matchupPeriodId || a.id - b.id);
  for (const matchup of ordered) {
    // Byes (no away team) aren't matchups; Yahoo and Sleeper leave them out too.
    if (matchup.home?.teamId == null || matchup.away?.teamId == null) continue;
    const weeks = periods[String(matchup.matchupPeriodId)] || [Number(matchup.matchupPeriodId)];
    const tier = matchup.playoffTierType || "NONE";
    const isPlayoffs = tier !== "NONE";
    const isConsolation = isPlayoffs && tier !== "WINNERS_BRACKET";

    for (const week of weeks) {
      if (!playedWeeks.has(week)) continue;
      const legs = (result[String(week)] ||= []);
      const matchupId = legs.reduce((max, leg) => Math.max(max, leg.matchup_id), 0) + 1;

      for (const [side, other, isHome] of [
        [matchup.home, matchup.away, true],
        [matchup.away, matchup.home, false]
      ]) {
        const bucket = buckets.get(`${week}:${side.teamId}`);
        legs.push(
          matchupLeg({
            leagueId,
            round: week,
            matchupId,
            rosterId: Number(side.teamId),
            points: sidePoints(side, week, weeks),
            lineup: bucket,
            metadata: compactObject({
              provider: PROVIDER,
              opponent_roster_id: String(other.teamId),
              won_matchup: wonMatchup(matchup.winner, isHome),
              is_playoffs: isPlayoffs ? "1" : "0",
              is_consolation: isConsolation ? "1" : "0",
              playoff_tier: isPlayoffs ? tier : null,
              espn_matchup_id: matchup.id?.toString(),
              matchup_period: String(matchup.matchupPeriodId),
              matchup_weeks: weeks.length > 1 ? weeks.join(",") : null,
              matchup_total_points: weeks.length > 1 ? String(roundPoints(side.totalPoints)) : null,
              score_source: "espn_points_by_scoring_period",
              lineup_source: bucket ? LINEUP_SOURCE : null,
              lineup_entry_count: bucket ? String(bucket.entry_count) : null
            })
          })
        );
      }
    }
  }
  return result;
}

function draftForSeason({ draftDetail, settings, providerLeagueId, season, leagueId, ownerByTeam, teamCount }) {
  const picks = draftDetail?.picks || [];
  if (!picks.length) return { draft_id: null, drafts: [], draft_picks: [] };

  const draftId = seasonDraftId(PROVIDER, providerLeagueId, season);
  const draftSettings = settings?.draftSettings || {};
  const hasBids = picks.some((pick) => asNumber(pick.bidAmount, 0) > 0);
  const type = draftSettings.type === "AUCTION" || hasBids ? "auction" : draftSettings.type === "OFFLINE" ? "offline" : "snake";

  const draftOrder = {};
  (draftSettings.pickOrder || []).forEach((teamId, index) => {
    const owner = ownerByTeam.get(teamId);
    if (owner) draftOrder[owner] = index + 1;
  });

  return {
    draft_id: draftId,
    drafts: [
      {
        draft_id: draftId,
        league_id: leagueId,
        sport: "nfl",
        season,
        season_type: "regular",
        type,
        status: draftDetail.drafted ? "complete" : draftDetail.inProgress ? "drafting" : "pre_draft",
        start_time: draftSettings.date ?? null,
        created: null,
        last_picked: draftDetail.completeDate ?? null,
        draft_order: draftOrder,
        settings: compactObject({
          teams: teamCount,
          rounds: Math.max(...picks.map((pick) => asNumber(pick.roundId))),
          budget: type === "auction" ? draftSettings.auctionBudget : null,
          pick_timer: draftSettings.timePerSelection
        }),
        metadata: compactObject({ provider: PROVIDER, espn_draft_type: draftSettings.type, keeper_count: draftSettings.keeperCount })
      }
    ],
    draft_picks: picks
      .slice()
      .sort((a, b) => a.overallPickNumber - b.overallPickNumber)
      .map((pick) => ({
        draft_id: draftId,
        pick_no: pick.overallPickNumber,
        round: pick.roundId,
        draft_slot: pick.roundPickNumber ?? null,
        roster_id: pick.teamId ?? null,
        picked_by: ownerByTeam.get(pick.teamId) || null,
        player_id: espnPlayerId(pick.playerId),
        is_keeper: Boolean(pick.keeper),
        amount: type === "auction" ? asNumber(pick.bidAmount, 0) : undefined,
        metadata: compactObject({
          provider: PROVIDER,
          espn_player_id: pick.playerId?.toString(),
          nominating_team_id: type === "auction" ? pick.nominatingTeamId?.toString() : null
        })
      }))
  };
}

function playerRecord(espnId, info) {
  const playerId = espnPlayerId(espnId);
  return compactObject({
    player_id: playerId,
    full_name: info?.fullName || playerId,
    position: ESPN_POSITIONS[info?.positionId] || null,
    team: ESPN_PRO_TEAMS[info?.proTeamId] || null,
    metadata: compactObject({ provider: PROVIDER, espn_player_id: String(espnId) })
  });
}

/** ESPN player ids in this season's lineups and draft that have no name yet. */
export function espnPlayerIdsMissingNames(bundle) {
  const named = new Set();
  for (const lineup of bundle.lineups || []) {
    for (const entry of lineup.entries) if (entry.fullName) named.add(String(entry.playerId));
  }
  for (const id of Object.keys(bundle.players || {})) named.add(String(id));
  const missing = new Set();
  for (const pick of bundle.draftDetail?.picks || []) {
    if (pick.playerId != null && !named.has(String(pick.playerId))) missing.add(Number(pick.playerId));
  }
  return [...missing];
}

function playersForSeason(bundle) {
  const info = new Map();
  for (const lineup of bundle.lineups || []) {
    for (const entry of lineup.entries) if (entry.fullName) info.set(String(entry.playerId), entry);
  }
  for (const [id, player] of Object.entries(bundle.players || {})) info.set(String(id), player);

  const ids = new Set(info.keys());
  for (const pick of bundle.draftDetail?.picks || []) if (pick.playerId != null) ids.add(String(pick.playerId));

  const players = {};
  for (const id of [...ids].sort((a, b) => Number(a) - Number(b))) {
    players[espnPlayerId(id)] = playerRecord(id, info.get(id));
  }
  return players;
}

// The order ESPN's lineup page lists slots in: offense, flex, IDP, D/ST, K, P, HC, bench, IR.
const SLOT_DISPLAY_ORDER = [0, 1, 2, 4, 6, 3, 5, 23, 7, 24, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

function rosterPositions(settings) {
  const counts = settings?.rosterSettings?.lineupSlotCounts || {};
  const order = (slot) => {
    const index = SLOT_DISPLAY_ORDER.indexOf(Number(slot));
    return index === -1 ? 500 + Number(slot) : index;
  };
  const positions = [];
  for (const [slot, count] of Object.entries(counts).sort((a, b) => order(a[0]) - order(b[0]))) {
    const name = ESPN_LINEUP_SLOTS[slot] || `SLOT_${slot}`;
    for (let index = 0; index < count; index += 1) positions.push(name);
  }
  return positions;
}

function leagueStatus(core, draftDetail) {
  const status = core?.status || {};
  if (draftDetail && draftDetail.drafted === false) return "pre_draft";
  const final = Number(status.finalScoringPeriod);
  const latest = Number(status.latestScoringPeriod);
  if (status.isActive === false || status.isExpired || (final && latest > final)) return "complete";
  return "in_season";
}

function normalizeSeason({ providerLeagueId, bundle }) {
  const core = bundle.core || {};
  const season = String(bundle.season || core.seasonId);
  const leagueId = seasonLeagueId(PROVIDER, providerLeagueId, season);
  const teams = core.teams || [];
  const ranks = espnRanks(teams);
  const ownerByTeam = new Map(teams.map((team) => [team.id, espnUserId(teamOwners(team).primary)]));
  const status = leagueStatus(core, bundle.draftDetail);

  const ownerIds = new Set(teams.flatMap((team) => team.owners || []).map((owner) => (typeof owner === "string" ? owner : owner?.id)));
  const users = (core.members || [])
    .filter((member) => ownerIds.has(member.id))
    .map((member) => ({
      league_id: leagueId,
      user_id: espnUserId(member.id),
      display_name: member.displayName || "ESPN user",
      avatar: null,
      is_bot: false,
      is_owner: Boolean(member.isLeagueManager),
      settings: {},
      metadata: compactObject({
        provider: PROVIDER,
        espn_member_id: member.id,
        team_name: teamName(teams.find((team) => teamOwners(team).primary === member.id) || {}) || null
      })
    }));

  const rosters = teams.map((team) => {
    const owners = teamOwners(team);
    return {
      league_id: leagueId,
      roster_id: Number(team.id),
      owner_id: espnUserId(owners.primary),
      co_owners: owners.others.map(espnUserId).filter(Boolean),
      players: [],
      starters: [],
      reserve: [],
      taxi: [],
      keepers: [],
      settings: compactObject({ ...overallRecord(team), rank: ranks.get(team.id) }),
      metadata: compactObject({
        provider: PROVIDER,
        espn_team_id: String(team.id),
        team_name: teamName(team),
        abbreviation: team.abbrev,
        playoff_seed: team.playoffSeed ? String(team.playoffSeed) : null,
        logo: team.logo
      })
    };
  });

  const standings = rosters
    .slice()
    .sort((a, b) => a.settings.rank - b.settings.rank)
    .map((roster) => {
      const { wins, losses, ties, fpts, fpts_against: against, rank } = roster.settings;
      return {
        league_id: leagueId,
        round: 0,
        roster_id: roster.roster_id,
        rank,
        points: fpts,
        points_against: against,
        wins,
        losses,
        ties,
        record: recordString(wins, losses, ties),
        metadata: { provider: PROVIDER, type: status === "complete" ? "final" : "current" }
      };
    });

  const matchups = espnMatchupsByWeek({ core, schedule: bundle.schedule, lineups: bundle.lineups, leagueId });
  const draftBundle = draftForSeason({
    draftDetail: bundle.draftDetail,
    settings: core.settings,
    providerLeagueId,
    season,
    leagueId,
    ownerByTeam,
    teamCount: teams.length
  });

  return {
    league: {
      league_id: leagueId,
      previous_league_id: null,
      name: core.settings?.name || "ESPN League",
      sport: "nfl",
      season,
      season_type: "regular",
      status,
      draft_id: draftBundle.draft_id,
      total_rosters: asNumber(core.settings?.size, teams.length),
      roster_positions: rosterPositions(core.settings),
      scoring_settings: {},
      settings: compactObject({
        playoff_teams: core.settings?.scheduleSettings?.playoffTeamCount,
        matchup_period_count: core.settings?.scheduleSettings?.matchupPeriodCount
      }),
      metadata: compactObject({
        provider: PROVIDER,
        espn_league_id: String(bundle.leagueId),
        espn_season: season,
        history_detail: historyDetailFor(matchups, LINEUP_SOURCE)
      })
    },
    users,
    rosters,
    standings,
    matchups_by_week: matchups,
    drafts: draftBundle.drafts,
    draft_picks: draftBundle.draft_picks,
    players: playersForSeason(bundle)
  };
}

export function normalizeEspnImport({ providerLeagueId, seasonBundles }) {
  const seasons = {};
  for (const bundle of seasonBundles) {
    const normalized = normalizeSeason({ providerLeagueId, bundle });
    seasons[normalized.league.season] = normalized;
  }
  return buildArchive({ provider: PROVIDER, providerLeagueId, seasons, lineupSource: LINEUP_SOURCE });
}
