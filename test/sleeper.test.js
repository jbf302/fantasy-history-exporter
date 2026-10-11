import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  discoverSleeperLeagueChain,
  fetchSleeperSeason,
  sleeperLeagueIdFromInput,
  sleeperWeeks
} from "../lib/sleeper-api.js";
import { normalizeSleeperImport, sleeperFinalRanks } from "../lib/sleeper-normalizer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "sleeper-league-season.json"), "utf8"));
const LEAGUE_ID = fixture.league.league_id;

// Serves the fixture the way api.sleeper.app would, keyed by path.
function fixtureFetcher(extra = {}) {
  const routes = {
    [`/league/${LEAGUE_ID}`]: fixture.league,
    [`/league/${LEAGUE_ID}/users`]: fixture.users,
    [`/league/${LEAGUE_ID}/rosters`]: fixture.rosters,
    [`/league/${LEAGUE_ID}/winners_bracket`]: fixture.winners_bracket,
    [`/league/${LEAGUE_ID}/losers_bracket`]: fixture.losers_bracket,
    [`/league/${LEAGUE_ID}/drafts`]: fixture.drafts,
    [`/draft/${fixture.league.draft_id}/picks`]: fixture.draft_picks,
    ...Object.fromEntries(Object.entries(fixture.matchups).map(([week, list]) => [`/league/${LEAGUE_ID}/matchups/${week}`, list])),
    ...extra
  };
  const requested = [];
  const fetchJson = async (path) => {
    requested.push(path);
    if (path.startsWith(`/league/${LEAGUE_ID}/matchups/`)) return routes[path] || [];
    return path in routes ? routes[path] : null;
  };
  return { fetchJson, requested };
}

test("sleeperLeagueIdFromInput accepts ids and league links only", () => {
  assert.equal(sleeperLeagueIdFromInput("289646328504385536"), "289646328504385536");
  assert.equal(sleeperLeagueIdFromInput(" https://sleeper.com/leagues/289646328504385536/matchup "), "289646328504385536");
  assert.equal(sleeperLeagueIdFromInput("https://sleeper.app/leagues/289646328504385536"), "289646328504385536");
  assert.equal(sleeperLeagueIdFromInput("https://example.com/leagues/289646328504385536"), null);
  assert.equal(sleeperLeagueIdFromInput("12345"), null);
});

test("discoverSleeperLeagueChain follows previous_league_id oldest first", async () => {
  const older = { ...fixture.league, league_id: fixture.league.previous_league_id, season: "2017", previous_league_id: "0" };
  const { fetchJson } = fixtureFetcher({ [`/league/${older.league_id}`]: older });
  const chain = await discoverSleeperLeagueChain(LEAGUE_ID, fetchJson);
  assert.deepEqual(
    chain.map((entry) => [entry.season, entry.leagueId]),
    [
      ["2017", older.league_id],
      ["2018", LEAGUE_ID]
    ]
  );
});

test("sleeperWeeks covers the season for complete leagues and stops at the current week in season", () => {
  assert.deepEqual(sleeperWeeks(fixture.league), Array.from({ length: 17 }, (_, index) => index + 2));
  assert.deepEqual(sleeperWeeks({ status: "in_season", settings: { start_week: 1, leg: 4 } }), [1, 2, 3, 4]);
  assert.deepEqual(sleeperWeeks({ status: "pre_draft", settings: {} }), []);
});

test("sleeperFinalRanks uses bracket placement games, then playoff depth, then record", () => {
  const ranks = sleeperFinalRanks(fixture.rosters, fixture.winners_bracket);
  // Final (p=1): 6 beat 3. Third place (p=3): 1 beat 2. Fifth place (p=5): 10 beat 5.
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((rank) => [...ranks].find(([, value]) => value === rank)[0]), [6, 3, 1, 2, 10, 5]);
  assert.equal(new Set(ranks.values()).size, fixture.rosters.length);
});

