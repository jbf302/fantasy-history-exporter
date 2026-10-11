export const YAHOO_API_BASE = "https://fantasysports.yahooapis.com/fantasy/v2";
export const YAHOO_PUB_RW_API_BASE = "https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2";
export const YAHOO_PUB_API_BASE = "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2";
const YAHOO_FETCH_BASES = [YAHOO_PUB_RW_API_BASE, YAHOO_API_BASE, YAHOO_PUB_API_BASE];
const YAHOO_REQUEST_TIMEOUT_MS = 30000;

/** NFL Yahoo game keys by season (see YFPY / games;game_codes=nfl;seasons=YYYY). */
export const NFL_GAME_KEYS_BY_SEASON = {
  2026: "470",
  2025: "461",
  2024: "449",
  2023: "423",
  2022: "414",
  2021: "406",
  2020: "399",
  2019: "390",
  2018: "380",
  2017: "371",
  2016: "359",
  2015: "348",
  2014: "331"
};

export const YAHOO_HISTORY_MIN_SEASON = 2014;

export function nflSeasonYearsDescending() {
  return Object.keys(NFL_GAME_KEYS_BY_SEASON)
    .map(Number)
    .filter((year) => Number.isFinite(year))
    .sort((a, b) => b - a);
}

export class YahooApiError extends Error {
  constructor(message, status, url, details = null) {
    super(message);
    this.name = "YahooApiError";
    this.status = status;
    this.url = url;
    this.details = details;
  }
}

function textByteLength(text) {
  return new TextEncoder().encode(text || "").length;
}

function withFormatJson(url) {
  const parsed = new URL(url);
  parsed.searchParams.set("format", "json");
  return parsed.toString();
}

export function yahooLeagueIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "football.fantasysports.yahoo.com") return null;
    const match = parsed.pathname.match(/\/f1\/(\d+)(?:\/|$)/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

export function yahooSeasonFromUrl(url) {
  try {
    const parsed = new URL(url);
    const f1Match = parsed.pathname.match(/^\/(\d{4})\/f1\//);
    if (f1Match?.[1]) return f1Match[1];
    const slugMatch = parsed.pathname.match(/\/league\/[^/]+\/(\d{4})(?:\/|$)/);
    return slugMatch?.[1] || null;
  } catch {
    return null;
  }
}

/** Custom league slug on `/league/{slug}/{season}` franchise URLs (not numeric). */
export function yahooLeagueSlugFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "football.fantasysports.yahoo.com") return null;
    const match = parsed.pathname.match(/^\/league\/([^/]+)\/(\d{4})(?:\/|$)/);
    const slug = match?.[1] || null;
    if (!slug || /^\d+$/.test(slug)) return null;
    return slug;
  } catch {
    return null;
  }
}

export function yahooFranchiseSeasonPageUrl(slug, season) {
  return `https://football.fantasysports.yahoo.com/league/${encodeURIComponent(String(slug))}/${encodeURIComponent(String(season))}`;
}

export function leagueKeyCandidatesFromFranchiseSeasonHtml(html, season) {
  const gameKey = NFL_GAME_KEYS_BY_SEASON[String(season)];
  if (!gameKey) return [];

  const text = String(html || "");
  const candidates = [];
  const seen = new Set();
  const push = (leagueKey) => {
    if (!leagueKey || seen.has(leagueKey)) return;
    if (!leagueKey.startsWith(`${gameKey}.l.`)) return;
    seen.add(leagueKey);
    candidates.push({
      leagueKey,
      leagueId: leagueIdFromLeagueKey(leagueKey),
      season: String(season)
    });
  };

  for (const match of text.matchAll(/"league_key"\s*:\s*"(\d{3}\.l\.\d+)"/g)) {
    push(match[1]);
  }
  for (const match of text.matchAll(/\\"league_key\\":\\"(\d{3}\.l\.\d+)\\"/g)) {
    push(match[1].replace(/\\"/g, ""));
  }
  for (const match of text.matchAll(new RegExp(`(${gameKey}\\.l\\.\\d+)\\b`, "g"))) {
    push(match[1]);
  }

  const leagueIds = leagueIdsFromYahooHtml(html);
  for (const leagueId of leagueIds) {
    const fromHtml = leagueKeyFromHtml(html, leagueId);
    if (fromHtml) push(fromHtml);
    push(leagueKeyFromParts(gameKey, leagueId));
  }

  return candidates;
}

export function leagueKeyHintsFromFranchiseSeasonHtml(html, season) {
  return leagueKeyCandidatesFromFranchiseSeasonHtml(html, season)[0] || null;
}

export function historicalSeasonYearsFromYahooSlugHtml(html, slug) {
  if (!slug) return [];
  const escaped = String(slug).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`/league/${escaped}/(\\d{4})\\b`, "g");
  const years = new Set();
  for (const match of String(html || "").matchAll(pattern)) {
    years.add(match[1]);
  }
  return [...years]
    .map(Number)
    .filter((year) => Number.isFinite(year) && year >= YAHOO_HISTORY_MIN_SEASON && year <= 2100)
    .sort((a, b) => a - b)
    .map(String);
}

export function metadataMatchesFranchiseSlug(metadata, franchiseSlug) {
  if (!franchiseSlug || !metadata) return true;
  const slug = String(franchiseSlug).toLowerCase();
  const url = String(metadata.url || "").toLowerCase();
  if (url.includes(`/league/${slug}/`)) return true;
  return String(metadata.name || "").toLowerCase().includes(slug);
}

export function leagueIdsFromYahooHtml(html) {
  const counts = new Map();
  const text = String(html || "");

  for (const match of text.matchAll(/\.l\.(\d+)\b/g)) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  for (const match of text.matchAll(/"league_id"\s*:\s*"(\d+)"/g)) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 3);
  }
  for (const match of text.matchAll(/\/f1\/(\d+)(?:\/|$)/g)) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 2);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([leagueId]) => leagueId);
}

