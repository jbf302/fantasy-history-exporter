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
} from "../lib/yahoo-api.js";
import { normalizeYahooImport } from "../lib/yahoo-normalizer.js";
import {
  createYahooFetcher,
  fetchFranchiseSeasonPageHtml,
  findYahooTab,
  friendlyYahooError,
  getPageHints
} from "../lib/yahoo-session.js";

const $ = (id) => document.getElementById(id);
const el = {
  statusText: $("statusText"),
  scanButton: $("scanButton"),
  picker: $("picker"),
  pickerHint: $("pickerHint"),
  seasonList: $("seasonList"),
  selectAll: $("selectAll"),
  selectNone: $("selectNone"),
  downloadButton: $("downloadButton"),
  progress: $("progress"),
  bar: $("bar"),
  progressText: $("progressText"),
  cancelButton: $("cancelButton"),
  result: $("result"),
  resultText: $("resultText"),
  saveButton: $("saveButton"),
  logCard: $("logCard"),
  log: $("log")
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CancelledError extends Error {}

const state = {
  tab: null,
  scan: null, // { leagueId, chain, fetchJson }
  archive: null,
  cancelRequested: false,
  busy: false
};

function setStatus(text, isError = false) {
  el.statusText.textContent = text;
  el.statusText.classList.toggle("error-text", isError);
}

function logLine(text, kind = "") {
  el.logCard.hidden = false;
  const item = document.createElement("li");
  item.textContent = text;
  if (kind) item.className = kind;
  el.log.appendChild(item);
  el.log.scrollTop = el.log.scrollHeight;
  return item;
}

function setProgress(done, total, text) {
  el.bar.max = Math.max(total, 1);
  el.bar.value = Math.min(done, total);
  el.progressText.textContent = text;
}

function setBusy(busy) {
  state.busy = busy;
  el.scanButton.disabled = busy || !state.tab;
  el.downloadButton.disabled = busy;
  el.progress.hidden = !busy;
}

function throwIfCancelled() {
  if (state.cancelRequested) throw new CancelledError("Cancelled.");
}

// --- Tab detection ---------------------------------------------------------

async function refreshTab() {
  if (state.busy) return;
  state.tab = await findYahooTab();
  if (!state.tab) {
    setStatus("Open your Yahoo Fantasy Football league page (football.fantasysports.yahoo.com), then come back here.");
    el.scanButton.disabled = true;
    return;
  }
  const hints = await getPageHints(state.tab);
  const leagueId = hints?.leagueId || yahooLeagueIdFromUrl(state.tab.url);
  if (!leagueId) {
    setStatus("Yahoo is open, but not on a league page. Open one of your leagues, then come back here.");
    el.scanButton.disabled = true;
    return;
  }
  setStatus(`League ${leagueId} detected. Make sure you're signed in to Yahoo, then find its seasons.`);
  el.scanButton.disabled = false;
}

// --- Season discovery ------------------------------------------------------

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

async function scanSeasons() {
  state.cancelRequested = false;
  state.archive = null;
  el.picker.hidden = true;
  el.result.hidden = true;
  el.log.replaceChildren();
  setBusy(true);
  setProgress(0, 1, "Looking for your league's seasons…");

  try {
    const tab = state.tab;
    const pageHints = (await getPageHints(tab)) || {};
    const leagueId = pageHints.leagueId || yahooLeagueIdFromUrl(tab.url);
    if (!leagueId) throw new Error("Open one of your Yahoo league pages first.");

    const fetchJson = createYahooFetcher(tab);
    const hintSeason = yahooSeasonFromUrl(tab.url) || pageHints.season || null;
    let hintLeagueKey = pageHints.leagueKey || null;
    if (hintLeagueKey && !leagueKeyMatchesLeagueId(hintLeagueKey, leagueId)) hintLeagueKey = null;
    if (hintSeason && NFL_GAME_KEYS_BY_SEASON[hintSeason] && pageHints.leagueKeys?.length) {
      const seasonKey = `${NFL_GAME_KEYS_BY_SEASON[hintSeason]}.l.${leagueId}`;
      if (pageHints.leagueKeys.includes(seasonKey)) hintLeagueKey = seasonKey;
    }
    const franchiseSlug = yahooLeagueSlugFromUrl(tab.url) || pageHints.leagueSlug || null;

    logLine(
      `Page: ${new URL(tab.url).pathname} | season ${hintSeason || "?"} | slug ${franchiseSlug || "none"} | ` +
        `dropdown years [${(pageHints.historicalSeasonYears || []).join(", ")}] | ` +
        `league ids [${(pageHints.leagueIds || []).join(", ")}] | keys [${(pageHints.leagueKeys || []).join(", ")}]`
    );
    const resolved = await resolveYahooLeagueKey({ leagueId, hintSeason, hintLeagueKey, fetchJson });
    logLine(`Using Yahoo league key ${resolved.league_key}.`);

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

    state.scan = { leagueId, chain, fetchJson };
    showPicker(chain, pickerYears(chain, expectedProbeYears, dropdownYears));
    if (!franchiseSlug && chain.length === 1 && dropdownYears.length > 1) {
      logLine(
        "Only one season found. Yahoo gives a league a new ID when it is recreated, so older seasons can't be reached from this page. " +
          "Open a past season instead (from the season dropdown, or a URL like football.fantasysports.yahoo.com/league/<league-name>/2024) and click Find seasons again.",
        "error"
      );
    }
    const seasons = chain.map((entry) => entry.season);
    logLine(
      "Chain: " + chain.map((entry) => `${entry.season}=${entry.leagueKey}`).join(", ")
    );
    logLine(`Found ${seasons.length} season${seasons.length === 1 ? "" : "s"}: ${seasons.join(", ")}.`, "ok");
    setStatus("Choose which seasons to download.");
  } catch (error) {
    const message = error instanceof CancelledError ? "Cancelled." : friendlyYahooError(error);
    setStatus(message, true);
    logLine(message, "error");
  } finally {
    setBusy(false);
  }
}

function showPicker(chain, years) {
  const found = new Set(chain.map((entry) => entry.season));
  el.seasonList.replaceChildren();
  for (const year of years) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "season";
    input.value = year;
    input.checked = found.has(year);
    input.disabled = !found.has(year);
    label.append(input, document.createTextNode(found.has(year) ? year : `${year} (not found)`));
    if (!found.has(year)) label.className = "missing";
    el.seasonList.appendChild(label);
  }
  el.pickerHint.textContent =
    "More seasons means more requests to Yahoo. If Yahoo rate-limits you, wait a bit and download fewer seasons at a time.";
  el.picker.hidden = false;
}

