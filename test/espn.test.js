import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  createEspnFetcher,
  discoverEspnSeasons,
  EspnApiError,
  espnLeagueFromUrl,
  espnLeagueUrl,
  espnScoringPeriods,
  fetchEspnSeason,
  parseEspnBoxscore
} from "../lib/espn-api.js";
import { espnPlayerIdsMissingNames, espnRanks, normalizeEspnImport } from "../lib/espn-normalizer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "espn-league-season.json"), "utf8"));
const LEAGUE_ID = String(fixture.core.id);

function seasonBundle() {
  return {
    leagueId: LEAGUE_ID,
    season: "2023",
    core: fixture.core,
    schedule: fixture.schedule.schedule,
    draftDetail: fixture.draft.draftDetail,
    lineups: parseEspnBoxscore(fixture.boxscore_week16, 16),
    players: {}
  };
}

test("espnLeagueFromUrl reads league and season from fantasy.espn.com links", () => {
  assert.deepEqual(espnLeagueFromUrl("https://fantasy.espn.com/football/league?leagueId=899513&seasonId=2023"), {
    leagueId: "899513",
    season: "2023"
  });
  assert.deepEqual(espnLeagueFromUrl("https://fantasy.espn.com/football/team?leagueId=42&teamId=3"), {
    leagueId: "42",
    season: null
  });
  assert.equal(espnLeagueFromUrl("https://fantasy.espn.com/basketball/league?leagueId=42"), null);
  assert.equal(espnLeagueFromUrl("https://example.com/football/league?leagueId=42"), null);
});

test("espnLeagueUrl uses leagueHistory before 2018", () => {
  assert.equal(
    espnLeagueUrl("42", "2023", ["mTeam", "mSettings"]),
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2023/segments/0/leagues/42?view=mTeam&view=mSettings"
  );
  assert.equal(
    espnLeagueUrl("42", "2016", ["mBoxscore"], { scoringPeriodId: 3 }),
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/42?seasonId=2016&view=mBoxscore&scoringPeriodId=3"
  );
});

test("discoverEspnSeasons starts from the current season and lists previous seasons", async () => {
  const requested = [];
  const fetchJson = async (url) => {
    requested.push(url);
    if (url.includes("/seasons/2026/")) throw new EspnApiError("not found", 404, url);
    if (url.includes("/leagueHistory/")) throw new EspnApiError("not found", 404, url);
    return fixture.core;
  };
  const result = await discoverEspnSeasons({ leagueId: LEAGUE_ID, season: "2021", fetchJson, now: new Date("2026-10-01") });
  assert.deepEqual(result.seasons, ["2018", "2019", "2020", "2021", "2022", "2023"]);
  assert.equal(result.name, "Test ESPN League");
  assert.ok(requested[0].includes("/seasons/2026/"));
});

test("discoverEspnSeasons reports a private league", async () => {
  const fetchJson = async (url) => {
    throw new EspnApiError("You are not authorized to view this League.", 401, url);
  };
  await assert.rejects(discoverEspnSeasons({ leagueId: LEAGUE_ID, fetchJson }), (error) => error.status === 401);
});

test("older private seasons that 401 on /seasons fall back to leagueHistory", async () => {
  const fetchJson = async (url) => {
    if (url.includes("/seasons/2019/")) throw new EspnApiError("You are not authorized to view this League.", 401, url);
    return [{ ...fixture.core, seasonId: 2019 }];
  };
  const season = await fetchEspnSeason({ leagueId: LEAGUE_ID, season: "2019" }, fetchJson);
  assert.equal(season.core.seasonId, 2019);
});

test("createEspnFetcher refuses non-ESPN URLs", async () => {
  const fetchJson = createEspnFetcher({ fetchImpl: async () => assert.fail("should not fetch") });
  await assert.rejects(fetchJson("https://example.com/apis/v3/games/ffl/x"), /not allowed/);
});

test("fetchEspnSeason requests one box score per played week with a schedule filter", async () => {
  const calls = [];
  const fetchJson = async (url, options) => {
    calls.push({ url, filter: options?.filter });
    if (url.includes("mBoxscore")) return url.includes("scoringPeriodId=16") ? fixture.boxscore_week16 : { schedule: [] };
    if (url.includes("mDraftDetail")) return fixture.draft;
    if (url.includes("mMatchupScore")) return fixture.schedule;
    return fixture.core;
  };
  const bundle = await fetchEspnSeason({ leagueId: LEAGUE_ID, season: "2023", core: fixture.core }, fetchJson);
  const boxCalls = calls.filter((call) => call.url.includes("mBoxscore"));
  assert.equal(boxCalls.length, espnScoringPeriods(fixture.core).length);
  assert.equal(boxCalls.length, 18);
  const week16 = boxCalls.find((call) => call.url.includes("scoringPeriodId=16"));
  assert.deepEqual(JSON.parse(week16.filter), { schedule: { filterMatchupPeriodIds: { value: [15] } } });
  assert.equal(bundle.lineups.length, 10);
});

