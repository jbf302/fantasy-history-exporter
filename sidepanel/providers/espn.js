// ESPN adapter for the side panel. Public leagues work from a pasted link;
// private leagues need an open, signed-in fantasy.espn.com tab, which requests
// are routed through so ESPN's own cookies apply.
import {
  createEspnFetcher,
  discoverEspnSeasons,
  espnLeagueFromUrl,
  espnScoringPeriods,
  EspnApiError,
  fetchEspnPlayers,
  fetchEspnSeason,
  friendlyEspnError,
  isEspnFantasyPage
} from "../../lib/espn-api.js";
import { espnPlayerIdsMissingNames, normalizeEspnImport } from "../../lib/espn-normalizer.js";

async function anyEspnTab() {
  const tabs = await chrome.tabs.query({ url: "https://fantasy.espn.com/*" });
  return tabs[0] || null;
}

export const espnProvider = {
  id: "espn",
  label: "ESPN",
  tabUrlPattern: "https://fantasy.espn.com/*",
  pickerHint: "ESPN needs about one request per week of each season, so even long histories finish in a few minutes.",

  matchesTab(tab) {
    return isEspnFantasyPage(tab?.url);
  },

  async targetFromTab(tab) {
    const league = espnLeagueFromUrl(tab.url);
    if (!league) {
      return { error: "ESPN is open, but not on a league page. Open your league's page on fantasy.espn.com, then come back here." };
    }
    return {
      tab,
      ...league,
      status: `ESPN league ${league.leagueId} detected. Private leagues need you signed in to ESPN in this browser.`
    };
  },

  targetFromInput(text) {
    const league = espnLeagueFromUrl(text);
    return league ? { ...league, status: `ESPN league ${league.leagueId}.` } : null;
  },

  async scan(target, { log }) {
    const tab = target.tab || (await anyEspnTab());
    const fetchJson = createEspnFetcher({ tab });
    if (!tab) log("No fantasy.espn.com tab is open, so only public leagues can be read.");
    const { name, latestCore, seasons } = await discoverEspnSeasons({
      leagueId: target.leagueId,
      season: target.season,
      fetchJson
    });
    log(`${name || "League"}: ESPN lists seasons ${seasons.join(", ")}.`);
    const latest = seasons[seasons.length - 1];
    const chain = seasons.map((season) => ({
      season,
      leagueId: target.leagueId,
      core: season === latest ? latestCore : null
    }));
    return { leagueId: target.leagueId, chain, fetchJson, years: seasons };
  },

  estimateSteps(entry) {
    return (entry.core ? espnScoringPeriods(entry.core).length : 17) + 4;
  },

  async fetchSeason(scan, entry, { step, log, throwIfCancelled }) {
    const bundle = await fetchEspnSeason(entry, scan.fetchJson, {
      onStep: step,
      throwIfCancelled,
      onWarning: (text) => log(text)
    });
    const missing = espnPlayerIdsMissingNames(bundle);
    if (missing.length) {
      step(`${entry.season} player names`);
      try {
        bundle.players = await fetchEspnPlayers(scan.fetchJson, entry.season, missing);
      } catch (error) {
        log(`${entry.season}: couldn't look up ${missing.length} player names (${error.message}).`);
      }
    }
    const weeks = new Set(bundle.lineups.map((lineup) => lineup.week)).size;
    const games = bundle.schedule.filter((matchup) => matchup.away).length;
    return { bundle, summary: `${entry.season}: ${games} matchups, ${weeks} weeks of lineups.` };
  },

  buildArchive(scan, bundles) {
    return normalizeEspnImport({ providerLeagueId: scan.leagueId, seasonBundles: bundles });
  },

  friendlyError: friendlyEspnError,
  describeError(error, requestUrl) {
    if (!(error instanceof EspnApiError)) return null;
    const url = (requestUrl || error.url || "?").replace(/^https:\/\//, "");
    return `${error.status} ${url} | ${String(error.message).slice(0, 200)}`;
  }
};
