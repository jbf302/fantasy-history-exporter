import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  parseLeagueDraftResults,
  parseLeagueDraftSettings,
  parseLeagueScoreboard,
  parseLeagueSeasonBundle,
  parseTeamRosterWeek
} from "../lib/yahoo-api.js";
import { mergeYahooImportIntoArchive, normalizeYahooImport } from "../lib/yahoo-normalizer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "yahoo-league-461.l.123456.json"), "utf8")
);

test("normalizeYahooImport emits schema v1 standings slice", () => {
  const bundle = parseLeagueSeasonBundle(fixture);
  const archive = normalizeYahooImport({
    providerLeagueId: "123456",
    seasonBundles: [bundle]
  });

  assert.equal(archive.schema_version, 1);
  assert.equal(archive.provider, "yahoo");
  assert.equal(archive.import_id, "yahoo:nfl:123456");
  assert.deepEqual(archive.summary.seasons, ["2025"]);
  assert.equal(archive.summary.score_storage, "custom_points");

  const season = archive.seasons["2025"];
  assert.equal(season.league.league_id, "yahoo:nfl:123456:2025");
  assert.equal(season.standings.length, season.rosters.length);
  assert.equal(season.standings[0].rank, 1);
  assert.equal(season.standings[0].wins, 12);
  assert.ok(season.standings[0].points > 0);
  assert.equal(season.league.status, "complete");
  assert.deepEqual(season.matchups_by_week, {});
  assert.deepEqual(season.players, {});
});

test("normalizeYahooImport builds weekly matchups and lineup enrichment from scoreboard/roster payloads", () => {
  const bundle = parseLeagueSeasonBundle(fixture);
  const scoreboardFixture = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "yahoo-scoreboard-461.l.123456-week1.json"), "utf8")
  );
  const rosterFixture = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "yahoo-roster-461.l.123456-t9-week1.json"), "utf8")
  );

  bundle.yahooScoreboardsByWeek = {
    1: parseLeagueScoreboard(scoreboardFixture)
  };
  bundle.yahooRosterPayloads = [
    {
      week: 1,
      teamId: "9",
      payload: parseTeamRosterWeek(rosterFixture)
    }
  ];

  const archive = normalizeYahooImport({
    providerLeagueId: "123456",
    seasonBundles: [bundle]
  });

  const season = archive.seasons["2025"];
  assert.equal(season.matchups_by_week["1"].length, 2);
  assert.equal(season.matchups_by_week["1"][0].custom_points, 112.34);
  assert.equal(season.matchups_by_week["1"][0].matchup_id, 1);

  const enrichedLeg = season.matchups_by_week["1"].find((leg) => leg.roster_id === 9);
  assert.ok(enrichedLeg.starters.includes("yahoo:461.p.30123"));
  assert.equal(enrichedLeg.starters_points["yahoo:461.p.30123"], 24.5);
  assert.equal(enrichedLeg.metadata.lineup_source, "yahoo_roster");
  assert.ok(archive.metadata.import_phase === "matchups_and_lineups");
});

test("normalizeYahooImport builds draft picks and merges players catalog", () => {
  const bundle = parseLeagueSeasonBundle(fixture);
  const draftFixture = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "yahoo-draft-461.l.123456.json"), "utf8")
  );
  const settingsFixture = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "yahoo-settings-auction-461.l.123456.json"), "utf8")
  );

  bundle.yahooDraftResults = parseLeagueDraftResults(draftFixture);
  bundle.yahooDraftSettings = parseLeagueDraftSettings(settingsFixture);

  const archive = normalizeYahooImport({
    providerLeagueId: "123456",
    seasonBundles: [bundle]
  });

  const season = archive.seasons["2025"];
  assert.equal(season.draft_picks.length, 2);
  assert.equal(season.drafts[0].type, "auction");
  assert.equal(season.draft_picks[0].metadata.bid_amount, "72");
  assert.ok(season.players["yahoo:461.p.30123"]);
  assert.equal(season.league.draft_id, "yahoo:nfl:123456:2025:draft");
});

test("mergeYahooImportIntoArchive adds seasons and preserves imported_at", () => {
  const bundle2025 = parseLeagueSeasonBundle(fixture);
  const first = normalizeYahooImport({
    providerLeagueId: "123456",
    seasonBundles: [bundle2025]
  });
  const importedAt = first.imported_at;

  const bundle2024 = parseLeagueSeasonBundle(fixture);
  bundle2024.metadata = { ...bundle2024.metadata, season: "2024", league_key: "449.l.123456" };

  const merged = mergeYahooImportIntoArchive(first, {
    providerLeagueId: "123456",
    seasonBundles: [bundle2024]
  });

  assert.equal(merged.imported_at, importedAt);
  assert.ok(merged.updated_at >= importedAt);
  assert.deepEqual(merged.summary.seasons, ["2024", "2025"]);
  assert.equal(merged.seasons["2025"].league.previous_league_id, "yahoo:nfl:123456:2024");
  assert.equal(merged.seasons["2024"].league.previous_league_id, null);
});
