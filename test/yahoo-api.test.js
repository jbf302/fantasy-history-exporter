import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  discoverYahooLeagueChain,
  expandSeasonYearHints,
  findAllLeagueKeysInUserGames,
  historicalSeasonYearsFromYahooHtml,
  historicalSeasonYearsFromYahooSlugHtml,
  leagueIdFromLeagueKey,
  leagueKeyFromHtml,
  leagueKeyCandidatesFromFranchiseSeasonHtml,
  leagueKeyHintsFromFranchiseSeasonHtml,
  leagueKeyFromRenew,
  leagueKeyMatchesLeagueId,
  leagueScoreboardUrl,
  metadataMatchesFranchiseSlug,
  parseLeagueMetadata,
  parseLeagueDraftResults,
  parseLeagueDraftSettings,
  parseLeagueScoreboard,
  parseLeagueSeasonBundle,
  parseTeamRosterWeek,
  rewriteYahooUrlBase,
  teamRosterWeekStatsUrl,
  teamRosterWeekUrl,
  teamWeekPoints,
  weekNumbersFromLeagueMetadata,
  YahooApiError,
  YAHOO_PUB_RW_API_BASE,
  isYahooRetryableFetchError,
  yahooLeagueAccessDenied,
  yahooLeagueIdFromUrl,
  yahooLeagueSlugFromUrl,
  yahooSeasonFromUrl,
  yahooTransientServerError
} from "../lib/yahoo-api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "yahoo-league-461.l.116514.json"), "utf8")
);
const scoreboardFixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "yahoo-scoreboard-461.l.116514-week1.json"), "utf8")
);
const rosterFixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "yahoo-roster-461.l.116514-t9-week1.json"), "utf8")
);

test("yahooSeasonFromUrl reads slug-based historical league URLs", () => {
  assert.equal(
    yahooSeasonFromUrl("https://football.fantasysports.yahoo.com/league/mansionfantasyfootball/2023"),
    "2023"
  );
});

test("expandSeasonYearHints fills continuous seasons when nav shows sparse years", () => {
  assert.deepEqual(
    expandSeasonYearHints(["2019", "2023"], { hintSeason: "2023", now: new Date("2026-10-05T12:00:00Z") }),
    ["2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"]
  );
});

test("yahooLeagueSlugFromUrl reads SFPL-style franchise paths", () => {
  assert.equal(
    yahooLeagueSlugFromUrl("https://football.fantasysports.yahoo.com/league/sfpl/2022"),
    "sfpl"
  );
  assert.equal(
    yahooLeagueSlugFromUrl("https://football.fantasysports.yahoo.com/2025/f1/116514"),
    null
  );
});

test("expandSeasonYearHints probes full franchise range on slug URLs with one visible year", () => {
  assert.deepEqual(
    expandSeasonYearHints(["2022"], {
      hintSeason: "2022",
      franchiseSlugRange: true,
      now: new Date("2026-10-05T12:00:00Z")
    }),
    [
      "2014",
      "2015",
      "2016",
      "2017",
      "2018",
      "2019",
      "2020",
      "2021",
      "2022",
      "2023",
      "2024",
      "2025",
      "2026"
    ]
  );
});

test("historicalSeasonYearsFromYahooSlugHtml collects seasons for one franchise slug", () => {
  const html = `
    <a href="/league/sfpl/2014">2014</a>
    <a href="/league/sfpl/2022">2022</a>
    <a href="/league/otherleague/2020">2020</a>
  `;
  assert.deepEqual(historicalSeasonYearsFromYahooSlugHtml(html, "sfpl"), ["2014", "2022"]);
});

test("historicalSeasonYearsFromYahooHtml collects season years from Yahoo league navigation links", () => {
  const html = `
    <a href="/league/mansionfantasyfootball/2023">2023</a>
    <a href="/league/mansionfantasyfootball/2024">2024</a>
    <a href="/2025/f1/588159">2025</a>
  `;
  assert.deepEqual(historicalSeasonYearsFromYahooHtml(html, "588159"), ["2023", "2024", "2025"]);
});

test("yahooLeagueIdFromUrl parses modern Yahoo football league URLs", () => {
  assert.equal(
    yahooLeagueIdFromUrl("https://football.fantasysports.yahoo.com/f1/116514"),
    "116514"
  );
  assert.equal(
    yahooLeagueIdFromUrl("https://football.fantasysports.yahoo.com/2025/f1/116514/9"),
    "116514"
  );
  assert.equal(yahooSeasonFromUrl("https://football.fantasysports.yahoo.com/2025/f1/116514"), "2025");
});

