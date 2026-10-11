// Sleeper's API is public and read-only (https://docs.sleeper.com), so no login
// or tab is needed. Each Sleeper season is its own league, linked to the season
// before it by `previous_league_id`.
import { pacedRequester } from "./archive-utils.js";

export const SLEEPER_API_BASE = "https://api.sleeper.app/v1";
const SLEEPER_HOSTS = new Set(["sleeper.com", "www.sleeper.com", "sleeper.app", "www.sleeper.app"]);
const SLEEPER_ID = /^\d{15,20}$/;

export class SleeperApiError extends Error {
  constructor(message, status, url) {
    super(message);
    this.name = "SleeperApiError";
    this.status = status;
    this.url = url;
  }
}

/** A Sleeper league id from a bare id or a sleeper.com/leagues/<id>/... URL. */
export function sleeperLeagueIdFromInput(input) {
  const text = String(input || "").trim();
  if (SLEEPER_ID.test(text)) return text;
  try {
    const url = new URL(text);
    if (!SLEEPER_HOSTS.has(url.hostname)) return null;
    const match = url.pathname.match(/\/leagues\/(\d{15,20})(?:\/|$)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function isSleeperPage(url) {
  try {
    return SLEEPER_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function fetchSleeperOnce(path, fetchImpl) {
  const url = `${SLEEPER_API_BASE}${path}`;
  let response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch (error) {
    throw new SleeperApiError(error?.message || "Couldn't reach Sleeper", 0, url);
  }
  if (!response.ok) throw new SleeperApiError(`Sleeper returned ${response.status}`, response.status, url);
  const text = await response.text();
  // Sleeper answers unknown ids with 200 and an empty body or `null`.
  if (!text || text === "null") return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new SleeperApiError("Sleeper returned a non-JSON response", response.status, url);
  }
}

/** Returns `fetchJson(path)` for paths under the Sleeper API base, e.g. `/league/<id>`. */
export function createSleeperFetcher({ fetchImpl = (...args) => fetch(...args), minIntervalMs = 120 } = {}) {
  return pacedRequester((path) => fetchSleeperOnce(path, fetchImpl), { minIntervalMs });
}

function validPreviousId(value) {
  const id = value == null ? "" : String(value);
  return SLEEPER_ID.test(id) && id !== "0" ? id : null;
}

/** Follows `previous_league_id` back from `leagueId`. Returns entries sorted oldest first. */
export async function discoverSleeperLeagueChain(leagueId, fetchJson) {
  const chain = [];
  const seen = new Set();
  let nextId = String(leagueId);
  while (nextId && !seen.has(nextId) && chain.length < 40) {
    seen.add(nextId);
    const league = await fetchJson(`/league/${nextId}`);
    if (!league) {
      if (!chain.length) throw new SleeperApiError("Sleeper has no league with that id", 404, nextId);
      break;
    }
    if (league.sport && league.sport !== "nfl") {
      throw new SleeperApiError("Only Sleeper NFL leagues are supported", 400, nextId);
    }
    chain.push({ season: String(league.season), leagueId: String(league.league_id), league });
    nextId = validPreviousId(league.previous_league_id);
  }
  return chain.sort((a, b) => Number(a.season) - Number(b.season));
}

/** NFL weeks that can have matchups for this league (empty before the draft). */
export function sleeperWeeks(league) {
  const settings = league?.settings || {};
  if (["pre_draft", "drafting"].includes(league?.status)) return [];
  const start = Math.max(1, Number(settings.start_week) || 1);
  // Weeks past the end of a league's season return no matchups and are dropped.
  const end = league?.status === "complete" ? 18 : Math.min(Number(settings.leg) || start, 18);
  const weeks = [];
  for (let week = start; week <= end; week += 1) weeks.push(week);
  return weeks;
}

/** Everything the normalizer needs for one season. */
export async function fetchSleeperSeason(entry, fetchJson, { onStep = () => {}, throwIfCancelled = () => {} } = {}) {
  const id = entry.leagueId;
  onStep(`${entry.season} league`);
  const league = entry.league || (await fetchJson(`/league/${id}`));
  const users = await fetchJson(`/league/${id}/users`);
  const rosters = await fetchJson(`/league/${id}/rosters`);

  throwIfCancelled();
  onStep(`${entry.season} playoffs`);
  const winnersBracket = (await fetchJson(`/league/${id}/winners_bracket`)) || [];
  const losersBracket = (await fetchJson(`/league/${id}/losers_bracket`)) || [];

  throwIfCancelled();
  onStep(`${entry.season} draft`);
  const drafts = [];
  for (const draft of (await fetchJson(`/league/${id}/drafts`)) || []) {
    const picks = (await fetchJson(`/draft/${draft.draft_id}/picks`)) || [];
    drafts.push({ draft, picks });
  }

  const matchupsByWeek = {};
  for (const week of sleeperWeeks(league)) {
    throwIfCancelled();
    onStep(`${entry.season} week ${week}`);
    const matchups = (await fetchJson(`/league/${id}/matchups/${week}`)) || [];
    // Weeks after the season (or a team's elimination) come back with no matchup ids.
    if (matchups.some((matchup) => matchup.matchup_id != null)) matchupsByWeek[String(week)] = matchups;
  }

  return { league, users: users || [], rosters: rosters || [], winnersBracket, losersBracket, drafts, matchupsByWeek };
}

/** Sleeper's full NFL player list (~2.5 MB). Sleeper asks callers to fetch it sparingly. */
export async function fetchSleeperPlayers(fetchJson) {
  return (await fetchJson("/players/nfl")) || {};
}

export function friendlySleeperError(error) {
  if (!(error instanceof SleeperApiError)) return error?.message || "Something went wrong.";
  if (error.status === 404) return "Sleeper couldn't find that league. Check the league link or id.";
  if (error.status === 429) return "Sleeper is rate-limiting requests. Wait a minute and try again.";
  if (error.status === 0) return "Couldn't reach Sleeper. Check your connection and try again.";
  return error.message;
}
