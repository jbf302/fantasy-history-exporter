// Runs ESPN fantasy API requests from inside the user's fantasy.espn.com tab so
// ESPN's own login cookies apply (needed for private leagues). Only GETs to
// ESPN's football league API are allowed. Classic script: no imports.
const ESPN_API_HOST = "lm-api-reads.fantasy.espn.com";

function allowedEspnApiUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === ESPN_API_HOST && url.pathname.startsWith("/apis/v3/games/ffl/");
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ESPN_FETCH_JSON") return false;
  if (!allowedEspnApiUrl(message.url)) {
    sendResponse({ ok: false, status: 400, message: "ESPN API URL was not allowed." });
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const headers = { accept: "application/json" };
  if (typeof message.filter === "string") headers["x-fantasy-filter"] = message.filter;

  fetch(message.url, { credentials: "include", signal: controller.signal, headers })
    .then(async (response) => {
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        sendResponse({ ok: false, status: response.status || 502, message: "ESPN returned a non-JSON response", bodyPreview: text.slice(0, 300) });
        return;
      }
      if (!response.ok) {
        const reason = payload?.messages?.[0] || payload?.details?.[0]?.message || `ESPN returned ${response.status}`;
        sendResponse({ ok: false, status: response.status, message: reason, bodyPreview: text.slice(0, 300) });
        return;
      }
      sendResponse({ ok: true, status: response.status, payload });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        status: 0,
        message: error?.name === "AbortError" ? "ESPN request timed out" : error?.message || "ESPN request failed"
      });
    })
    .finally(() => clearTimeout(timeout));

  return true;
});
