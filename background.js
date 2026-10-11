import { fetchYahooJson, YahooApiError } from "./lib/yahoo-api.js";

const YAHOO_API_HOSTS = new Set([
  "fantasysports.yahooapis.com",
  "pub-api-ro.fantasysports.yahoo.com",
  "pub-api-rw.fantasysports.yahoo.com"
]);
const YAHOO_FANTASY_REFERER = "https://football.fantasysports.yahoo.com/";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// Referer is a forbidden fetch header, so a declarativeNetRequest rule adds it
// to the extension's own Yahoo API requests.
chrome.declarativeNetRequest
  ?.updateDynamicRules({
    removeRuleIds: [1, 2, 3],
    addRules: [
      "pub-api-rw.fantasysports.yahoo.com",
      "pub-api-ro.fantasysports.yahoo.com",
      "fantasysports.yahooapis.com"
    ].map((host, index) => ({
      id: index + 1,
      priority: 1,
      condition: { urlFilter: `||${host}/fantasy/`, resourceTypes: ["xmlhttprequest"] },
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "referer", operation: "set", value: YAHOO_FANTASY_REFERER }]
      }
    }))
  })
  .catch(() => {});

function validYahooFantasyApiUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      YAHOO_API_HOSTS.has(url.hostname) &&
      url.pathname.startsWith("/fantasy/")
    );
  } catch {
    return false;
  }
}

async function fetchYahooJsonForExtension(url) {
  if (!validYahooFantasyApiUrl(url)) {
    return { ok: false, status: 0, message: "Yahoo API URL was not allowed." };
  }
  try {
    const payload = await fetchYahooJson(url);
    return { ok: true, status: 200, payload, finalUrl: url };
  } catch (error) {
    return {
      ok: false,
      status: error instanceof YahooApiError ? error.status : 0,
      finalUrl: url,
      message: error?.message || "Yahoo request failed.",
      bodyPreview: error?.details?.response_preview
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "YAHOO_FETCH_JSON") return false;
  fetchYahooJsonForExtension(message.url).then(sendResponse);
  return true;
});
