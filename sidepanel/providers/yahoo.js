// Yahoo adapter for the side panel. Yahoo needs the user's signed-in Yahoo tab:
// requests go through it, and its page supplies hints for finding past seasons.
import {
  discoverYahooLeagueChain,
  expandSeasonYearHints,
  fetchYahooSeasonBundle,
  isYahooRetryableFetchError,
  leagueDraftResultsUrl,
  leagueKeyMatchesLeagueId,
  leagueScoreboardUrl,
  leagueSettingsUrl,
  NFL_GAME_KEYS_BY_SEASON,
  parseLeagueDraftResults,
  parseLeagueDraftSettings,
  parseLeagueScoreboard,
  parseTeamRosterWeek,
  resolveYahooLeagueKey,
  teamKeyFromParts,
  teamRosterWeekStatsUrl,
  teamRosterWeekUrl,
  weekNumbersFromLeagueMetadata,
  yahooLeagueIdFromUrl,
  yahooLeagueSlugFromUrl,
  yahooSeasonFromUrl
} from "../../lib/yahoo-api.js";
import { normalizeYahooImport } from "../../lib/yahoo-normalizer.js";
import {
  createYahooFetcher,
  describeYahooError,
  fetchFranchiseSeasonPageHtml,
  friendlyYahooError,
  getPageHints,
  isYahooFantasyPage
} from "../../lib/yahoo-session.js";

function pickerYears(chain, expectedProbeYears, dropdownYears) {
  const base =
    dropdownYears?.length >= 2
      ? dropdownYears
      : expectedProbeYears?.length
        ? expectedProbeYears
        : chain.map((entry) => entry.season);
  return [...new Set([...base, ...chain.map((entry) => entry.season)])].sort(
    (a, b) => Number(a) - Number(b)
  );
}

async function fetchSeasonWeekData({ entry, fetchJson, onStep, throwIfCancelled }) {
  const weeks = weekNumbersFromLeagueMetadata(entry.metadata || {});
  const scoreboardsByWeek = {};
  const rosterPayloads = [];

  for (const week of weeks) {
    throwIfCancelled();
    onStep(`${entry.season} week ${week} scoreboard`);
    try {
      const payload = await fetchJson(leagueScoreboardUrl(entry.leagueKey, week));
      scoreboardsByWeek[String(week)] = parseLeagueScoreboard(payload, week);
    } catch (error) {
      if (isYahooRetryableFetchError(error)) continue;
      throw error;
    }
  }

  for (const week of weeks) {
    const scoreboard = scoreboardsByWeek[String(week)];
    if (!scoreboard?.matchups?.length) continue;
    const teamIds = new Set();
    for (const matchup of scoreboard.matchups) {
      for (const team of matchup.teams || []) {
        if (team.team_id != null) teamIds.add(String(team.team_id));
      }
    }
    for (const teamId of teamIds) {
      throwIfCancelled();
      onStep(`${entry.season} week ${week} lineup (team ${teamId})`);
      const teamKey = teamKeyFromParts(entry.leagueKey, teamId);
      try {
        let payload;
        try {
          payload = await fetchJson(teamRosterWeekStatsUrl(teamKey, week));
        } catch (statsError) {
          if (!isYahooRetryableFetchError(statsError)) throw statsError;
          payload = await fetchJson(teamRosterWeekUrl(teamKey, week));
        }
        rosterPayloads.push({ week, teamId, payload: parseTeamRosterWeek(payload) });
      } catch (error) {
        if (isYahooRetryableFetchError(error)) continue;
        throw error;
      }
    }
  }

  return { scoreboardsByWeek, rosterPayloads };
}