test("espnRanks prefers ESPN's final rank and fills gaps by record", () => {
  const ranks = espnRanks(fixture.core.teams);
  assert.equal(new Set(ranks.values()).size, fixture.core.teams.length);
  const unranked = fixture.core.teams.map((team) => ({ ...team, rankCalculatedFinal: 0, rankFinal: 0, playoffSeed: 0 }));
  const byRecord = espnRanks(unranked);
  const best = unranked.reduce((a, b) => (b.record.overall.wins > a.record.overall.wins ? b : a));
  assert.equal(byRecord.get(best.id), 1);
});

test("normalizeEspnImport builds the shared export shape", () => {
  const archive = normalizeEspnImport({ providerLeagueId: LEAGUE_ID, seasonBundles: [seasonBundle()] });
  assert.equal(archive.provider, "espn");
  assert.equal(archive.import_id, `espn:nfl:${LEAGUE_ID}`);
  assert.equal(archive.name, "Test ESPN League");

  const season = archive.seasons["2023"];
  assert.equal(season.league.status, "complete");
  assert.equal(season.league.total_rosters, 10);
  assert.deepEqual(season.league.roster_positions.slice(0, 3), ["TQB", "FLEX", "FLEX"]);
  assert.equal(season.standings[0].rank, 1);
  assert.equal(season.standings.length, 10);
  assert.ok(season.users.every((user) => user.user_id.startsWith("espn_user:") && !user.user_id.includes("{")));
  assert.equal(season.rosters.find((roster) => roster.roster_id === 1).metadata.team_name, "Team 1");

  // One leg per team per NFL week, including both weeks of two-week playoff matchups.
  assert.deepEqual(Object.keys(season.matchups_by_week).map(Number), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.equal(season.matchups_by_week["1"].length, 10);

  const week15 = season.matchups_by_week["15"];
  const week16 = season.matchups_by_week["16"];
  const final = week16.find((leg) => leg.metadata.playoff_tier === "WINNERS_BRACKET");
  assert.equal(final.metadata.matchup_weeks, "15,16");
  const sameTeamWeek15 = week15.find((leg) => leg.roster_id === final.roster_id);
  assert.equal(
    (final.points + sameTeamWeek15.points).toFixed(2),
    Number(final.metadata.matchup_total_points).toFixed(2)
  );
  assert.deepEqual([final.metadata.is_playoffs, final.metadata.is_consolation], ["1", "0"]);
  const consolation = week16.find((leg) => leg.metadata.playoff_tier === "LOSERS_CONSOLATION_LADDER");
  assert.deepEqual([consolation.metadata.is_playoffs, consolation.metadata.is_consolation], ["1", "1"]);
  assert.equal(season.matchups_by_week["1"][0].metadata.is_playoffs, "0");

  // Week 16 has lineups: starters exclude bench (20) and IR (21) and add up to the week's points.
  assert.equal(final.metadata.lineup_source, "espn_boxscore");
  const starterTotal = Object.values(final.starters_points).reduce((sum, value) => sum + value, 0);
  assert.equal(starterTotal.toFixed(2), final.points.toFixed(2));
  assert.ok(final.players.length > final.starters.length);
  assert.equal(season.league.metadata.history_detail, "full");

  assert.equal(season.drafts[0].type, "auction");
  assert.equal(season.drafts[0].settings.budget, 200);
  assert.equal(season.draft_picks[0].amount, 70);
  assert.equal(season.draft_picks[0].player_id, "espn:4262921");
  assert.ok(season.draft_picks[0].picked_by.startsWith("espn_user:"));

  const dst = Object.values(season.players).find((player) => player.position === "DEF");
  assert.ok(dst.full_name.endsWith("D/ST"));
  assert.ok(dst.team);
});

test("espnPlayerIdsMissingNames lists drafted players never seen in a lineup", () => {
  const bundle = seasonBundle();
  const missing = espnPlayerIdsMissingNames(bundle);
  const lineupIds = new Set(bundle.lineups.flatMap((lineup) => lineup.entries.map((entry) => entry.playerId)));
  assert.ok(missing.length > 0);
  assert.ok(missing.every((id) => !lineupIds.has(id)));
  bundle.players = Object.fromEntries(missing.map((id) => [id, { fullName: `Player ${id}`, positionId: 2, proTeamId: 1 }]));
  assert.deepEqual(espnPlayerIdsMissingNames(bundle), []);
  const season = normalizeEspnImport({ providerLeagueId: LEAGUE_ID, seasonBundles: [bundle] }).seasons["2023"];
  assert.equal(season.players[`espn:${missing[0]}`].position, "RB");
  assert.equal(season.players[`espn:${missing[0]}`].team, "ATL");
});
