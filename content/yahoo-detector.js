function yahooLeagueIdFromPath(url = window.location.href) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "football.fantasysports.yahoo.com") return null;
    const match = parsed.pathname.match(/\/f1\/(\d+)(?:\/|$)/);
    if (match?.[1]) return match[1];
  } catch {
    return null;
  }

  const html = document.documentElement?.innerHTML || "";
  const ids = collectLeagueIdsFromHtml(html);
  return ids[0] || null;
}

function collectLeagueIdsFromHtml(html) {
  const counts = new Map();
  for (const match of String(html).matchAll(/\.l\.(\d+)\b/g)) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  for (const match of String(html).matchAll(/"league_id"\s*:\s*"(\d+)"/g)) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 3);
  }
  for (const match of String(html).matchAll(/\/f1\/(\d+)(?:\/|$)/g)) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 2);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([leagueId]) => leagueId);
}

function collectLeagueIdsFromPage() {
  const html = document.documentElement?.innerHTML || "";
  const ids = collectLeagueIdsFromHtml(html);
  for (const script of document.querySelectorAll("script:not([src])")) {
    for (const id of collectLeagueIdsFromHtml(script.textContent || "")) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function historicalSeasonYearsFromDom(slug) {
  const years = new Set();

  if (slug) {
    const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const anchor of document.querySelectorAll(`a[href*="/league/${escaped}/"]`)) {
      const href = anchor.getAttribute("href") || "";
      const match = href.match(/\/(\d{4})(?:\/|$)/);
      if (match?.[1]) years.add(match[1]);
    }
  }

  for (const node of document.querySelectorAll(
    '[role="menuitem"], [role="option"], option, li, button, a'
  )) {
    const text = (node.textContent || "").trim();
    const seasonLabel = text.match(/^(20\d{2})\s*Season\b/i);
    if (seasonLabel?.[1]) {
      years.add(seasonLabel[1]);
      continue;
    }
    if (slug) {
      const href = node.getAttribute?.("href") || "";
      if (href.includes(`/league/${slug}/`)) {
        const match = href.match(/\/(\d{4})(?:\/|$)/);
        if (match?.[1]) years.add(match[1]);
      }
    }
  }

  return [...years]
    .map(Number)
    .filter((year) => Number.isFinite(year) && year >= 2014 && year <= 2100)
    .sort((a, b) => a - b)
    .map(String);
}

function yahooLeagueSlugFromPath(url = window.location.href) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/league\/([^/]+)\/(\d{4})(?:\/|$)/);
    const slug = match?.[1] || null;
    if (!slug || /^\d+$/.test(slug)) return null;
    return slug;
  } catch {
    return null;
  }
}

