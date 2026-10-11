import { espnProvider } from "./providers/espn.js";
import { sleeperProvider } from "./providers/sleeper.js";
import { yahooProvider } from "./providers/yahoo.js";

const PROVIDERS = [yahooProvider, espnProvider, sleeperProvider];

const $ = (id) => document.getElementById(id);
const el = {
  statusText: $("statusText"),
  leagueInput: $("leagueInput"),
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

class CancelledError extends Error {}

const state = {
  target: null, // { provider, leagueId, tab?, ... } from the active tab or the pasted link
  provider: null, // provider of the current scan
  scan: null, // { leagueId, chain, fetchJson, years }
  archive: null,
  bundles: new Map(), // season -> fetched bundle; survives failures so a retry resumes
  cancelRequested: false,
  busy: false
};

// Recent failed requests, shown in the log when a scan or download fails.
const trace = [];
function recordFailure(error, requestUrl) {
  const line = state.provider?.describeError?.(error, requestUrl);
  if (!line) return;
  trace.push(line);
  if (trace.length > 12) trace.shift();
}
function logTrace() {
  if (!trace.length) return;
  logLine("Recent failed requests (newest last):", "error");
  for (const line of trace) logLine(line, "error");
  trace.length = 0;
}

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
  el.scanButton.disabled = busy || !state.target;
  el.leagueInput.disabled = busy;
  el.downloadButton.disabled = busy;
  el.progress.hidden = !busy;
}

function throwIfCancelled() {
  if (state.cancelRequested) throw new CancelledError("Cancelled.");
}

function friendlyError(error) {
  if (error instanceof CancelledError) return "Cancelled.";
  return state.provider?.friendlyError(error) || error?.message || "Something went wrong.";
}

// --- League detection ------------------------------------------------------

const NO_LEAGUE_MESSAGE =
  "Open your league on Yahoo, ESPN, or Sleeper in a tab, or paste a Sleeper or ESPN league link above.";

function targetFromInput() {
  const text = el.leagueInput.value.trim();
  if (!text) return null;
  for (const provider of PROVIDERS) {
    const target = provider.targetFromInput(text);
    if (target) return { provider, ...target };
  }
  return { error: "That doesn't look like a Sleeper or ESPN league link. (Yahoo needs an open league tab.)" };
}

async function targetFromTabs() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  let provider = PROVIDERS.find((candidate) => candidate.matchesTab(active));
  let tab = provider ? active : null;
  if (!tab) {
    for (const candidate of PROVIDERS) {
      const [match] = await chrome.tabs.query({ url: candidate.tabUrlPattern });
      if (match) {
        provider = candidate;
        tab = match;
        break;
      }
    }
  }
  if (!tab) return null;
  const target = await provider.targetFromTab(tab);
  return target.error ? target : { provider, ...target };
}

async function refreshTarget() {
  if (state.busy) return;
  const target = targetFromInput() || (await targetFromTabs());
  if (!target || target.error) {
    state.target = null;
    setStatus(target?.error || NO_LEAGUE_MESSAGE, Boolean(target?.error && el.leagueInput.value.trim()));
    el.scanButton.disabled = true;
    return;
  }
  state.target = target;
  setStatus(`${target.status} Then click Find seasons.`);
  el.scanButton.disabled = false;
}

// --- Season discovery ------------------------------------------------------

async function scanSeasons() {
  const target = state.target;
  if (!target) return;
  state.cancelRequested = false;
  state.provider = target.provider;
  state.scan = null;
  state.archive = null;
  state.bundles = new Map();
  el.picker.hidden = true;
  el.result.hidden = true;
  el.log.replaceChildren();
  setBusy(true);
  setProgress(0, 1, "Looking for your league's seasons…");

  try {
    const scan = await target.provider.scan(target, { log: logLine, recordFailure });
    if (!scan.chain.length) throw new Error("No seasons were found for this league.");
    state.scan = scan;
    showPicker(scan.chain, scan.years);
    const seasons = scan.chain.map((entry) => entry.season);
    logLine(`Found ${seasons.length} season${seasons.length === 1 ? "" : "s"}: ${seasons.join(", ")}.`, "ok");
    setStatus("Choose which seasons to download.");
  } catch (error) {
    const message = friendlyError(error);
    setStatus(message, true);
    logLine(message, "error");
    logTrace();
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
  el.pickerHint.textContent = state.provider.pickerHint;
  el.picker.hidden = false;
}

function setAllSeasons(checked) {
  for (const input of el.seasonList.querySelectorAll("input:not(:disabled)")) input.checked = checked;
}

// --- Download --------------------------------------------------------------

function buildArchive(selectedChain) {
  const bundles = selectedChain.map((entry) => state.bundles.get(entry.season)).filter(Boolean);
  if (!bundles.length) return null;
  state.archive = state.provider.buildArchive(state.scan, bundles);
  return state.archive;
}

function showResult(archive, { partial = false, total = 0 } = {}) {
  const count = archive.summary?.total_seasons ?? Object.keys(archive.seasons || {}).length;
  el.resultText.textContent = partial
    ? `Partial export: ${count} of ${total} selected season${total === 1 ? "" : "s"} ready. You can save these now, or fix the problem and click Download again to fetch the rest (seasons already fetched are kept).`
    : `${archive.name}: ${count} season${count === 1 ? "" : "s"} ready.`;
  el.result.querySelector("h2").textContent = partial ? "Partially done" : "Done";
  el.result.hidden = false;
}

async function downloadSeasons() {
  const selected = new Set(
    [...el.seasonList.querySelectorAll("input:checked:not(:disabled)")].map((input) => input.value)
  );
  if (!selected.size) {
    setStatus("Select at least one season.", true);
    return;
  }
  const { provider, scan } = state;
  const selectedChain = scan.chain.filter((entry) => selected.has(entry.season));
  const todo = selectedChain.filter((entry) => !state.bundles.has(entry.season));

  state.cancelRequested = false;
  state.archive = null;
  el.result.hidden = true;
  setBusy(true);

  const resumed = selectedChain.length - todo.length;
  if (resumed) logLine(`Keeping ${resumed} season${resumed === 1 ? "" : "s"} already fetched; fetching the other ${todo.length}.`);

  const estimatedSteps = todo.reduce((sum, entry) => sum + provider.estimateSteps(entry), 1);
  let done = 0;
  const step = (text) => setProgress(++done, estimatedSteps, text);
  const context = { step, log: logLine, throwIfCancelled, recordFailure };

  try {
    for (const entry of todo) {
      throwIfCancelled();
      const { bundle, summary } = await provider.fetchSeason(scan, entry, context);
      state.bundles.set(entry.season, bundle); // only complete seasons are kept
      logLine(summary, "ok");
    }

    setProgress(estimatedSteps, estimatedSteps, "Building export…");
    const archive = buildArchive(selectedChain);
    showResult(archive);
    setStatus("Download complete.");
    saveArchive();
  } catch (error) {
    const message = friendlyError(error);
    setStatus(message, true);
    logLine(message, "error");
    logTrace();
    const partial = buildArchive(selectedChain);
    if (partial) showResult(partial, { partial: true, total: selectedChain.length });
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
  link.download = `${safeName || "league"}-${state.archive.provider}-history.json`;
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
el.leagueInput.addEventListener("input", refreshTarget);
el.leagueInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !el.scanButton.disabled) scanSeasons();
});

chrome.tabs.onActivated.addListener(refreshTarget);
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === "complete") refreshTarget();
});

refreshTarget();
