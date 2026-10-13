// ESPN Fantasy Football's (undocumented) league API. Public leagues answer
// anyone; private leagues need the user's ESPN login cookies, which the browser
// attaches itself when requests go through an open fantasy.espn.com tab.
import { pacedRequester } from "./archive-utils.js";

export const ESPN_API_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
export const ESPN_API_HOST = "lm-api-reads.fantasy.espn.com";
export const ESPN_FANTASY_HOST = "fantasy.espn.com";
// ESPN serves 2018+ seasons from /seasons/<year>; older ones only from /leagueHistory.
const FIRST_MODERN_SEASON = 2018;

export const ESPN_BENCH_SLOT = 20;
export const ESPN_IR_SLOT = 21;

export const ESPN_POSITIONS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 7: "P", 9: "DT", 10: "DE", 11: "LB", 12: "CB", 13: "S", 14: "HC", 16: "DEF" };

export const ESPN_LINEUP_SLOTS = {
  0: "QB", 1: "TQB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 6: "TE", 7: "OP", 8: "DT", 9: "DE", 10: "LB",
  11: "DL", 12: "CB", 13: "S", 14: "DB", 15: "DP", 16: "DEF", 17: "K", 18: "P", 19: "HC", 20: "BN", 21: "IR", 23: "FLEX", 24: "ER"
};

export const ESPN_PRO_TEAMS = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC",
  13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT",
  24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU"
};

export class EspnApiError extends Error {
  constructor(message, status, url, details = {}) {
    super(message);
    this.name = "EspnApiError";
    this.status = status;
    this.url = url;
    this.details = details;
  }
}

/** League id and season from a fantasy.espn.com/football/...?leagueId=...&seasonId=... URL. */
export function espnLeagueFromUrl(input) {
  try {
    const url = new URL(String(input || "").trim());
    if (url.hostname !== ESPN_FANTASY_HOST || !url.pathname.startsWith("/football")) return null;
    const leagueId = url.searchParams.get("leagueId");
    if (!/^\d+$/.test(leagueId || "")) return null;
    const season = url.searchParams.get("seasonId");
    return { leagueId, season: /^\d{4}$/.test(season || "") ? season : null };
  } catch {
    return null;
  }
}

export function isEspnFantasyPage(url) {
  try {
    return new URL(url).hostname === ESPN_FANTASY_HOST;
  } catch {
    return false;
  }
}

export function isEspnApiUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === ESPN_API_HOST && url.pathname.startsWith("/apis/v3/games/ffl/");
  } catch {
    return false;
  }
}

function withParams(url, views, params) {
  const search = new URLSearchParams();
  for (const view of views) search.append("view", view);
  for (const [key, value] of Object.entries(params || {})) if (value != null) search.set(key, String(value));
  return `${url}${url.includes("?") ? "&" : "?"}${search}`;
}

export function espnLeagueUrl(leagueId, season, views = [], params = {}, { history = Number(season) < FIRST_MODERN_SEASON } = {}) {
  const base = history
    ? `${ESPN_API_BASE}/leagueHistory/${leagueId}?seasonId=${season}`
    : `${ESPN_API_BASE}/seasons/${season}/segments/0/leagues/${leagueId}`;
  return withParams(base, views, params);
}

export function espnPlayersUrl(season) {
  return withParams(`${ESPN_API_BASE}/seasons/${season}/players`, ["players_wl"], {});
}

export function scheduleFilter(matchupPeriodIds) {
  return JSON.stringify({ schedule: { filterMatchupPeriodIds: { value: matchupPeriodIds } } });
}

export function playersFilter(playerIds) {
  return JSON.stringify({ filterIds: { value: playerIds } });
}

/** `leagueHistory` answers with an array of league objects; pick the season's. */
export function unwrapEspnLeague(payload, season) {
  if (!Array.isArray(payload)) return payload;
  return payload.find((league) => String(league?.seasonId) === String(season)) || payload[0] || null;
}

/** Turns a fetch Response into a payload or an EspnApiError. Shared with the content script. */
export function parseEspnResponse(status, text, url) {
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new EspnApiError("ESPN returned a non-JSON response", status, url, { response_preview: text.slice(0, 300) });
  }
  if (status < 200 || status >= 300) {
    const message = payload?.messages?.[0] || payload?.details?.[0]?.message || `ESPN returned ${status}`;
    throw new EspnApiError(message, status, url, { response_preview: text.slice(0, 300) });
  }
  return payload;
}