function historicalSeasonYearsFromPage(leagueId) {
  const years = new Set();
  const pathSeason = yahooSeasonFromPath();
  if (pathSeason) years.add(pathSeason);
  const html = document.documentElement?.innerHTML || "";
  const slug = yahooLeagueSlugFromPath();
  const idPattern = leagueId ? String(leagueId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : null;

  if (idPattern) {
    const f1Pattern = new RegExp(`/([0-9]{4})/f1/${idPattern}(?![0-9])`, "g");
    for (const match of html.matchAll(f1Pattern)) {
      years.add(match[1]);
    }
  }

  if (slug) {
    const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const slugPattern = new RegExp(`/league/${escaped}/(\\d{4})\\b`, "g");
    for (const match of html.matchAll(slugPattern)) {
      years.add(match[1]);
    }
  } else {
    for (const match of html.matchAll(/\/league\/[^/'"]+\/(\d{4})\b/g)) {
      years.add(match[1]);
    }
  }
  for (const match of html.matchAll(/data-season=["'](\d{4})["']/gi)) {
    years.add(match[1]);
  }
  for (const match of html.matchAll(/<option[^>]*value=["'](\d{4})["']/gi)) {
    years.add(match[1]);
  }

  for (const year of historicalSeasonYearsFromDom(slug)) {
    years.add(year);
  }

  return [...years]
    .map(Number)
    .filter((year) => Number.isFinite(year) && year >= 2014 && year <= 2100)
    .sort((a, b) => a - b)
    .map(String);
}

function yahooSeasonFromPath(url = window.location.href) {
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

function collectLeagueGameKeys(text, leagueId) {
  if (!text || !leagueId) return [];
  const escapedId = String(leagueId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(\\d{3})\\.l\\.${escapedId}\\b`, "g");
  const gameKeys = [];
  for (const match of String(text).matchAll(pattern)) {
    if (match[1]) gameKeys.push(match[1]);
  }
  return gameKeys;
}

function allLeagueKeysFromPage(leagueId) {
  if (!leagueId) return [];
  const gameKeys = collectLeagueGameKeys(document.documentElement?.innerHTML || "", leagueId);
  for (const script of document.querySelectorAll("script:not([src])")) {
    gameKeys.push(...collectLeagueGameKeys(script.textContent || "", leagueId));
  }
  const unique = [...new Set(gameKeys)].sort((a, b) => Number(b) - Number(a));
  return unique.map((gameKey) => `${gameKey}.l.${leagueId}`);
}

function leagueKeyFromPage(leagueId) {
  const keys = allLeagueKeysFromPage(leagueId);
  return keys[0] || null;
}

function allLeagueKeysFromAllPageIds() {
  const keys = new Set();
  for (const leagueId of collectLeagueIdsFromPage()) {
    for (const key of allLeagueKeysFromPage(leagueId)) {
      keys.add(key);
    }
  }
  return [...keys];
}

function pageHints() {
  const leagueId = yahooLeagueIdFromPath();
  const leagueIds = collectLeagueIdsFromPage();
  const leagueKeys = allLeagueKeysFromAllPageIds();
  const season = yahooSeasonFromPath();
  const historicalSeasonYears = historicalSeasonYearsFromPage(leagueId);
  return {
    leagueId,
    leagueIds,
    leagueKey: leagueKeyFromPage(leagueId),
    leagueKeys,
    leagueSlug: yahooLeagueSlugFromPath(),
    historicalSeasonYears,
    season
  };
}

function parseYahooFetchResponse(response, text) {
  const details = {
    finalUrl: response.url,
    contentType: response.headers.get("content-type"),
    byteLength: new Blob([text]).size,
    bodyPreview: text
  };

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return {
      ok: false,
      status: response.status,
      message: "Yahoo returned a non-JSON response",
      ...details
    };
  }

  if (payload?.error) {
    const description = payload.error.description || "Yahoo request failed";
    const accessDenied = /not in this league|not allowed to view this page because you are not in this league/i.test(
      description
    );
    const needsLogin =
      !accessDenied &&
      /log(?:ged)?\s*in|credentials|Unauthorized|unable_to_determine_oauth/i.test(description);
    return {
      ok: false,
      status: needsLogin ? 401 : response.status || 400,
      message: needsLogin ? "Yahoo login required" : description,
      ...details
    };
  }

  if (!response.ok) {
    const needsLogin = response.status === 401 || response.status === 403;
    return {
      ok: false,
      status: response.status,
      message: needsLogin ? "Yahoo login required" : `Yahoo returned ${response.status}`,
      ...details
    };
  }

  return {
    ok: true,
    status: response.status,
    payload,
    ...details
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "YAHOO_GET_PAGE_HINTS") {
    sendResponse({ ok: true, ...pageHints() });
    return false;
  }

  if (message?.type === "YAHOO_FETCH_FRANCHISE_SEASON_PAGE") {
    const slug = String(message.slug || "").trim();
    const season = String(message.season || "").trim();
    if (!slug || !/^\d{4}$/.test(season)) {
      sendResponse({ ok: false, status: 0, message: "Invalid franchise season request." });
      return false;
    }

    const pageUrl = `https://football.fantasysports.yahoo.com/league/${encodeURIComponent(slug)}/${encodeURIComponent(season)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    fetch(pageUrl, {
      credentials: "include",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        referer: window.location.href
      }
    })
      .then(async (response) => {
        const html = await response.text();
        sendResponse({
          ok: response.ok,
          status: response.status,
          html: response.ok ? html : null,
          finalUrl: response.url,
          byteLength: new TextEncoder().encode(html).length
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          status: 0,
          message: error?.name === "AbortError" ? "Yahoo page request timed out" : error.message || "Yahoo page request failed"
        });
      })
      .finally(() => {
        clearTimeout(timeout);
      });

    return true;
  }

  if (message?.type !== "YAHOO_FETCH_JSON") return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  fetch(message.url, {
    credentials: "include",
    signal: controller.signal,
    headers: {
      accept: "application/json",
      referer: window.location.href
    }
  })
    .then(async (response) => {
      const text = await response.text();
      sendResponse(parseYahooFetchResponse(response, text));
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        status: 0,
        message: error?.name === "AbortError" ? "Yahoo request timed out" : error.message || "Yahoo request failed"
      });
    })
    .finally(() => {
      clearTimeout(timeout);
    });

  return true;
});