test("rewriteYahooUrlBase swaps Yahoo fantasy API hosts", () => {
  const url = "https://fantasysports.yahooapis.com/fantasy/v2/league/461.l.1/metadata?format=json";
  assert.equal(
    rewriteYahooUrlBase(url, YAHOO_PUB_RW_API_BASE),
    "https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2/league/461.l.1/metadata?format=json"
  );
});

test("leagueKeyFromHtml finds a league key embedded in page HTML", () => {
  const html = '<script>"league_key":"461.l.116514"</script>';
  assert.equal(leagueKeyFromHtml(html, "116514"), "461.l.116514");
});

test("leagueKeyFromRenew converts Yahoo renew tokens", () => {
  assert.equal(leagueKeyFromRenew("449_116514"), "449.l.116514");
  assert.equal(leagueKeyFromRenew("449.l.116514"), "449.l.116514");
  assert.equal(leagueKeyFromRenew(""), null);
});

test("parseLeagueSeasonBundle reads metadata and standings teams", () => {
  const bundle = parseLeagueSeasonBundle(fixture);
  assert.equal(bundle.metadata.league_id, "116514");
  assert.equal(bundle.metadata.season, "2025");
  assert.ok(bundle.standingsTeams.length >= 2);
  assert.ok(bundle.standingsTeams[0].name);
  assert.equal(bundle.standingsTeams[0].team_standings.rank, 1);
});

test("parseLeagueMetadata reads league header", () => {
  const metadata = parseLeagueMetadata(fixture);
  assert.equal(metadata.league_key, "461.l.116514");
  assert.equal(metadata.name, "Yahoo H2H-Pts 116514");
});

test("leagueIdFromLeagueKey and leagueKeyMatchesLeagueId", () => {
  assert.equal(leagueIdFromLeagueKey("461.l.116514"), "116514");
  assert.equal(leagueIdFromLeagueKey("348.l.495133"), "495133");
  assert.equal(leagueKeyMatchesLeagueId("461.l.116514", "116514"), true);
  assert.equal(leagueKeyMatchesLeagueId("348.l.495133", "116514"), false);
});

test("yahooTransientServerError detects retryable Yahoo API failures", () => {
  assert.equal(
    yahooTransientServerError("There was a temporary problem with the server. Please try again shortly."),
    true
  );
  assert.equal(
    isYahooRetryableFetchError(
      new YahooApiError(
        "There was a temporary problem with the server. Please try again shortly.",
        400,
        "https://example.test"
      )
    ),
    true
  );
});

test("yahooLeagueAccessDenied distinguishes permission errors from login", () => {
  assert.equal(
    yahooLeagueAccessDenied(
      "You are not allowed to view this page because you are not in this league."
    ),
    true
  );
  assert.equal(yahooLeagueAccessDenied("Please log in to continue."), false);
});

test("leagueKeyCandidatesFromFranchiseSeasonHtml keeps season-specific game keys", () => {
  const html = `
    "league_key":"399.l.555"
    "league_key":"406.l.555"
    "league_key":"414.l.555"
  `;
  assert.deepEqual(
    leagueKeyCandidatesFromFranchiseSeasonHtml(html, "2020").map((entry) => entry.leagueKey),
    ["399.l.555"]
  );
});

test("leagueKeyHintsFromFranchiseSeasonHtml reads league keys from slug season pages", () => {
  const html = `
    <script>"league_key":"414.l.100","league_id":"100"</script>
    <a href="/2022/f1/200">other</a>
  `;
  assert.deepEqual(leagueKeyHintsFromFranchiseSeasonHtml(html, "2022"), {
    leagueKey: "414.l.100",
    leagueId: "100",
    season: "2022"
  });
});

test("metadataMatchesFranchiseSlug checks Yahoo league URLs", () => {
  assert.equal(
    metadataMatchesFranchiseSlug(
      { url: "https://football.fantasysports.yahoo.com/league/sfpl/2022", name: "SFPL" },
      "sfpl"
    ),
    true
  );
  assert.equal(
    metadataMatchesFranchiseSlug(
      { url: "https://football.fantasysports.yahoo.com/2025/f1/495133", name: "Other" },
      "sfpl"
    ),
    false
  );
});