async function fetchDirect(url, filter, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      credentials: "include",
      headers: { accept: "application/json", ...(filter ? { "x-fantasy-filter": filter } : {}) }
    });
  } catch (error) {
    throw new EspnApiError(error?.message || "Couldn't reach ESPN", 0, url, { source: "extension" });
  }
  return parseEspnResponse(response.status, await response.text(), url);
}

async function fetchViaTab(tab, url, filter) {
  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: "ESPN_FETCH_JSON", url, filter });
  } catch {
    return undefined; // content script not loaded (tab opened before install); fall back
  }
  if (!response) return undefined;
  if (response.ok) return response.payload;
  if (!response.status) return undefined;
  throw new EspnApiError(response.message || "ESPN request failed", response.status, url, {
    source: "espn_tab",
    response_preview: response.bodyPreview
  });
}

/**
 * Returns `fetchJson(url, { filter })`. With an ESPN tab, requests run inside it
 * so ESPN's own login cookies apply to private leagues; otherwise (or if the tab
 * can't answer) they go straight from the extension.
 */
export function createEspnFetcher({ tab = null, fetchImpl = (...args) => fetch(...args), minIntervalMs = 250 } = {}) {
  const request = async (url, { filter = null } = {}) => {
    if (!isEspnApiUrl(url)) throw new EspnApiError("ESPN API URL was not allowed", 0, url);
    if (tab?.id && isEspnFantasyPage(tab.url)) {
      const payload = await fetchViaTab(tab, url, filter);
      if (payload !== undefined) return payload;
    }
    return fetchDirect(url, filter, fetchImpl);
  };
  return pacedRequester(request, { minIntervalMs });
}

async function fetchLeague(fetchJson, leagueId, season, views, params, filter) {
  const options = filter ? { filter } : undefined;
  const modern = Number(season) >= FIRST_MODERN_SEASON;
  try {
    return unwrapEspnLeague(await fetchJson(espnLeagueUrl(leagueId, season, views, params), options), season);
  } catch (error) {
    // Some leagues only answer one of the two endpoints; older private seasons
    // 401 on /seasons even when signed in but answer /leagueHistory.
    if (!(error instanceof EspnApiError) || ![401, 404].includes(error.status)) throw error;
    const url = espnLeagueUrl(leagueId, season, views, params, { history: modern });
    try {
      return unwrapEspnLeague(await fetchJson(url, options), season);
    } catch (fallbackError) {
      if (fallbackError instanceof EspnApiError && fallbackError.status === 404) throw error;
      throw fallbackError;
    }
  }
}

const CORE_VIEWS = ["mTeam", "mSettings", "mStatus"];

export async function fetchEspnLeagueCore(fetchJson, leagueId, season) {
  return fetchLeague(fetchJson, leagueId, season, CORE_VIEWS);
}

/**
 * Finds every season of the league from its newest season's
 * `status.previousSeasons`. Tries this year first (so a link to an old season
 * still finds newer ones), then the linked `season`, then last year.
 */
export async function discoverEspnSeasons({ leagueId, season = null, fetchJson, now = new Date() }) {
  const year = now.getFullYear();
  const candidates = [...new Set([String(year), season && String(season), String(year - 1)].filter(Boolean))];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const core = await fetchEspnLeagueCore(fetchJson, leagueId, candidate);
      if (!core) continue;
      const latest = String(core.seasonId || candidate);
      const previous = (core.status?.previousSeasons || []).map(String);
      const seasons = [...new Set([...previous, latest])].sort((a, b) => Number(a) - Number(b));
      return { name: core.settings?.name || null, latestCore: core, seasons };
    } catch (error) {
      lastError = error;
      if (!(error instanceof EspnApiError) || ![401, 404].includes(error.status)) throw error;
    }
  }
  throw lastError || new EspnApiError("ESPN has no league with that id", 404, leagueId);
}

/** { matchupPeriodId: [scoringPeriodId, ...] } for the season, derived when ESPN omits it. */
export function espnMatchupPeriods(core, schedule = []) {
  const fromSettings = core?.settings?.scheduleSettings?.matchupPeriods;
  if (fromSettings && Object.keys(fromSettings).length) {
    return Object.fromEntries(
      Object.entries(fromSettings).map(([period, weeks]) => [period, weeks.map(Number).sort((a, b) => a - b)])
    );
  }
  const periods = [...new Set(schedule.map((matchup) => Number(matchup.matchupPeriodId)))];
  return Object.fromEntries(periods.map((period) => [String(period), [period]]));
}