function setAllSeasons(checked) {
  for (const input of el.seasonList.querySelectorAll("input:not(:disabled)")) input.checked = checked;
}

// --- Download --------------------------------------------------------------

async function fetchSeasonWeekData({ entry, fetchJson, onStep }) {
  const weeks = weekNumbersFromLeagueMetadata(entry.metadata || {});
  const scoreboardsByWeek = {};
  const rosterPayloads = [];

  for (const week of weeks) {
    throwIfCancelled();
    onStep(`${entry.season} week ${week} scoreboard`);
    await sleep(80);
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
      await sleep(100);
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

async function downloadSeasons() {
  const selected = new Set(
    [...el.seasonList.querySelectorAll("input:checked:not(:disabled)")].map((input) => input.value)
  );
  if (!selected.size) {
    setStatus("Select at least one season.", true);
    return;
  }
  const { leagueId, chain, fetchJson } = state.scan;
  const selectedChain = chain.filter((entry) => selected.has(entry.season));

  state.cancelRequested = false;
  state.archive = null;
  el.result.hidden = true;
  setBusy(true);

  const estimatedSteps = selectedChain.reduce(
    (sum, entry) => sum + weekNumbersFromLeagueMetadata(entry.metadata || {}).length * 13 + 3,
    1
  );
  let done = 0;
  const step = (text) => setProgress(++done, estimatedSteps, text);

  try {
    const seasonBundles = [];
    for (const entry of selectedChain) {
      throwIfCancelled();
      step(`${entry.season} standings`);
      const bundle = await fetchYahooSeasonBundle(entry.leagueKey, fetchJson);
      bundle.metadata = bundle.metadata || entry.metadata;

      throwIfCancelled();
      step(`${entry.season} draft`);
      await sleep(100);
      try {
        const draftPayload = await fetchJson(leagueDraftResultsUrl(entry.leagueKey));
        bundle.yahooDraftResults = parseLeagueDraftResults(draftPayload);
        if (bundle.yahooDraftResults?.picks?.length) {
          await sleep(80);
          const settingsPayload = await fetchJson(leagueSettingsUrl(entry.leagueKey));
          bundle.yahooDraftSettings = parseLeagueDraftSettings(settingsPayload);
        }
      } catch (error) {
        if (!isYahooRetryableFetchError(error)) throw error;
        logLine(`${entry.season}: draft skipped (Yahoo returned a temporary error).`);
      }

      const weekData = await fetchSeasonWeekData({
        entry: { ...entry, metadata: bundle.metadata },
        fetchJson,
        onStep: step
      });
      bundle.yahooScoreboardsByWeek = weekData.scoreboardsByWeek;
      bundle.yahooRosterPayloads = weekData.rosterPayloads;
      seasonBundles.push(bundle);

      const weeksWithMatchups = Object.values(weekData.scoreboardsByWeek).filter(
        (scoreboard) => scoreboard?.matchups?.length
      ).length;
      logLine(
        `${entry.season}: ${weeksWithMatchups} weeks of matchups, ${weekData.rosterPayloads.length} lineups.`,
        "ok"
      );
    }

    setProgress(estimatedSteps, estimatedSteps, "Building export…");
    state.archive = normalizeYahooImport({ providerLeagueId: leagueId, seasonBundles });
    const count = state.archive.summary?.total_seasons ?? seasonBundles.length;
    el.resultText.textContent = `${state.archive.name}: ${count} season${count === 1 ? "" : "s"} ready.`;
    el.result.hidden = false;
    setStatus("Download complete.");
    saveArchive();
  } catch (error) {
    const message = error instanceof CancelledError ? "Cancelled." : friendlyYahooError(error);
    setStatus(message, true);
    logLine(message, "error");
  } finally {
    setBusy(false);
  }
}

function saveArchive() {
  if (!state.archive) return;
  const safeName = String(state.archive.name || "league")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const blob = new Blob([JSON.stringify(state.archive, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName || "league"}-yahoo-history.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// --- Wiring ----------------------------------------------------------------

el.scanButton.addEventListener("click", scanSeasons);
el.downloadButton.addEventListener("click", downloadSeasons);
el.saveButton.addEventListener("click", saveArchive);
el.cancelButton.addEventListener("click", () => {
  state.cancelRequested = true;
  el.progressText.textContent = "Cancelling…";
});
el.selectAll.addEventListener("click", () => setAllSeasons(true));
el.selectNone.addEventListener("click", () => setAllSeasons(false));

chrome.tabs.onActivated.addListener(refreshTab);
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === "complete") refreshTab();
});

refreshTab();