test("discoverYahooLeagueChain probes franchise seasons across league id changes", async () => {
  const fetchJson = async (url) => {
    if (url.includes("414.l.100")) {
      return {
        fantasy_content: {
          league: [
            [
              {
                league_key: "414.l.100",
                league_id: "100",
                season: "2022",
                url: "https://football.fantasysports.yahoo.com/league/sfpl/2022"
              }
            ]
          ]
        }
      };
    }
    if (url.includes("331.l.200")) {
      return {
        fantasy_content: {
          league: [
            [
              {
                league_key: "331.l.200",
                league_id: "200",
                season: "2014",
                url: "https://football.fantasysports.yahoo.com/league/sfpl/2014"
              }
            ]
          ]
        }
      };
    }
    throw new YahooApiError("not found", 404, url);
  };

  const chain = await discoverYahooLeagueChain({
    startLeagueKey: "414.l.100",
    anchorLeagueId: "100",
    hintSeasonYears: ["2014", "2022"],
    franchiseSlug: "sfpl",
    franchiseLeagueIds: ["100", "200"],
    fetchJson
  });

  assert.deepEqual(
    chain.map((entry) => entry.season).sort(),
    ["2014", "2022"]
  );
});

test("discoverYahooLeagueChain stops when renew points at a different league id", async () => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes("461.l.116514")) {
      return {
        fantasy_content: {
          league: [
            [{ league_key: "461.l.116514", league_id: "116514", season: "2025", renew: "449_116514" }]
          ]
        }
      };
    }
    if (url.includes("449.l.116514")) {
      return {
        fantasy_content: {
          league: [
            [{ league_key: "449.l.116514", league_id: "116514", season: "2024", renew: "348_495133" }]
          ]
        }
      };
    }
    throw new YahooApiError("not found", 404, url);
  };

  const chain = await discoverYahooLeagueChain({
    startLeagueKey: "461.l.116514",
    anchorLeagueId: "116514",
    fetchJson
  });

  assert.equal(chain.length, 2);
  assert.deepEqual(
    chain.map((entry) => entry.season),
    ["2024", "2025"]
  );
  assert.equal(calls.some((url) => url.includes("495133")), false);
});

test("findAllLeagueKeysInUserGames returns every NFL season key for a league id", () => {
  const payload = {
    fantasy_content: {
      users: {
        user: [
          {},
          {
            games: {
              0: {
                game: [
                  [{ season: "2025" }],
                  { leagues: { 0: { league: [{ league_key: "461.l.116514", league_id: "116514", season: "2025" }] } } }
                ]
              },
              1: {
                game: [
                  [{ season: "2024" }],
                  { leagues: { 0: { league: [{ league_key: "449.l.116514", league_id: "116514", season: "2024" }] } } }
                ]
              }
            }
          }
        ]
      }
    }
  };

  const matches = findAllLeagueKeysInUserGames(payload, "116514");
  assert.deepEqual(
    matches.map((match) => match.season),
    ["2025", "2024"]
  );
});

test("discoverYahooLeagueChain backfills prior seasons by NFL game key when renew is poisoned", async () => {
  const fetchJson = async (url) => {
    if (url.includes("470.l.116514")) {
      return {
        fantasy_content: {
          league: [
            [{ league_key: "470.l.116514", league_id: "116514", season: "2026", renew: "348_495133" }]
          ]
        }
      };
    }
    if (url.includes("461.l.116514")) {
      return {
        fantasy_content: {
          league: [[{ league_key: "461.l.116514", league_id: "116514", season: "2025", renew: "449_116514" }]]
        }
      };
    }
    if (url.includes("449.l.116514")) {
      return {
        fantasy_content: {
          league: [[{ league_key: "449.l.116514", league_id: "116514", season: "2024", renew: "423_116514" }]]
        }
      };
    }
    throw new YahooApiError("not found", 404, url);
  };

  const chain = await discoverYahooLeagueChain({
    startLeagueKey: "470.l.116514",
    anchorLeagueId: "116514",
    hintSeason: "2026",
    fetchJson
  });

  assert.deepEqual(
    chain.map((entry) => entry.season),
    ["2024", "2025", "2026"]
  );
});

test("scoreboard and roster URL builders include week parameters", () => {
  assert.match(leagueScoreboardUrl("461.l.116514", 1), /scoreboard;week=1/);
  assert.match(teamRosterWeekUrl("461.l.116514.t.9", 1), /roster;week=1/);
  assert.match(teamRosterWeekStatsUrl("461.l.116514.t.9", 1), /players\/stats;type=week;week=1/);
});

test("weekNumbersFromLeagueMetadata respects finished vs in-progress seasons", () => {
  assert.deepEqual(
    weekNumbersFromLeagueMetadata({ start_week: "1", end_week: "17", is_finished: 1 }),
    Array.from({ length: 17 }, (_, index) => index + 1)
  );
  assert.deepEqual(
    weekNumbersFromLeagueMetadata({ start_week: "1", end_week: "17", current_week: "3", is_finished: 0 }),
    [1, 2, 3]
  );
});

