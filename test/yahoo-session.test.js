import assert from "node:assert/strict";
import test from "node:test";

import { YahooApiError } from "../lib/yahoo-api.js";
import { createYahooFetcher, friendlyYahooError, isYahooFantasyPage } from "../lib/yahoo-session.js";

const API_URL = "https://fantasysports.yahooapis.com/fantasy/v2/league/461.l.1/settings?format=json";

function stubChrome({ tabResponses = {}, workerResponses = {} }) {
  const calls = [];
  globalThis.chrome = {
    tabs: {
      sendMessage: async (_id, message) => {
        calls.push(["tab", message.url]);
        const host = new URL(message.url).hostname;
        return tabResponses[host];
      }
    },
    runtime: {
      sendMessage: async (message) => {
        calls.push(["worker", message.url]);
        const host = new URL(message.url).hostname;
        return workerResponses[host];
      }
    }
  };
  return calls;
}

const tab = { id: 7, url: "https://football.fantasysports.yahoo.com/f1/116514" };

test("isYahooFantasyPage only accepts the Yahoo football host", () => {
  assert.equal(isYahooFantasyPage(tab), true);
  assert.equal(isYahooFantasyPage({ url: "https://example.com/" }), false);
  assert.equal(isYahooFantasyPage(null), false);
});

test("fetcher uses the Yahoo tab first and returns its payload", async () => {
  const calls = stubChrome({
    tabResponses: { "pub-api-rw.fantasysports.yahoo.com": { ok: true, payload: { hello: "tab" } } }
  });
  const payload = await createYahooFetcher(tab)(API_URL);
  assert.deepEqual(payload, { hello: "tab" });
  assert.deepEqual(calls.map((c) => c[0]), ["tab"]);
});

test("fetcher falls back to the service worker when the tab can't answer", async () => {
  const calls = stubChrome({
    tabResponses: {},
    workerResponses: { "pub-api-rw.fantasysports.yahoo.com": { ok: true, payload: { hello: "worker" } } }
  });
  const payload = await createYahooFetcher(tab)(API_URL);
  assert.deepEqual(payload, { hello: "worker" });
  assert.deepEqual(calls.map((c) => c[0]), ["tab", "worker"]);
});

test("fetcher tries the next Yahoo host after a 403", async () => {
  const calls = stubChrome({
    tabResponses: {
      "pub-api-rw.fantasysports.yahoo.com": { ok: false, status: 403, message: "nope" }
    },
    workerResponses: {
      "pub-api-rw.fantasysports.yahoo.com": { ok: false, status: 403, message: "nope" },
      "fantasysports.yahooapis.com": { ok: true, payload: { hello: "second host" } }
    }
  });
  const payload = await createYahooFetcher(tab)(API_URL);
  assert.deepEqual(payload, { hello: "second host" });
  assert.ok(calls.some(([, url]) => url.includes("fantasysports.yahooapis.com")));
});

test("fetcher surfaces a non-retryable Yahoo error", async () => {
  stubChrome({
    tabResponses: {},
    workerResponses: { "pub-api-rw.fantasysports.yahoo.com": { ok: false, status: 400, message: "bad request" } }
  });
  await assert.rejects(createYahooFetcher(tab)(API_URL), (error) => {
    assert.ok(error instanceof YahooApiError);
    assert.equal(error.status, 400);
    return true;
  });
});

test("friendlyYahooError maps sign-in and network failures to plain language", () => {
  assert.match(friendlyYahooError(new YahooApiError("Yahoo login required", 401, "u")), /not signed in/);
  assert.match(friendlyYahooError(new YahooApiError("boom", 0, "u")), /Couldn't reach Yahoo/);
  assert.equal(friendlyYahooError(new Error("plain")), "plain");
});
