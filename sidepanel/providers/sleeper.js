// Sleeper adapter for the side panel. Sleeper's API is public, so a league link
// or id is all it needs; no tab or login.
import {
  createSleeperFetcher,
  discoverSleeperLeagueChain,
  fetchSleeperPlayers,
  fetchSleeperSeason,
  friendlySleeperError,
  isSleeperPage,
  SleeperApiError,
  sleeperLeagueIdFromInput,
  sleeperWeeks
} from "../../lib/sleeper-api.js";
import { normalizeSleeperImport } from "../../lib/sleeper-normalizer.js";

export const sleeperProvider = {
  id: "sleeper",
  label: "Sleeper",
  tabUrlPattern: "https://sleeper.com/*",
  pickerHint: "Sleeper's data is public, so downloads are quick and need no sign-in.",

  matchesTab(tab) {
    return isSleeperPage(tab?.url);
  },

  async targetFromTab(tab) {
    const leagueId = sleeperLeagueIdFromInput(tab.url);
    if (!leagueId) {
      return { error: "Sleeper is open, but not on a league page. Open your league on sleeper.com, or paste its link below." };
    }
    return { leagueId, status: `Sleeper league ${leagueId} detected.` };
  },

  targetFromInput(text) {
    const leagueId = sleeperLeagueIdFromInput(text);
    return leagueId ? { leagueId, status: `Sleeper league ${leagueId}.` } : null;
  },

  async scan(target, { log }) {
    const fetchJson = createSleeperFetcher();
    const chain = await discoverSleeperLeagueChain(target.leagueId, fetchJson);
    const latest = chain[chain.length - 1];
    log(`${latest.league.name}: ${chain.map((entry) => `${entry.season}=${entry.leagueId}`).join(", ")}.`);
    // Exports are keyed by the newest season's id, whichever season the link pointed at.
    return { leagueId: latest.leagueId, chain, fetchJson, years: chain.map((entry) => entry.season), players: null };
  },

  estimateSteps(entry) {
    return sleeperWeeks(entry.league).length + 3;
  },

  async fetchSeason(scan, entry, { step, log, throwIfCancelled }) {
    if (!scan.players) {
      step("Sleeper player list");
      try {
        scan.players = await fetchSleeperPlayers(scan.fetchJson);
      } catch (error) {
        scan.players = {};
        log(`Couldn't load Sleeper's player list, so some players will show ids instead of names (${error.message}).`);
      }
    }
    const bundle = await fetchSleeperSeason(entry, scan.fetchJson, { onStep: step, throwIfCancelled });
    const weeks = Object.keys(bundle.matchupsByWeek).length;
    const picks = bundle.drafts.reduce((sum, draft) => sum + draft.picks.length, 0);
    return { bundle, summary: `${entry.season}: ${weeks} weeks of matchups and lineups, ${picks} draft picks.` };
  },

  buildArchive(scan, bundles) {
    return normalizeSleeperImport({ providerLeagueId: scan.leagueId, seasonBundles: bundles, players: scan.players });
  },

  friendlyError: friendlySleeperError,
  describeError(error, requestUrl) {
    if (!(error instanceof SleeperApiError)) return null;
    return `${error.status} ${(requestUrl || error.url || "?").replace(/^https:\/\//, "")} | ${error.message}`;
  }
};