/** NFL weeks (scoring periods) that have been played or are in progress. */
export function espnScoringPeriods(core, schedule = []) {
  const status = core?.status || {};
  const final = Number(status.finalScoringPeriod) || 18;
  const latest = Number(status.latestScoringPeriod) || final;
  const last = Math.min(final, latest);
  return Object.values(espnMatchupPeriods(core, schedule))
    .flat()
    .filter((week) => week <= last)
    .sort((a, b) => a - b);
}

export function matchupPeriodForWeek(periods, week) {
  const entry = Object.entries(periods).find(([, weeks]) => weeks.includes(week));
  return entry ? Number(entry[0]) : week;
}

/** Keeps only the lineup fields the normalizer uses (box scores are ~400 KB a week). */
export function parseEspnBoxscore(payload, week) {
  const lineups = [];
  for (const matchup of payload?.schedule || []) {
    for (const side of [matchup.home, matchup.away]) {
      const entries = side?.rosterForCurrentScoringPeriod?.entries;
      if (side?.teamId == null || !entries) continue;
      lineups.push({
        week,
        teamId: side.teamId,
        entries: entries.map((entry) => {
          const player = entry.playerPoolEntry?.player || {};
          return {
            playerId: entry.playerId ?? player.id,
            slotId: entry.lineupSlotId,
            points: entry.playerPoolEntry?.appliedStatTotal ?? null,
            fullName: player.fullName || null,
            positionId: player.defaultPositionId ?? null,
            proTeamId: player.proTeamId ?? null
          };
        })
      });
    }
  }
  return lineups;
}

/** Everything the normalizer needs for one season. */
export async function fetchEspnSeason(
  { leagueId, season, core = null },
  fetchJson,
  { onStep = () => {}, throwIfCancelled = () => {}, onWarning = () => {} } = {}
) {
  onStep(`${season} teams and standings`);
  const leagueCore = core || (await fetchEspnLeagueCore(fetchJson, leagueId, season));

  throwIfCancelled();
  onStep(`${season} schedule`);
  const schedule = (await fetchLeague(fetchJson, leagueId, season, ["mMatchupScore"]))?.schedule || [];

  throwIfCancelled();
  onStep(`${season} draft`);
  let draftDetail = null;
  try {
    draftDetail = (await fetchLeague(fetchJson, leagueId, season, ["mDraftDetail"]))?.draftDetail || null;
  } catch (error) {
    if (error?.status === 401) throw error;
    onWarning(`${season}: draft skipped (${error.message}).`);
  }

  const periods = espnMatchupPeriods(leagueCore, schedule);
  const lineups = [];
  for (const week of espnScoringPeriods(leagueCore, schedule)) {
    throwIfCancelled();
    onStep(`${season} week ${week} lineups`);
    try {
      const filter = scheduleFilter([matchupPeriodForWeek(periods, week)]);
      const payload = await fetchLeague(
        fetchJson,
        leagueId,
        season,
        ["mMatchupScore", "mBoxscore"],
        { scoringPeriodId: week },
        filter
      );
      lineups.push(...parseEspnBoxscore(payload, week));
    } catch (error) {
      if (error?.status === 401) throw error;
      onWarning(`${season} week ${week}: lineups skipped (${error.message}).`);
    }
  }

  return { leagueId, season: String(season), core: leagueCore, schedule, draftDetail, lineups, players: {} };
}

/** Names for players that never appeared in a lineup (e.g. drafted then dropped). */
export async function fetchEspnPlayers(fetchJson, season, playerIds) {
  const players = {};
  for (let index = 0; index < playerIds.length; index += 200) {
    const batch = playerIds.slice(index, index + 200);
    const payload = await fetchJson(espnPlayersUrl(season), { filter: playersFilter(batch) });
    for (const player of Array.isArray(payload) ? payload : []) {
      players[player.id] = {
        fullName: player.fullName,
        positionId: player.defaultPositionId,
        proTeamId: player.proTeamId
      };
    }
  }
  return players;
}

export function friendlyEspnError(error) {
  if (!(error instanceof EspnApiError)) return error?.message || "Something went wrong.";
  if (error.status === 401) {
    return "ESPN says this league is private. Sign in to ESPN in this browser, open the league at fantasy.espn.com, and try again from that tab.";
  }
  if (error.status === 404) return "ESPN couldn't find that league or season. Check the league link.";
  if (error.status === 429) return "ESPN is rate-limiting requests. Wait a minute and try again.";
  if (error.status === 0) return "Couldn't reach ESPN. Reload your ESPN tab and try again.";
  return error.message;
}
