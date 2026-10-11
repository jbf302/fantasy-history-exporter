# Fantasy History Exporter

A Chrome extension that downloads your **Yahoo**, **ESPN**, or **Sleeper** fantasy football league's entire history as a single JSON file: every season's standings, draft (including auction prices), weekly matchups, and the starting lineups and bench for every team, every week. All three sites export to the same format, so one set of tools works for any league.

These sites make this data hard to get out. With this you can build league record books, rivalry pages, "did I start the right guy?" analysis, or sites like [Fantasy Cooperstown](https://fantasy-cooperstown.vercel.app/).

> **Unofficial.** Not made by, affiliated with, or endorsed by Yahoo, ESPN, or Sleeper. It reads data from your own account the same way their websites do.

## Install (about 2 minutes)

1. Download the latest **`yahoo-fantasy-history-exporter-*.zip`** from the [Releases](../../releases) page and unzip it.
2. In Chrome, open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose the unzipped folder (the one containing `manifest.json`).

Chrome may show a "disable developer mode extensions" reminder on startup; that's expected for unpacked extensions.

Works in Chrome and other Chromium browsers (Edge, Brave, Arc) version 116 or newer.

## Use

1. Open your league (see below for each site) and click the extension's icon. A side panel opens and detects the league.
2. Click **Find seasons**, pick the seasons you want, and click **Download selected seasons**.
3. A `…-<site>-history.json` file (for example `my-league-espn-history.json`) is saved to your downloads. Use **Save JSON file** to save it again.

### Sleeper

Open your league at `sleeper.com`, or paste its link (`https://sleeper.com/leagues/<id>/…`) or league id into the side panel. No sign-in needed: Sleeper's data is public. Sleeper gives each season a new league id, so the extension follows the chain back from whichever season you start with. Downloads take seconds.

### ESPN

Sign in to ESPN and open your league at `fantasy.espn.com` (any page with `leagueId=` in the address). For a **public** league you can paste the link into the side panel instead. **Private** leagues need an open, signed-in `fantasy.espn.com` tab: requests go through that tab so ESPN's own login applies. ESPN needs about one request per week of each season, so a long history takes a few minutes at most.

### Yahoo

1. Sign in to Yahoo and open your league at `football.fantasysports.yahoo.com`.
2. Wait after clicking Download. A league with many seasons makes a lot of requests (weekly scoreboards plus every team's lineup for every week) and can take several minutes. Keep a `football.fantasysports.yahoo.com` tab open and signed in.

Requests are deliberately paced (a few per second) because Yahoo blocks browsers that send bursts. If Yahoo returns a temporary error the extension backs off and retries. If it blocks you outright (error 999), it stops, keeps the seasons it already fetched so you can save a partial file, and asks you to wait 30–60 minutes. Click **Download** again afterwards to pick up where it left off. Scanning repeatedly in a short time makes blocks more likely. Yahoo throttles by network and account, not by browser, so run one export at a time: exporting several leagues at once, or from multiple browsers or devices on the same network, adds up and makes blocks much more likely.

If your league has a custom name in its URL (`/league/<name>/<year>`), starting from that kind of page is the most reliable way to find every season.

## What you get

See [docs/export-format.md](docs/export-format.md). In short: one file, one entry per season, each with standings, draft picks, a player catalog, and per-week lineups and scores. The shape is the same for every site; ids are prefixed with the site (`yahoo:`, `espn:`, `sleeper:`).

## Privacy

Everything runs in your browser. The file goes to your computer and nowhere else. The extension only talks to Yahoo, ESPN, and Sleeper. See [PRIVACY.md](PRIVACY.md).

## Limitations

- NFL fantasy football only.
- Yahoo only exposes history for leagues you belong to, and typically back to about 2014 (earlier seasons aren't attempted).
- ESPN has box scores (lineups) for roughly 2018 onward; older ESPN seasons usually export standings and weekly scores without lineups. ESPN's API is undocumented.
- League scoring *rules* are exported for Sleeper only; Yahoo and ESPN export the scores but not the rules.
- Any of these sites can change at any time; if something breaks, please [open an issue](../../issues).

## Development

No build step; it's plain ES modules.

```bash
npm test             # unit tests (fixtures are anonymized)
npm run check        # syntax + manifest check
npm run package      # dist/yahoo-fantasy-history-exporter-<version>.zip
```

Load the repo root as an unpacked extension to try changes, and click **Reload** on `chrome://extensions` after editing.

Code layout:

- `lib/<site>-api.js`: API client and season discovery for `yahoo`, `espn`, and `sleeper`.
- `lib/<site>-normalizer.js`: that site's data → export format. `lib/archive-utils.js` holds the pieces ESPN and Sleeper share.
- `lib/yahoo-session.js`: fetching through your logged-in Yahoo tab.
- `sidepanel/`: the UI. `sidepanel/providers/<site>.js` adapts each site to the same find → pick → download flow.
- `content/`: page helpers (`yahoo-detector.js`; `espn-bridge.js` runs ESPN requests inside your ESPN tab).
- `background.js`: Yahoo request headers.

## License

[MIT](LICENSE)