test("normalizeSleeperImport builds the shared export shape", async () => {
  const { fetchJson } = fixtureFetcher();
  const bundle = await fetchSleeperSeason({ season: "2018", leagueId: LEAGUE_ID, league: fixture.league }, fetchJson);
  const players = { 2315: { full_name: "Todd Gurley", position: "RB", team: "LAR" } };
  const archive = normalizeSleeperImport({ providerLeagueId: LEAGUE_ID, seasonBundles: [bundle], players });

  assert.equal(archive.schema_version, 1);
  assert.equal(archive.provider, "sleeper");
  assert.equal(archive.import_id, `sleeper:nfl:${LEAGUE_ID}`);
  assert.equal(archive.metadata.history_detail, "full");

  const season = archive.seasons["2018"];
  assert.equal(season.league.league_id, `sleeper:nfl:${LEAGUE_ID}:2018`);
  assert.equal(season.league.status, "complete");
  assert.equal(season.league.scoring_settings.rec, 1);
  assert.equal(season.standings[0].roster_id, 6);
  assert.equal(season.standings[0].record, "11-2");
  assert.equal(season.rosters[0].settings.fpts, 1776.06);
  assert.equal(season.users[0].metadata.team_name, "Team 1");

  const week2 = season.matchups_by_week["2"];
  assert.equal(week2.length, 12);
  const leg = week2.find((entry) => entry.roster_id === 1);
  assert.equal(leg.points, 153.98);
  assert.equal(leg.starters.length, 9);
  assert.equal(leg.starters_points["sleeper:421"], 30.68);
  assert.equal(Object.values(leg.starters_points).reduce((sum, value) => sum + value, 0).toFixed(2), "153.98");
  assert.equal(leg.metadata.is_playoffs, "0");
  assert.ok(["true", "false"].includes(leg.metadata.won_matchup));

  const week15 = season.matchups_by_week["15"];
  const semifinal = week15.find((entry) => entry.roster_id === 6);
  const fifthPlace = week15.find((entry) => entry.roster_id === 10);
  const toiletBowl = week15.find((entry) => entry.roster_id === 4);
  assert.deepEqual([semifinal.metadata.is_playoffs, semifinal.metadata.is_consolation], ["1", "0"]);
  assert.deepEqual([fifthPlace.metadata.is_playoffs, fifthPlace.metadata.is_consolation], ["1", "1"]);
  assert.deepEqual([toiletBowl.metadata.is_playoffs, toiletBowl.metadata.is_consolation], ["1", "1"]);

  assert.equal(season.drafts[0].type, "snake");
  assert.equal(season.draft_picks[0].player_id, "sleeper:2315");
  assert.ok(season.draft_picks[0].picked_by.startsWith("sleeper_user:"));
  assert.equal(season.players["sleeper:2315"].full_name, "Todd Gurley");
  // Without the catalog, names fall back to the draft pick's metadata.
  const drafted = season.draft_picks[1].player_id;
  assert.notEqual(season.players[drafted].full_name, drafted);
});

test("normalizeSleeperImport reads auction prices and chains seasons", () => {
  const auctionPick = { ...fixture.draft_picks[0], metadata: { ...fixture.draft_picks[0].metadata, amount: "57" } };
  const bundle = (season, id) => ({
    league: { ...fixture.league, season, league_id: id },
    users: fixture.users,
    rosters: fixture.rosters,
    winnersBracket: [],
    losersBracket: [],
    drafts: [{ draft: { ...fixture.drafts[0], type: "auction", settings: { budget: 200 } }, picks: [auctionPick] }],
    matchupsByWeek: {}
  });
  const archive = normalizeSleeperImport({
    providerLeagueId: LEAGUE_ID,
    seasonBundles: [bundle("2018", LEAGUE_ID), bundle("2017", "1")]
  });
  assert.deepEqual(archive.summary.seasons, ["2017", "2018"]);
  assert.equal(archive.seasons["2018"].league.previous_league_id, `sleeper:nfl:${LEAGUE_ID}:2017`);
  assert.equal(archive.seasons["2017"].league.previous_league_id, null);
  assert.equal(archive.seasons["2018"].draft_picks[0].amount, 57);
  assert.equal(archive.seasons["2018"].drafts[0].settings.budget, 200);
  assert.equal(archive.metadata.history_detail, "standings_only");
});