test("parseLeagueScoreboard reads Yahoo's nested scoreboard.matchups shape", () => {
  const real = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "yahoo-scoreboard-real-week12.json"), "utf8")
  );
  const scoreboard = parseLeagueScoreboard(real, 12);
  assert.equal(scoreboard.week, "12");
  assert.ok(scoreboard.matchups.length >= 5);
  assert.equal(scoreboard.matchups[0].teams.length, 2);
  assert.ok(teamWeekPoints(scoreboard.matchups[0].teams[0]) != null);
});

test("parseLeagueScoreboard and parseTeamRosterWeek read weekly matchup and lineup payloads", () => {
  const scoreboard = parseLeagueScoreboard(scoreboardFixture);
  assert.equal(scoreboard.week, "1");
  assert.equal(scoreboard.matchups.length, 1);
  assert.equal(scoreboard.matchups[0].teams.length, 2);

  const roster = parseTeamRosterWeek(rosterFixture);
  assert.equal(roster.teamId, "9");
  assert.equal(roster.week, "1");
  assert.equal(roster.players.length, 2);
  assert.equal(roster.players[0].selected_position, "QB");
  assert.equal(roster.players[0].points, 24.5);
});

test("parseLeagueDraftResults and parseLeagueDraftSettings read auction draft payloads", () => {
  const draftFixture = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "yahoo-draft-461.l.116514.json"), "utf8")
  );
  const settingsFixture = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "yahoo-settings-auction-461.l.116514.json"), "utf8")
  );

  const draft = parseLeagueDraftResults(draftFixture);
  assert.equal(draft.picks.length, 2);
  assert.equal(draft.picks[0].pick, 1);
  assert.equal(draft.picks[0].cost, 72);
  assert.equal(draft.picks[0].player_key, "461.p.30123");

  const settings = parseLeagueDraftSettings(settingsFixture);
  assert.equal(settings.draft_type, "auction");
});

test("discoverYahooLeagueChain ignores transient Yahoo errors while probing older seasons", async () => {
  const fetchJson = async (url) => {
    if (url.includes("470.l.116514")) {
      return {
        fantasy_content: {
          league: [[{ league_key: "470.l.116514", league_id: "116514", season: "2026", renew: "348_495133" }]]
        }
      };
    }
    if (url.includes("461.l.116514")) {
      return {
        fantasy_content: {
          league: [[{ league_key: "461.l.116514", league_id: "116514", season: "2025", renew: "449_116514" }]]
        }
      };
    }
    if (url.includes("449.l.116514")) {
      throw new YahooApiError(
        "There was a temporary problem with the server. Please try again shortly.",
        400,
        url
      );
    }
    throw new YahooApiError("not found", 404, url);
  };

  const chain = await discoverYahooLeagueChain({
    startLeagueKey: "470.l.116514",
    anchorLeagueId: "116514",
    hintSeason: "2026",
    fetchJson
  });

  assert.deepEqual(
    chain.map((entry) => entry.season),
    ["2025", "2026"]
  );
});

test("discoverYahooLeagueChain resolves seasons through slug pages without probing the old league id", async () => {
  const idsByYear = { 2022: ["414", "100"], 2023: ["423", "200"], 2024: ["449", "300"] };
  const requested = [];
  const fetchJson = async (url) => {
    requested.push(url);
    for (const [year, [game, id]] of Object.entries(idsByYear)) {
      if (url.includes(`/league/${game}.l.${id}/metadata`)) {
        return {
          fantasy_content: {
            league: [
              [
                {
                  league_key: `${game}.l.${id}`,
                  league_id: id,
                  season: year,
                  url: `https://football.fantasysports.yahoo.com/league/sfpl/${year}`
                }
              ]
            ]
          }
        };
      }
    }
    throw new YahooApiError("not found", 404, url);
  };
  const fetchFranchiseSeasonHtml = async (_slug, year) => {
    const [game, id] = idsByYear[year] || [];
    return game ? `<script>"league_key":"${game}.l.${id}","league_id":"${id}"</script>` : null;
  };

  const chain = await discoverYahooLeagueChain({
    startLeagueKey: "449.l.300",
    anchorLeagueId: "300",
    hintSeason: "2024",
    hintSeasonYears: ["2022", "2023", "2024"],
    franchiseSlug: "sfpl",
    franchiseLeagueIds: ["300"],
    fetchFranchiseSeasonHtml,
    fetchJson
  });

  assert.deepEqual(chain.map((entry) => entry.season), ["2022", "2023", "2024"]);
  const sameIdProbes = requested.filter((url) => /\.l\.300\//.test(url) && !url.includes("449.l.300"));
  assert.deepEqual(sameIdProbes, [], "no game-key probes with the newest league id for other years");
});