export const yahooProvider = {
  id: "yahoo",
  label: "Yahoo",
  tabUrlPattern: "https://football.fantasysports.yahoo.com/*",
  pickerHint:
    "More seasons means more requests to Yahoo. If Yahoo rate-limits you, wait a bit and download fewer seasons at a time.",

  matchesTab(tab) {
    return isYahooFantasyPage(tab);
  },

  async targetFromTab(tab) {
    const hints = await getPageHints(tab);
    const leagueId = hints?.leagueId || yahooLeagueIdFromUrl(tab.url);
    if (!leagueId) {
      return { error: "Yahoo is open, but not on a league page. Open one of your leagues, then come back here." };
    }
    return {
      tab,
      leagueId,
      status: `Yahoo league ${leagueId} detected. Make sure you're signed in to Yahoo.`
    };
  },

  targetFromInput() {
    return null;
  },

  async scan(target, { log, recordFailure }) {
    const { tab } = target;
    const pageHints = (await getPageHints(tab)) || {};
    const leagueId = pageHints.leagueId || yahooLeagueIdFromUrl(tab.url);
    if (!leagueId) throw new Error("Open one of your Yahoo league pages first.");

    const fetchJson = createYahooFetcher(tab, { onFailure: recordFailure });
    const hintSeason = yahooSeasonFromUrl(tab.url) || pageHints.season || null;
    let hintLeagueKey = pageHints.leagueKey || null;
    if (hintLeagueKey && !leagueKeyMatchesLeagueId(hintLeagueKey, leagueId)) hintLeagueKey = null;
    if (hintSeason && NFL_GAME_KEYS_BY_SEASON[hintSeason] && pageHints.leagueKeys?.length) {
      const seasonKey = `${NFL_GAME_KEYS_BY_SEASON[hintSeason]}.l.${leagueId}`;
      if (pageHints.leagueKeys.includes(seasonKey)) hintLeagueKey = seasonKey;
    }
    const franchiseSlug = yahooLeagueSlugFromUrl(tab.url) || pageHints.leagueSlug || null;

    log(
      `Page: ${new URL(tab.url).pathname} | season ${hintSeason || "?"} | slug ${franchiseSlug || "none"} | ` +
        `dropdown years [${(pageHints.historicalSeasonYears || []).join(", ")}] | ` +
        `league ids [${(pageHints.leagueIds || []).join(", ")}] | keys [${(pageHints.leagueKeys || []).join(", ")}]`
    );
    const resolved = await resolveYahooLeagueKey({ leagueId, hintSeason, hintLeagueKey, fetchJson });
    log(`Using Yahoo league key ${resolved.league_key}.`);

    const dropdownYears = pageHints.historicalSeasonYears || [];
    const navYears = [...new Set([...dropdownYears, hintSeason].filter(Boolean))];
    const hintYears = dropdownYears.length >= 2 ? dropdownYears : navYears.length ? navYears : null;
    const slugRange = Boolean(franchiseSlug) && !(dropdownYears.length >= 2);
    const expectedProbeYears = expandSeasonYearHints(hintYears || navYears, {
      hintSeason,
      franchiseSlugRange: slugRange
    });
    const franchiseLeagueIds = [
      ...new Set([leagueId, ...(pageHints.leagueIds || [])].filter(Boolean).map(String))
    ];

    const chain = await discoverYahooLeagueChain({
      startLeagueKey: resolved.league_key,
      anchorLeagueId: leagueId,
      hintSeason,
      hintLeagueKeys: pageHints.leagueKeys || null,
      hintSeasonYears: hintYears,
      franchiseSlugRange: slugRange,
      franchiseSlug,
      franchiseLeagueIds: franchiseSlug ? franchiseLeagueIds : null,
      fetchFranchiseSeasonHtml: franchiseSlug
        ? (slug, year) => fetchFranchiseSeasonPageHtml(tab, slug, year)
        : null,
      fetchJson
    });
    if (!chain.length) throw new Error("No Yahoo seasons were found for this league.");

    if (!franchiseSlug && chain.length === 1 && dropdownYears.length > 1) {
      log(
        "Only one season found. Yahoo gives a league a new ID when it is recreated, so older seasons can't be reached from this page. " +
          "Open a past season instead (from the season dropdown, or a URL like football.fantasysports.yahoo.com/league/<league-name>/2024) and click Find seasons again.",
        "error"
      );
    }
    log("Chain: " + chain.map((entry) => `${entry.season}=${entry.leagueKey}`).join(", "));
    return { leagueId, chain, fetchJson, years: pickerYears(chain, expectedProbeYears, dropdownYears) };
  },

  estimateSteps(entry) {
    return weekNumbersFromLeagueMetadata(entry.metadata || {}).length * 13 + 3;
  },

  async fetchSeason(scan, entry, { step, log, throwIfCancelled }) {
    const { fetchJson } = scan;
    step(`${entry.season} standings`);
    const bundle = await fetchYahooSeasonBundle(entry.leagueKey, fetchJson);
    bundle.metadata = bundle.metadata || entry.metadata;

    throwIfCancelled();
    step(`${entry.season} draft`);
    try {
      const draftPayload = await fetchJson(leagueDraftResultsUrl(entry.leagueKey));
      bundle.yahooDraftResults = parseLeagueDraftResults(draftPayload);
      if (bundle.yahooDraftResults?.picks?.length) {
        const settingsPayload = await fetchJson(leagueSettingsUrl(entry.leagueKey));
        bundle.yahooDraftSettings = parseLeagueDraftSettings(settingsPayload);
      }
    } catch (error) {
      if (!isYahooRetryableFetchError(error) || error?.status === 999) throw error;
      log(`${entry.season}: draft skipped (Yahoo returned a temporary error).`);
    }

    const weekData = await fetchSeasonWeekData({
      entry: { ...entry, metadata: bundle.metadata },
      fetchJson,
      onStep: step,
      throwIfCancelled
    });
    bundle.yahooScoreboardsByWeek = weekData.scoreboardsByWeek;
    bundle.yahooRosterPayloads = weekData.rosterPayloads;

    const weeksWithMatchups = Object.values(weekData.scoreboardsByWeek).filter(
      (scoreboard) => scoreboard?.matchups?.length
    ).length;
    return {
      bundle,
      summary: `${entry.season}: ${weeksWithMatchups} weeks of matchups, ${weekData.rosterPayloads.length} lineups.`
    };
  },

  buildArchive(scan, bundles) {
    return normalizeYahooImport({ providerLeagueId: scan.leagueId, seasonBundles: bundles });
  },

  friendlyError: friendlyYahooError,
  describeError: describeYahooError
};
