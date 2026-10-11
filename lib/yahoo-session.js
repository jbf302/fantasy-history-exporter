// Talks to Yahoo using the user's own signed-in browser session.
//
// Requests prefer the Yahoo tab's content script (same-origin cookies) and fall
// back to the extension's service worker. Nothing leaves the browser except
// requests to Yahoo's own fantasy API hosts.
import {
  rewriteYahooUrlBase,
  isYahooRetryableFetchError,
  isYahooLoginFailure,
  yahooLeagueAccessDenied,
  yahooTransientServerError,
  YahooApiError,
  YAHOO_API_BASE,
  YAHOO_PUB_API_BASE,
  YAHOO_PUB_RW_API_BASE
} from "./yahoo-api.js";

export const YAHOO_FETCH_BASES = [YAHOO_PUB_RW_API_BASE, YAHOO_API_BASE, YAHOO_PUB_API_BASE];
const CONTENT_SCRIPT_FETCH_HOSTS = new Set([
  "pub-api-rw.fantasysports.yahoo.com",
  "pub-api-ro.fantasysports.yahoo.com"
]);
const YAHOO_FOOTBALL_HOST = "football.fantasysports.yahoo.com";

export function isYahooFantasyPage(tab) {
  try {
    return new URL(tab?.url).hostname === YAHOO_FOOTBALL_HOST;
  } catch {
    return false;
  }
}

/** The active tab if it is on Yahoo Fantasy Football, otherwise any Yahoo tab. */
export async function findYahooTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (isYahooFantasyPage(active)) return active;
  const tabs = await chrome.tabs.query({ url: `https://${YAHOO_FOOTBALL_HOST}/*` });
  return tabs[0] || null;
}

export async function getPageHints(tab) {
  if (!tab?.id) return null;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "YAHOO_GET_PAGE_HINTS" });
    return response?.ok ? response : null;
  } catch {
    return null;
  }
}

export async function fetchFranchiseSeasonPageHtml(tab, slug, season) {
  if (!tab?.id || !slug || !season) return null;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "YAHOO_FETCH_FRANCHISE_SEASON_PAGE",
      slug,
      season: String(season)
    });
    return response?.ok && response.html ? response.html : null;
  } catch {
    return null;
  }
}

function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function toApiError(response, url, source) {
  return new YahooApiError(response?.message || "Yahoo request failed", response?.status || 0, url, {
    source,
    final_url: response?.finalUrl,
    response_preview: response?.bodyPreview
  });
}

async function viaContentScript(url, tab) {
  const response = await chrome.tabs.sendMessage(tab.id, { type: "YAHOO_FETCH_JSON", url });
  if (response?.ok) return response.payload;
  // No answer, or a network-level failure: let the caller try the service worker.
  if (!response || !response.status) return null;
  throw toApiError(response, url, "content_script");
}

async function viaServiceWorker(url) {
  const response = await chrome.runtime.sendMessage({ type: "YAHOO_FETCH_JSON", url });
  if (response?.ok) return response.payload;
  throw toApiError(response, url, "service_worker");
}

async function fetchOnce(url, tab, onFailure = null) {
  if (tab?.id && isYahooFantasyPage(tab) && CONTENT_SCRIPT_FETCH_HOSTS.has(hostname(url))) {
    try {
      const payload = await viaContentScript(url, tab);
      if (payload) return payload;
      onFailure?.(new YahooApiError("page request gave no usable answer (status 0)", 0, url, { source: "content_script" }), url);
    } catch (error) {
      onFailure?.(error, url);
      const retryable =
        error instanceof YahooApiError &&
        ([0, 401, 403].includes(error.status) || isYahooRetryableFetchError(error));
      const unreachable = /Receiving end does not exist/.test(String(error?.message));
      if (!retryable && !unreachable && !(error instanceof TypeError)) throw error;
    }
  }
  return viaServiceWorker(url);
}

/** Returns `fetchJson(url)`, trying each Yahoo API host until one answers. */
export function createYahooFetcher(tab, { onFailure = null } = {}) {
  let blocked = null;
  return async function fetchJson(url) {
    // Yahoo answers 999 when it is throttling this browser. Retrying only digs the hole deeper.
    if (blocked) throw blocked;
    let lastError = null;
    for (const base of YAHOO_FETCH_BASES) {
      const requestUrl = rewriteYahooUrlBase(url, base);
      try {
        return await fetchOnce(requestUrl, tab, onFailure);
      } catch (error) {
        lastError = error;
        onFailure?.(error, requestUrl);
        if (error instanceof YahooApiError && error.status === 999) {
          blocked = new YahooApiError("Yahoo is blocking requests (999)", 999, url, error.details);
          throw blocked;
        }
        if (!(error instanceof YahooApiError)) throw error;
        if ([401, 403, 404, 0].includes(error.status) || isYahooRetryableFetchError(error)) continue;
        throw error;
      }
    }
    throw lastError || new YahooApiError("Yahoo request failed", 0, url);
  };
}

export function friendlyYahooError(error) {
  if (!(error instanceof YahooApiError)) return error?.message || "Something went wrong.";
  if (yahooTransientServerError(error.message)) {
    return "Yahoo returned a temporary error (usually too many requests). Wait 30 seconds and try again.";
  }
  if (yahooLeagueAccessDenied(error.message)) {
    return "Yahoo says your account can't view one of these seasons. Reload your league tab and try again.";
  }
  if (error.status === 999) {
    return "Yahoo is blocking requests from this browser right now (error 999, \"Request denied\"). This is temporary throttling. Stop for 30–60 minutes, then try once with fewer seasons. Opening Yahoo normally in the same browser keeps working.";
  }
  if (/non-JSON/i.test(error.message)) {
    return "Yahoo returned a web page instead of data, which usually means it is temporarily throttling requests or wants you to sign in again. Wait a few minutes, reload your Yahoo tab, and try again.";
  }
  if (isYahooLoginFailure(error)) {
    return "Yahoo says you're not signed in. Sign in at football.fantasysports.yahoo.com, reload your league tab, and try again.";
  }
  if (error.status === 0) {
    return "Couldn't reach Yahoo. Reload your league tab and the extension, then try again.";
  }
  return error.message || "Yahoo request failed.";
}

/** One-line technical detail for the activity log (no cookies or tokens are ever in these). */
export function describeYahooError(error, requestUrl = null) {
  if (!(error instanceof YahooApiError)) return null;
  const preview = String(error.details?.response_preview || error.message || "")
    .replace(/\s+/g, " ")
    .slice(0, 200);
  const url = (requestUrl || error.url || "?").replace(/^https:\/\//, "");
  return `${error.status} via ${error.details?.source || "?"} ${url} | ${preview}`;
}
