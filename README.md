# Fantasy History Exporter for Yahoo

A Chrome extension that downloads your **Yahoo Fantasy Football** league's entire history as a single JSON file: every season's standings, draft (including auction prices), weekly matchups, and the starting lineups and bench for every team, every week.

Yahoo makes this data hard to get out. With this you can build league record books, rivalry pages, "did I start the right guy?" analysis, or sites like [Fantasy Cooperstown](https://github.com/jbf302/fantasy-cooperstown).

> **Unofficial.** Not made by, affiliated with, or endorsed by Yahoo. It reads data from your own account the same way the Yahoo website does.

## Install (about 2 minutes)

1. Download the latest **`yahoo-fantasy-history-exporter-*.zip`** from the [Releases](../../releases) page and unzip it.
2. In Chrome, open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose the unzipped folder (the one containing `manifest.json`).

Works in Chrome and other Chromium browsers (Edge, Brave, Arc) version 116 or newer.

## Use

1. Sign in to Yahoo and open your league at `football.fantasysports.yahoo.com`.
2. Click the extension's icon. A side panel opens.
3. Click **Find seasons**, pick the seasons you want, and click **Download selected seasons**.
4. Wait. A league with many seasons makes a lot of requests (weekly scoreboards plus every team's lineup for every week) and can take several minutes. Keep the Yahoo tab open.
5. A `…-yahoo-history.json` file is saved to your downloads. Use **Save JSON file** to save it again.

Requests are deliberately paced (a few per second) because Yahoo blocks browsers that send bursts. If Yahoo returns a temporary error the extension backs off and retries. If it blocks you outright (error 999), it stops, keeps the seasons it already fetched so you can save a partial file, and asks you to wait 30–60 minutes. Click **Download** again afterwards to pick up where it left off. Scanning repeatedly in a short time makes blocks more likely.

If your league has a custom name in its URL (`/league/<name>/<year>`), starting from that kind of page is the most reliable way to find every season.

## What you get

See [docs/export-format.md](docs/export-format.md). In short: one file, one entry per season, each with standings, draft picks, a player catalog, and per-week lineups and scores.

## Privacy

Everything runs in your browser. The file goes to your computer and nowhere else. See [PRIVACY.md](PRIVACY.md).

## Limitations

- NFL fantasy football only.
- Yahoo only exposes history for leagues you belong to, and typically back to about 2014.
- League scoring *rules* aren't exported, only the scores.
- Yahoo can change its site at any time; if something breaks, please open an issue.

## Development

No build step; it's plain ES modules.

```bash
npm test             # unit tests (fixtures are anonymized)
npm run check        # syntax + manifest check
npm run package      # dist/yahoo-fantasy-history-exporter-<version>.zip
```

Load the repo root as an unpacked extension to try changes, and click **Reload** on `chrome://extensions` after editing.

Code layout: `lib/yahoo-api.js` (Yahoo API client and season discovery), `lib/yahoo-session.js` (fetching through your logged-in tab), `lib/yahoo-normalizer.js` (Yahoo → export format), `sidepanel/` (UI), `content/` (page helper), `background.js`.

## License

[MIT](LICENSE)