export function historicalSeasonYearsFromYahooHtml(html, leagueId = null) {
  const years = new Set();
  const text = String(html || "");
  const idPattern = leagueId ? String(leagueId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : null;

  if (idPattern) {
    const f1Pattern = new RegExp(`/([0-9]{4})/f1/${idPattern}(?![0-9])`, "g");
    for (const match of text.matchAll(f1Pattern)) {
      years.add(match[1]);
    }
  }

  for (const match of text.matchAll(/\/league\/[^/'"]+\/(\d{4})\b/g)) {
    years.add(match[1]);
  }
  for (const match of text.matchAll(/data-season=["'](\d{4})["']/gi)) {
    years.add(match[1]);
  }
  for (const match of text.matchAll(/<option[^>]*value=["'](\d{4})["']/gi)) {
    years.add(match[1]);
  }
  for (const match of text.matchAll(/season[_-]?year["']?\s*[:=]\s*["']?(\d{4})/gi)) {
    years.add(match[1]);
  }

  if (!years.size && !idPattern) {
    for (const match of text.matchAll(/\/([0-9]{4})\/f1\/\d+/g)) {
      years.add(match[1]);
    }
  }

  return [...years]
    .map(Number)
    .filter((year) => Number.isFinite(year) && year >= YAHOO_HISTORY_MIN_SEASON && year <= 2100)
    .sort((a, b) => a - b)
    .map(String);
}

export function expandSeasonYearHints(
  seasonYears,
  {
    hintSeason = null,
    minSeason = YAHOO_HISTORY_MIN_SEASON,
    now = new Date(),
    franchiseSlugRange = false
  } = {}
) {
  const numeric = [
    ...new Set(
      (seasonYears || [])
        .map(Number)
        .filter(Number.isFinite)
        .concat(hintSeason != null ? [Number(hintSeason)] : [])
    )
  ];

  if (!numeric.length) return [];
  if (numeric.length === 1) {
    if (franchiseSlugRange) {
      const upper = Math.max(numeric[0], Number(hintSeason) || 0, now.getFullYear());
      const out = [];
      for (let year = minSeason; year <= upper; year += 1) {
        if (year >= minSeason) out.push(String(year));
      }
      return out;
    }
    return numeric.filter((year) => year >= minSeason).map(String);
  }

  const min = Math.min(...numeric);
  const upperBound = Math.max(...numeric, Number(hintSeason) || 0, now.getFullYear());
  const out = [];

  for (let year = min; year <= upperBound; year += 1) {
    if (year >= minSeason) out.push(String(year));
  }

  return out;
}

export function yahooLeaguePageUrl(leagueId) {
  return `https://football.fantasysports.yahoo.com/f1/${encodeURIComponent(String(leagueId))}`;
}

export function leagueKeyFromParts(gameKey, leagueId) {
  return `${gameKey}.l.${leagueId}`;
}

export function leagueIdFromLeagueKey(leagueKey) {
  const match = String(leagueKey || "").match(/\.l\.(\d+)(?:\b|$)/);
  return match?.[1] || null;
}

export function leagueKeyMatchesLeagueId(leagueKey, leagueId) {
  if (!leagueKey || leagueId == null) return false;
  return leagueIdFromLeagueKey(leagueKey) === String(leagueId);
}

export function yahooLeagueAccessDenied(message = "") {
  return /not in this league|not allowed to view this page because you are not in this league/i.test(
    String(message)
  );
}

export function isYahooLoginFailure(error) {
  if (!(error instanceof YahooApiError)) return false;
  if (![401, 403].includes(error.status)) return false;
  return !yahooLeagueAccessDenied(error.message);
}

export function yahooTransientServerError(message = "") {
  return /temporary problem|try again shortly|please try again|rate limit|too many requests|service unavailable|temporarily unavailable/i.test(
    String(message)
  );
}

export function isYahooRetryableFetchError(error) {
  if (!(error instanceof YahooApiError)) return false;
  if ([0, 401, 403, 404, 429].includes(error.status)) return true;
  if (error.status >= 500 && error.status <= 599) return true;
  return yahooTransientServerError(error.message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function leagueKeyFromRenew(renew) {
  const value = String(renew || "").trim();
  if (!value) return null;
  if (value.includes(".l.")) return value;

  const underscore = value.lastIndexOf("_");
  if (underscore <= 0) return null;

  const gameKey = value.slice(0, underscore);
  const leagueId = value.slice(underscore + 1);
  if (!/^\d+$/.test(gameKey) || !/^\d+$/.test(leagueId)) return null;
  return leagueKeyFromParts(gameKey, leagueId);
}

export function orderedNflGameKeys(hintSeason = null) {
  const keys = new Set(Object.values(NFL_GAME_KEYS_BY_SEASON));
  if (hintSeason && NFL_GAME_KEYS_BY_SEASON[hintSeason]) {
    keys.add(NFL_GAME_KEYS_BY_SEASON[hintSeason]);
  }
  return [...keys].sort((a, b) => Number(b) - Number(a));
}

function apiUrl(base, path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return withFormatJson(`${base}${normalized}`);
}

export function rewriteYahooUrlBase(url, base) {
  const parsed = new URL(url);
  const baseParsed = new URL(base.endsWith("/") ? base : `${base}/`);
  parsed.protocol = baseParsed.protocol;
  parsed.hostname = baseParsed.hostname;
  return parsed.toString();
}

export function leagueKeyPatternForId(leagueId) {
  return new RegExp(`(\\d{3})\\.l\\.${String(leagueId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
}

export function leagueKeyFromHtml(html, leagueId) {
  if (!html || !leagueId) return null;
  const match = String(html).match(leagueKeyPatternForId(leagueId));
  return match ? `${match[1]}.l.${leagueId}` : null;
}

export function leagueMetadataUrl(leagueKey, base = YAHOO_API_BASE) {
  return apiUrl(base, `/league/${encodeURIComponent(leagueKey)}/metadata`);
}

export function leagueSeasonBundleUrl(leagueKey, base = YAHOO_API_BASE) {
  return apiUrl(base, `/league/${encodeURIComponent(leagueKey)};out=metadata,standings,teams`);
}

export function leagueSettingsUrl(leagueKey, base = YAHOO_API_BASE) {
  return apiUrl(base, `/league/${encodeURIComponent(leagueKey)}/settings`);
}

export function leagueDraftResultsUrl(leagueKey, base = YAHOO_API_BASE) {
  return apiUrl(base, `/league/${encodeURIComponent(leagueKey)}/draftresults`);
}

export function userNflLeaguesUrl(base = YAHOO_API_BASE) {
  return apiUrl(base, "/users;use_login=1/games;game_codes=nfl/leagues");
}

export function flattenYahooBlock(block) {
  if (block == null) return {};
  if (!Array.isArray(block)) return typeof block === "object" ? { ...block } : {};

  const merged = {};
  for (const item of block) {
    if (item == null) continue;
    if (Array.isArray(item)) {
      Object.assign(merged, flattenYahooBlock(item));
      continue;
    }
    if (typeof item !== "object") continue;
    for (const [key, value] of Object.entries(item)) {
      merged[key] = value;
    }
  }
  return merged;
}

export function parseLeagueMetadata(payload) {
  const league = payload?.fantasy_content?.league;
  if (!league) return null;
  const meta = Array.isArray(league) ? flattenYahooBlock(league[0]) : flattenYahooBlock(league);
  return meta?.league_key ? meta : null;
}

export function parseLeagueSeasonBundle(payload) {
  const league = payload?.fantasy_content?.league;
  if (!Array.isArray(league) || !league.length) {
    throw new YahooApiError("Yahoo league response was missing fantasy_content.league", 0, null);
  }

  const metadata = flattenYahooBlock(league[0]);
  let standingsTeams = [];
  let rosterTeams = [];

  for (const chunk of league.slice(1)) {
    if (chunk?.standings) {
      standingsTeams = extractTeamsFromStandings(chunk.standings);
    }
    if (chunk?.teams) {
      rosterTeams = extractTeamsFromTeamsResource(chunk.teams);
    }
  }

  return {
    metadata,
    standingsTeams,
    rosterTeams
  };
}

function extractTeamsFromStandings(standingsNode) {
  const standings = Array.isArray(standingsNode) ? standingsNode[0] : standingsNode;
  const teamsNode = standings?.teams;
  if (!teamsNode || typeof teamsNode !== "object") return [];

  return Object.keys(teamsNode)
    .filter((key) => /^\d+$/.test(key))
    .map((key) => flattenYahooBlock(teamsNode[key]?.team))
    .filter((team) => team.team_id);
}

function extractTeamsFromTeamsResource(teamsNode) {
  if (!teamsNode || typeof teamsNode !== "object") return [];
  return Object.keys(teamsNode)
    .filter((key) => /^\d+$/.test(key))
    .map((key) => flattenYahooBlock(teamsNode[key]?.team))
    .filter((team) => team.team_id);
}

function leagueMatchesFromUserGamesPayload(payload, leagueId) {
  const user = payload?.fantasy_content?.users;
  const userBlock = Array.isArray(user) ? user[0]?.user : user?.user;
  const games = Array.isArray(userBlock) ? userBlock[1]?.games : userBlock?.games;
  if (!games) return [];

  const gameEntries = [];
  if (Array.isArray(games)) {
    for (const entry of games) {
      if (entry?.game) gameEntries.push(entry.game);
    }
  } else if (typeof games === "object") {
    for (const key of Object.keys(games)) {
      if (/^\d+$/.test(key) && games[key]?.game) gameEntries.push(games[key].game);
    }
  }

  const matches = [];
  const seenKeys = new Set();

  for (const gameEntry of gameEntries) {
    const game = Array.isArray(gameEntry) ? flattenYahooBlock(gameEntry[0]) : flattenYahooBlock(gameEntry);
    const leaguesNode = Array.isArray(gameEntry) ? gameEntry[1]?.leagues : gameEntry?.leagues;
    if (!leaguesNode) continue;

    const leagueList = [];
    if (Array.isArray(leaguesNode)) {
      for (const entry of leaguesNode) {
        if (entry?.league) leagueList.push(flattenYahooBlock(entry.league));
      }
    } else if (typeof leaguesNode === "object") {
      for (const key of Object.keys(leaguesNode)) {
        if (/^\d+$/.test(key) && leaguesNode[key]?.league) {
          leagueList.push(flattenYahooBlock(leaguesNode[key].league));
        }
      }
    }

    for (const league of leagueList) {
      if (String(league.league_id) !== String(leagueId) || !league.league_key) continue;
      if (seenKeys.has(league.league_key)) continue;
      seenKeys.add(league.league_key);
      matches.push({
        league_key: league.league_key,
        season: league.season || game.season || null,
        name: league.name || null
      });
    }
  }

  return matches.sort((a, b) => Number(b.season) - Number(a.season));
}

export function findAllLeagueKeysInUserGames(payload, leagueId) {
  return leagueMatchesFromUserGamesPayload(payload, leagueId);
}

function findLeagueKeyInUserGames(payload, leagueId) {
  return leagueMatchesFromUserGamesPayload(payload, leagueId)[0] || null;
}

async function fetchYahooJsonOnce(url, { credentials = "include", requestHeaders = null } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), YAHOO_REQUEST_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(url, {
      credentials,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(requestHeaders || {})
      }
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new YahooApiError("Yahoo request timed out", 0, url);
    }
    throw new YahooApiError(error.message || "Yahoo request failed", 0, url);
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  const details = {
    final_url: response.url,
    content_type: response.headers.get("content-type"),
    byte_length: textByteLength(text),
    response_preview: text
  };

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new YahooApiError("Yahoo returned a non-JSON response", response.status, url, details);
  }

  if (payload?.error) {
    const description = payload.error.description || "Yahoo request failed";
    const accessDenied = yahooLeagueAccessDenied(description);
    const needsLogin =
      !accessDenied &&
      /log(?:ged)?\s*in|credentials|Unauthorized|unable_to_determine_oauth/i.test(description);
    throw new YahooApiError(
      needsLogin ? "Yahoo login required" : description,
      needsLogin ? 401 : response.status || 400,
      url,
      details
    );
  }

  if (!response.ok) {
    throw new YahooApiError(`Yahoo returned ${response.status}`, response.status, url, details);
  }

  return payload;
}

export async function fetchYahooJson(url, { requestHeaders = null } = {}) {
  let lastError = null;

  for (const base of YAHOO_FETCH_BASES) {
    const requestUrl = rewriteYahooUrlBase(url, base);
    try {
      return await fetchYahooJsonOnce(requestUrl, { requestHeaders });
    } catch (error) {
      lastError = error;
      if (!(error instanceof YahooApiError)) throw error;
      if ([401, 403, 404].includes(error.status)) continue;
      if (isYahooRetryableFetchError(error)) continue;
      throw error;
    }
  }

  throw (
    lastError ||
    new YahooApiError("Yahoo request failed", 0, url)
  );
}

async function metadataForLeagueKey(leagueKey, leagueId, hintSeason, fetchJson) {
  const payload = await fetchJson(leagueMetadataUrl(leagueKey));
  const metadata = parseLeagueMetadata(payload);
  if (!metadata || String(metadata.league_id) !== String(leagueId)) return null;
  return {
    league_key: metadata.league_key || leagueKey,
    season: metadata.season || hintSeason,
    name: metadata.name || null
  };
}

export async function resolveYahooLeagueKey({
  leagueId,
  hintSeason = null,
  hintLeagueKey = null,
  fetchJson = fetchYahooJson
}) {
  if (hintLeagueKey && leagueKeyMatchesLeagueId(hintLeagueKey, leagueId)) {
    try {
      const resolved = await metadataForLeagueKey(hintLeagueKey, leagueId, hintSeason, fetchJson);
      if (resolved) return resolved;
    } catch (error) {
      // A stale or wrong page hint must not block account lookup / game-key resolution.
      if (!(error instanceof YahooApiError)) throw error;
    }
  }

  if (hintSeason && NFL_GAME_KEYS_BY_SEASON[hintSeason]) {
    const seasonLeagueKey = leagueKeyFromParts(NFL_GAME_KEYS_BY_SEASON[hintSeason], leagueId);
    try {
      const resolved = await metadataForLeagueKey(seasonLeagueKey, leagueId, hintSeason, fetchJson);
      if (resolved) return resolved;
    } catch (error) {
      if (!(error instanceof YahooApiError)) throw error;
    }
  }

  try {
    const userPayload = await fetchJson(userNflLeaguesUrl());
    const fromAccount = findLeagueKeyInUserGames(userPayload, leagueId);
    if (fromAccount?.league_key) return fromAccount;
  } catch {
    // Account league list is optional; private leagues still resolve via metadata.
  }

  let sawAuthFailure = false;
  for (const gameKey of orderedNflGameKeys(hintSeason)) {
    const leagueKey = leagueKeyFromParts(gameKey, leagueId);
    try {
      const resolved = await metadataForLeagueKey(leagueKey, leagueId, hintSeason, fetchJson);
      if (resolved) return resolved;
    } catch (error) {
      if (isYahooLoginFailure(error)) {
        sawAuthFailure = true;
        continue;
      }
    }
  }

  if (sawAuthFailure) {
    throw new YahooApiError(
      "Yahoo login required. Stay signed in on football.fantasysports.yahoo.com, reload the league page, then try again.",
      401,
      leagueMetadataUrl(leagueKeyFromParts(orderedNflGameKeys(hintSeason)[0], leagueId))
    );
  }

  throw new YahooApiError(
    `Could not resolve a Yahoo league key for league ${leagueId}. Open the league while signed in to Yahoo.`,
    404,
    leagueMetadataUrl(leagueKeyFromParts(orderedNflGameKeys(hintSeason)[0], leagueId))
  );
}

function isRecoverableSeasonProbeError(error) {
  if (!(error instanceof YahooApiError)) return true;
  if (error.status === 404) return true;
  if (yahooLeagueAccessDenied(error.message)) return true;
  if (isYahooRetryableFetchError(error)) return true;
  return false;
}

async function fetchSeasonMetadataEntry(leagueKey, anchorId, fetchJson) {
  if (anchorId && leagueIdFromLeagueKey(leagueKey) && leagueIdFromLeagueKey(leagueKey) !== String(anchorId)) {
    return null;
  }

  const payload = await fetchJson(leagueMetadataUrl(leagueKey));
  const metadata = parseLeagueMetadata(payload);
  if (!metadata?.season) return null;
  if (anchorId && String(metadata.league_id) !== String(anchorId)) return null;

  return {
    leagueKey: metadata.league_key || leagueKey,
    season: String(metadata.season),
    metadata
  };
}

async function tryFetchSeasonMetadataEntry(leagueKey, anchorId, fetchJson) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchSeasonMetadataEntry(leagueKey, anchorId, fetchJson);
    } catch (error) {
      if (isYahooLoginFailure(error)) throw error;
      if (isRecoverableSeasonProbeError(error)) {
        if (yahooTransientServerError(error.message) && attempt === 0) {
          await sleep(450);
          continue;
        }
        return null;
      }
      throw error;
    }
  }
  return null;
}

async function fetchFranchiseSeasonMetadataEntry(
  leagueKey,
  fetchJson,
  { franchiseSlug, expectedSeason = null } = {}
) {
  const payload = await fetchJson(leagueMetadataUrl(leagueKey));
  const metadata = parseLeagueMetadata(payload);
  if (!metadata?.season) return null;
  if (expectedSeason != null && String(metadata.season) !== String(expectedSeason)) return null;
  if (!metadataMatchesFranchiseSlug(metadata, franchiseSlug)) return null;

  return {
    leagueKey: metadata.league_key || leagueKey,
    season: String(metadata.season),
    metadata
  };
}

async function tryFetchFranchiseSeasonEntry(leagueKey, fetchJson, options = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchFranchiseSeasonMetadataEntry(leagueKey, fetchJson, options);
    } catch (error) {
      if (isYahooLoginFailure(error)) throw error;
      if (isRecoverableSeasonProbeError(error)) {
        if (yahooTransientServerError(error.message) && attempt === 0) {
          await sleep(450);
          continue;
        }
        return null;
      }
      throw error;
    }
  }
  return null;
}

async function seedSeasonsFromLeagueKeyHints({
  bySeason,
  anchorId,
  fetchJson,
  seenKeys,
  maxSeasons,
  leagueKeys = [],
  franchiseSlug = null
}) {
  for (const leagueKey of leagueKeys) {
    if (bySeason.size >= maxSeasons) break;
    if (!leagueKey || seenKeys.has(leagueKey)) continue;
    if (
      !franchiseSlug &&
      anchorId &&
      leagueIdFromLeagueKey(leagueKey) &&
      leagueIdFromLeagueKey(leagueKey) !== String(anchorId)
    ) {
      continue;
    }

    seenKeys.add(leagueKey);
    await sleep(80);
    const entry = franchiseSlug
      ? await tryFetchFranchiseSeasonEntry(leagueKey, fetchJson, { franchiseSlug })
      : await tryFetchSeasonMetadataEntry(leagueKey, anchorId, fetchJson);
    if (entry && !bySeason.has(entry.season)) {
      bySeason.set(entry.season, entry);
    }
  }
}

async function seedSeasonsFromFranchiseSlugPages({
  bySeason,
  fetchJson,
  seenKeys,
  maxSeasons,
  seasonYears = [],
  fetchFranchiseSeasonHtml = null
}) {
  if (typeof fetchFranchiseSeasonHtml !== "function" || !seasonYears.length) return;

  for (const year of seasonYears) {
    if (bySeason.size >= maxSeasons) break;
    if (bySeason.has(String(year))) continue;

    let html = await fetchFranchiseSeasonHtml(String(year));
    if (!html) {
      await sleep(200);
      html = await fetchFranchiseSeasonHtml(String(year));
    }
    if (!html) continue;

    const candidates = leagueKeyCandidatesFromFranchiseSeasonHtml(html, year);
    for (const hint of candidates) {
      if (!hint?.leagueKey) continue;

      await sleep(120);
      let entry = await tryFetchSeasonMetadataEntry(hint.leagueKey, null, fetchJson);
      if (entry && String(entry.season) !== String(year)) entry = null;
      if (!entry) continue;

      seenKeys.add(hint.leagueKey);
      if (!bySeason.has(entry.season)) {
        bySeason.set(entry.season, entry);
      }
      break;
    }
  }
}

async function seedSeasonsFromSeasonYearHints({
  bySeason,
  anchorId,
  fetchJson,
  seenKeys,
  maxSeasons,
  seasonYears = [],
  franchiseSlug = null,
  franchiseLeagueIds = null
}) {
  const probeLeagueIds =
    franchiseSlug && franchiseLeagueIds?.length
      ? [...new Set(franchiseLeagueIds.map(String).filter(Boolean))]
      : anchorId
        ? [String(anchorId)]
        : [];

  for (const year of seasonYears) {
    if (bySeason.size >= maxSeasons) break;

    const gameKey = NFL_GAME_KEYS_BY_SEASON[String(year)];
    if (!gameKey) continue;

    for (const leagueId of probeLeagueIds) {
      const leagueKey = leagueKeyFromParts(gameKey, leagueId);
      if (seenKeys.has(leagueKey) && bySeason.has(String(year))) continue;

      await sleep(80);
      const entry = franchiseSlug
        ? await tryFetchFranchiseSeasonEntry(leagueKey, fetchJson, {
            franchiseSlug,
            expectedSeason: year
          })
        : await tryFetchSeasonMetadataEntry(leagueKey, anchorId, fetchJson);
      if (entry && String(entry.season) === String(year) && !bySeason.has(entry.season)) {
        seenKeys.add(leagueKey);
        bySeason.set(entry.season, entry);
        break;
      }
    }
  }
}

async function seedSeasonsFromUserAccountLeagues({
  bySeason,
  anchorId,
  fetchJson,
  seenKeys,
  maxSeasons
}) {
  try {
    const payload = await fetchJson(userNflLeaguesUrl());
    const matches = findAllLeagueKeysInUserGames(payload, anchorId);
    await seedSeasonsFromLeagueKeyHints({
      bySeason,
      anchorId,
      fetchJson,
      seenKeys,
      maxSeasons,
      leagueKeys: matches.map((match) => match.league_key)
    });
  } catch {
    // Account league list is optional for discovery.
  }
}

async function extendYahooLeagueChainViaRenew({
  bySeason,
  anchorId,
  fetchJson,
  seenKeys,
  maxSeasons,
  franchiseSlug = null
}) {
  let progressed = true;

  while (progressed && bySeason.size < maxSeasons) {
    progressed = false;

    for (const entry of [...bySeason.values()]) {
      const nextKey = leagueKeyFromRenew(entry.metadata?.renew);
      if (!nextKey || seenKeys.has(nextKey)) continue;

      const nextLeagueId = leagueIdFromLeagueKey(nextKey);
      const crossLeagueId = anchorId && nextLeagueId && nextLeagueId !== anchorId;
      if (crossLeagueId && !franchiseSlug) continue;

      seenKeys.add(nextKey);
      await sleep(120);
      const older = crossLeagueId
        ? await tryFetchFranchiseSeasonEntry(nextKey, fetchJson, { franchiseSlug })
        : await tryFetchSeasonMetadataEntry(nextKey, anchorId, fetchJson);
      if (!older || bySeason.has(older.season)) continue;

      bySeason.set(older.season, older);
      progressed = true;
    }
  }
}

export async function discoverYahooLeagueChain({
  startLeagueKey,
  anchorLeagueId = null,
  hintSeason = null,
  hintLeagueKeys = null,
  hintSeasonYears = null,
  franchiseSlugRange = false,
  franchiseSlug = null,
  franchiseLeagueIds = null,
  fetchFranchiseSeasonHtml = null,
  fetchJson = fetchYahooJson,
  maxSeasons = 25,
  minSeason = YAHOO_HISTORY_MIN_SEASON
}) {
  const anchorId = anchorLeagueId != null ? String(anchorLeagueId) : leagueIdFromLeagueKey(startLeagueKey);
  if (anchorId && startLeagueKey && leagueIdFromLeagueKey(startLeagueKey) !== anchorId) {
    throw new YahooApiError(
      `Yahoo league key ${startLeagueKey} does not match league ${anchorId}.`,
      404,
      leagueMetadataUrl(startLeagueKey)
    );
  }

  const bySeason = new Map();
  const seenKeys = new Set();
  let leagueKey = startLeagueKey;

  await seedSeasonsFromUserAccountLeagues({
    bySeason,
    anchorId,
    fetchJson,
    seenKeys,
    maxSeasons
  });

  if (Array.isArray(hintLeagueKeys) && hintLeagueKeys.length) {
    await seedSeasonsFromLeagueKeyHints({
      bySeason,
      anchorId,
      fetchJson,
      seenKeys,
      maxSeasons,
      leagueKeys: hintLeagueKeys,
      franchiseSlug
    });
  }

  const expandedSeasonYears = expandSeasonYearHints(hintSeasonYears, {
    hintSeason,
    minSeason,
    franchiseSlugRange
  });
  const franchiseIds = franchiseLeagueIds?.length
    ? franchiseLeagueIds
    : anchorId
      ? [anchorId]
      : [];

  // A league that was recreated gets a new numeric id, so probing the same id
  // under every year's game key mostly burns requests (and Yahoo throttles
  // bursts). When the page gives us the league's name slug, resolve each season
  // through Yahoo's own /league/<slug>/<year> pages first and only fall back to
  // id probing if that route found nothing.
  const slugRouteAvailable = Boolean(franchiseSlug && fetchFranchiseSeasonHtml && expandedSeasonYears.length);
  let slugRouteRan = false;
  if (slugRouteAvailable) {
    await seedSeasonsFromFranchiseSlugPages({
      bySeason,
      fetchJson,
      seenKeys,
      maxSeasons,
      seasonYears: expandedSeasonYears,
      fetchFranchiseSeasonHtml: (year) => fetchFranchiseSeasonHtml(franchiseSlug, year)
    });
    slugRouteRan = true;
  }
  const slugRouteWorked = slugRouteRan && bySeason.size > 1;

  if (expandedSeasonYears.length && !slugRouteWorked) {
    await seedSeasonsFromSeasonYearHints({
      bySeason,
      anchorId,
      fetchJson,
      seenKeys,
      maxSeasons,
      seasonYears: expandedSeasonYears,
      franchiseSlug,
      franchiseLeagueIds: franchiseSlug ? franchiseIds : null
    });
  }

  while (leagueKey && !seenKeys.has(leagueKey) && bySeason.size < maxSeasons) {
    seenKeys.add(leagueKey);
    const entry = await tryFetchSeasonMetadataEntry(leagueKey, anchorId, fetchJson);
    if (!entry) {
      if (bySeason.size) break;
      throw new YahooApiError(
        "Could not load Yahoo league metadata for the current season.",
        404,
        leagueMetadataUrl(leagueKey)
      );
    }

    bySeason.set(entry.season, entry);

    const nextKey = leagueKeyFromRenew(entry.metadata.renew);
    if (!nextKey) break;
    const nextLeagueId = leagueIdFromLeagueKey(nextKey);
    if (anchorId && nextLeagueId && nextLeagueId !== anchorId) break;
    leagueKey = nextKey;
  }

  const knownSeasonNumbers = [...bySeason.keys()].map(Number).filter(Number.isFinite);
  let highSeason = Math.max(hintSeason ? Number(hintSeason) : 0, ...knownSeasonNumbers, 0);

  if (!bySeason.size && startLeagueKey) {
    const startEntry = await tryFetchSeasonMetadataEntry(startLeagueKey, anchorId, fetchJson);
    if (startEntry) {
      bySeason.set(startEntry.season, startEntry);
      highSeason = Math.max(highSeason, Number(startEntry.season));
    }
  }

  let consecutiveMisses = 0;
  for (const year of slugRouteWorked ? [] : nflSeasonYearsDescending()) {
    if (bySeason.size >= maxSeasons) break;
    if (year > highSeason) continue;
    if (year < minSeason) break;
    if (bySeason.has(String(year))) continue;

    const gameKey = NFL_GAME_KEYS_BY_SEASON[String(year)];
    if (!gameKey) continue;

    let entry = null;
    const backfillIds = franchiseSlug && franchiseIds.length ? franchiseIds : anchorId ? [anchorId] : [];
    for (const leagueId of backfillIds) {
      const candidateKey = leagueKeyFromParts(gameKey, leagueId);
      if (seenKeys.has(candidateKey)) continue;
      seenKeys.add(candidateKey);

      await sleep(120);
      entry = franchiseSlug
        ? await tryFetchFranchiseSeasonEntry(candidateKey, fetchJson, {
            franchiseSlug,
            expectedSeason: year
          })
        : await tryFetchSeasonMetadataEntry(candidateKey, anchorId, fetchJson);
      if (entry && String(entry.season) === String(year)) break;
      entry = null;
    }

    if (entry) {
      bySeason.set(entry.season, entry);
      consecutiveMisses = 0;
      continue;
    }

    consecutiveMisses += 1;
    if (consecutiveMisses >= 10) break;
  }

  // Game-key backfill may add 2025 after starting on a poisoned 2026 renew; follow
  // each season's renew link until the chain is exhausted (e.g. 2025 -> 2024).
  await extendYahooLeagueChainViaRenew({
    bySeason,
    anchorId,
    fetchJson,
    seenKeys,
    maxSeasons,
    franchiseSlug
  });

  if (franchiseSlug && fetchFranchiseSeasonHtml && !slugRouteRan) {
    await seedSeasonsFromFranchiseSlugPages({
      bySeason,
      fetchJson,
      seenKeys,
      maxSeasons,
      seasonYears: expandedSeasonYears,
      fetchFranchiseSeasonHtml: (year) => fetchFranchiseSeasonHtml(franchiseSlug, year)
    });
  }

  return [...bySeason.values()].sort((a, b) => Number(a.season) - Number(b.season));
}

export function teamKeyFromParts(leagueKey, teamId) {
  return `${leagueKey}.t.${teamId}`;
}

export function leagueScoreboardUrl(leagueKey, week, base = YAHOO_API_BASE) {
  return apiUrl(base, `/league/${encodeURIComponent(leagueKey)}/scoreboard;week=${encodeURIComponent(String(week))}`);
}

export function teamRosterWeekUrl(teamKey, week, base = YAHOO_API_BASE) {
  return apiUrl(base, `/team/${encodeURIComponent(teamKey)}/roster;week=${encodeURIComponent(String(week))}`);
}

/** Weekly roster plus per-player fantasy points (required for NFL lineup scores). */
export function teamRosterWeekStatsUrl(teamKey, week, base = YAHOO_API_BASE) {
  const encodedTeam = encodeURIComponent(teamKey);
  const encodedWeek = encodeURIComponent(String(week));
  return apiUrl(
    base,
    `/team/${encodedTeam}/roster;week=${encodedWeek}/players/stats;type=week;week=${encodedWeek}`
  );
}

export function weekNumbersFromLeagueMetadata(metadata = {}) {
  const start = Number(metadata.start_week) || 1;
  let end = Number(metadata.end_week) || start;
  const current = Number(metadata.current_week);
  const finished = metadata.is_finished === "1" || metadata.is_finished === 1;

  if (!finished && Number.isFinite(current) && current > 0) {
    end = Math.min(end, current);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];

  const weeks = [];
  for (let week = start; week <= end; week += 1) weeks.push(week);
  return weeks;
}

function numericKeyedChildren(node) {
  if (!node || typeof node !== "object") return [];
  return Object.keys(node)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => node[key]);
}

function flattenYahooTeamBlock(teamBlock) {
  if (!Array.isArray(teamBlock)) return flattenYahooBlock(teamBlock);

  const merged = {};
  for (const chunk of teamBlock) {
    if (Array.isArray(chunk)) {
      for (const sub of chunk) Object.assign(merged, flattenYahooBlock(sub));
    } else {
      Object.assign(merged, flattenYahooBlock(chunk));
    }
  }
  return merged;
}

function flattenYahooPlayerBlock(playerBlock) {
  if (!Array.isArray(playerBlock)) return flattenYahooBlock(playerBlock);

  const merged = {};
  for (const chunk of playerBlock) {
    if (Array.isArray(chunk)) {
      for (const sub of chunk) Object.assign(merged, flattenYahooBlock(sub));
    } else {
      Object.assign(merged, flattenYahooBlock(chunk));
    }
  }
  return merged;
}

function extractTeamsFromMatchupTeamsNode(teamsNode) {
  if (!teamsNode || typeof teamsNode !== "object") return [];

  return numericKeyedChildren(teamsNode)
    .map((entry) => flattenYahooTeamBlock(entry?.team))
    .filter((team) => team.team_id);
}

function collectMatchupsFromNode(matchupsNode, defaultWeek, matchups) {
  if (!matchupsNode) return;

  const entries = Array.isArray(matchupsNode)
    ? matchupsNode
    : numericKeyedChildren(matchupsNode);

  for (const entry of entries) {
    const parsed = parseScoreboardMatchupEntry(entry?.matchup || entry, defaultWeek);
    if (parsed) matchups.push(parsed);
  }
}

function parseScoreboardMatchupEntry(matchupEntry, defaultWeek) {
  if (Array.isArray(matchupEntry)) {
    let meta = {};
    let teamsNode = null;

    for (const block of matchupEntry) {
      if (!block || typeof block !== "object") continue;
      if (block.teams) teamsNode = block.teams;
      else Object.assign(meta, flattenYahooBlock(block));
    }

    const teams = extractTeamsFromMatchupTeamsNode(teamsNode);
    if (!teams.length) return null;

    return {
      week: String(meta.week || defaultWeek || ""),
      status: meta.status || null,
      is_playoffs: meta.is_playoffs,
      is_consolation: meta.is_consolation,
      is_tied: meta.is_tied,
      winner_team_key: meta.winner_team_key || null,
      teams
    };
  }

  if (!matchupEntry || typeof matchupEntry !== "object") return null;
  if (matchupEntry.matchup) return parseScoreboardMatchupEntry(matchupEntry.matchup, defaultWeek);

  let meta = {};
  let teamsNode = null;

  for (const [key, value] of Object.entries(matchupEntry)) {
    if (!value || typeof value !== "object") continue;
    if (key === "teams") {
      teamsNode = value;
    } else if (/^\d+$/.test(key) && value.teams) {
      teamsNode = value.teams;
    } else if (!/^\d+$/.test(key) && key !== "stat_winners") {
      Object.assign(meta, flattenYahooBlock(value));
    }
  }

  for (const [key, value] of Object.entries(matchupEntry)) {
    if (/^\d+$/.test(key) || key === "stat_winners" || key === "teams") continue;
    if (value == null || typeof value === "object") continue;
    meta[key] = value;
  }

  const teams = extractTeamsFromMatchupTeamsNode(teamsNode);
  if (!teams.length) return null;

  return {
    week: String(meta.week || defaultWeek || ""),
    status: meta.status || null,
    is_playoffs: meta.is_playoffs,
    is_consolation: meta.is_consolation,
    is_tied: meta.is_tied,
    winner_team_key: meta.winner_team_key || null,
    teams
  };
}

export function teamWeekPoints(team) {
  const weekPoints = team?.team_points;
  if (weekPoints && String(weekPoints.coverage_type || "").toLowerCase() === "week") {
    const total = Number(weekPoints.total);
    if (Number.isFinite(total)) return total;
  }

  const points = team?.points;
  if (points && String(points.coverage_type || "").toLowerCase() === "week") {
    const total = Number(points.total);
    if (Number.isFinite(total)) return total;
  }

  const direct = Number(team?.team_points?.total ?? team?.points?.total);
  return Number.isFinite(direct) ? direct : null;
}

export function parseLeagueScoreboard(payload, weekHint = null) {
  const league = payload?.fantasy_content?.league;
  if (!Array.isArray(league) || !league.length) {
    return { week: weekHint != null ? String(weekHint) : null, matchups: [] };
  }

  let scoreboardWrap = null;
  for (const chunk of league) {
    if (chunk?.scoreboard) {
      scoreboardWrap = chunk.scoreboard;
      break;
    }
  }

  if (!scoreboardWrap) {
    return { week: weekHint != null ? String(weekHint) : null, matchups: [] };
  }

  const scoreboard = Array.isArray(scoreboardWrap) ? scoreboardWrap[0] : scoreboardWrap;
  const week =
    weekHint != null
      ? String(weekHint)
      : scoreboard?.week != null
        ? String(scoreboard.week)
        : null;
  const matchups = [];

  collectMatchupsFromNode(scoreboard?.matchups, week, matchups);
  for (const child of numericKeyedChildren(scoreboard)) {
    collectMatchupsFromNode(child?.matchups, week || child?.week, matchups);
  }

  return {
    week: week || matchups[0]?.week || null,
    matchups
  };
}

export function scoreboardHasMatchups(scoreboard) {
  return Boolean(scoreboard?.matchups?.length);
}

function findPlayersNode(rosterNode) {
  if (!rosterNode) return null;
  const roster = Array.isArray(rosterNode) ? rosterNode[0] : rosterNode;
  if (!roster || typeof roster !== "object") return null;
  if (roster.players) return roster.players;

  for (const child of numericKeyedChildren(roster)) {
    if (child?.players) return child.players;
  }

  return null;
}

function selectedPositionFromPlayer(player) {
  const selected = player?.selected_position;
  if (!selected) return null;
  if (typeof selected === "string") return selected;
  if (Array.isArray(selected)) {
    for (const chunk of selected) {
      const flat = flattenYahooBlock(chunk);
      if (flat.position) return flat.position;
      if (Array.isArray(chunk)) {
        for (const sub of chunk) {
          const nested = flattenYahooBlock(sub);
          if (nested.position) return nested.position;
        }
      }
    }
  }
  if (typeof selected === "object") {
    const flat = flattenYahooBlock(selected);
    return flat.position || null;
  }
  return null;
}

function isBenchOrIrPosition(position) {
  const value = String(position || "").toUpperCase();
  return value === "BN" || value === "IR";
}

function playerWeekPointsFromBlock(player) {
  const pointsNode = player?.player_points;
  if (pointsNode != null) {
    const flat =
      typeof pointsNode === "object"
        ? flattenYahooBlock(Array.isArray(pointsNode) ? pointsNode : [pointsNode])
        : {};
    const total = Number(flat.total ?? pointsNode);
    if (Number.isFinite(total)) return total;
  }

  const statsNode = player?.player_stats;
  if (statsNode != null && typeof statsNode === "object") {
    const flat = flattenYahooBlock(Array.isArray(statsNode) ? statsNode : [statsNode]);
    const nestedPoints = flat.player_points || statsNode.player_points;
    if (nestedPoints != null) {
      const pointsFlat = flattenYahooBlock(
        Array.isArray(nestedPoints) ? nestedPoints : [nestedPoints]
      );
      const total = Number(pointsFlat.total ?? nestedPoints);
      if (Number.isFinite(total)) return total;
    }
  }

  return null;
}

function extractPlayersFromRosterNode(rosterNode) {
  const playersNode = findPlayersNode(rosterNode);
  if (!playersNode || typeof playersNode !== "object") return [];

  return numericKeyedChildren(playersNode)
    .map((entry) => flattenYahooPlayerBlock(entry?.player))
    .filter((player) => player.player_key)
    .map((player) => {
      const selectedPosition = selectedPositionFromPlayer(player);
      const points = playerWeekPointsFromBlock(player);
      return {
        player_key: player.player_key,
        player_id: player.player_id?.toString() || null,
        name: player.name?.full || player.name || null,
        position: player.display_position || player.primary_position || player.position || null,
        nfl_team: player.editorial_team_abbr || null,
        selected_position: selectedPosition,
        points
      };
    });
}

export function rosterIdFromTeamKey(teamKey) {
  const match = String(teamKey || "").match(/\.t\.(\d+)(?:\b|$)/);
  return match ? Number(match[1]) : null;
}

function collectDraftResultsFromNode(node, picks) {
  if (!node) return;

  if (Array.isArray(node)) {
    for (const entry of node) collectDraftResultsFromNode(entry, picks);
    return;
  }

  if (typeof node !== "object") return;

  if (node.draft_result) {
    collectDraftResultsFromNode(node.draft_result, picks);
    return;
  }

  if (node.pick != null && node.player_key) {
    picks.push(flattenYahooBlock(node));
    return;
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collectDraftResultsFromNode(value, picks);
  }
}

export function parseLeagueDraftResults(payload) {
  const league = payload?.fantasy_content?.league;
  if (!Array.isArray(league) || !league.length) {
    return { picks: [] };
  }

  const picks = [];
  for (const chunk of league) {
    if (chunk?.draft_results) collectDraftResultsFromNode(chunk.draft_results, picks);
  }

  const normalized = picks
    .map((pick) => ({
      pick: Number(pick.pick),
      round: Number(pick.round),
      cost: pick.cost != null ? Number(pick.cost) : null,
      team_key: pick.team_key || null,
      player_key: pick.player_key || null
    }))
    .filter((pick) => pick.player_key && Number.isFinite(pick.pick))
    .sort((a, b) => a.pick - b.pick);

  const pickFields = [...new Set(picks.flatMap((pick) => Object.keys(pick)))].sort();
  return { picks: normalized, pick_fields: pickFields };
}

export function parseLeagueDraftSettings(payload) {
  const league = payload?.fantasy_content?.league;
  if (!Array.isArray(league) || !league.length) return {};

  let settingsNode = null;
  for (const chunk of league) {
    if (chunk?.settings) {
      settingsNode = chunk.settings;
      break;
    }
  }

  if (!settingsNode) return {};

  const settings = Array.isArray(settingsNode) ? flattenYahooBlock(settingsNode[0]) : flattenYahooBlock(settingsNode);
  const draftTypeRaw = String(settings.draft_type || "").toLowerCase();
  const isAuction =
    draftTypeRaw.includes("auction") ||
    settings.is_auction === "1" ||
    settings.is_auction === 1 ||
    settings.is_auction_draft === "1" ||
    settings.is_auction_draft === 1;
  const budgetRaw =
    settings.auction_budget ?? settings.draft_budget ?? settings.salary_cap_amount ?? settings.salary_cap;
  const budget = Number(budgetRaw);

  return {
    draft_type: isAuction ? "auction" : "snake",
    is_auction: isAuction,
    budget: budgetRaw != null && budgetRaw !== "" && Number.isFinite(budget) && budget > 0 ? budget : null,
    draft_time: settings.draft_time || null,
    pick_time: settings.pick_time || settings.draft_pick_time || null
  };
}

export function parseTeamRosterWeek(payload) {
  const team = payload?.fantasy_content?.team;
  if (!team) {
    return { teamKey: null, teamId: null, week: null, players: [] };
  }

  const blocks = Array.isArray(team) ? team : [team];
  let header = {};
  let rosterNode = null;

  for (const block of blocks) {
    if (block?.roster) rosterNode = block.roster;
    else Object.assign(header, flattenYahooBlock(block));
  }

  const rosterMeta = Array.isArray(rosterNode) ? flattenYahooBlock(rosterNode[0]) : flattenYahooBlock(rosterNode);
  const players = extractPlayersFromRosterNode(rosterNode);

  return {
    teamKey: header.team_key || null,
    teamId: header.team_id?.toString() || null,
    week: rosterMeta?.week != null ? String(rosterMeta.week) : null,
    players
  };
}

export async function fetchYahooSeasonBundle(leagueKey, fetchJson = fetchYahooJson) {
  const payload = await fetchJson(leagueSeasonBundleUrl(leagueKey));
  return parseLeagueSeasonBundle(payload);
}
