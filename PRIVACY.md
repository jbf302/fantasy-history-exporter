# Privacy

Fantasy History Exporter runs entirely in your browser.

- **What it reads:** your Yahoo, ESPN, or Sleeper fantasy football league's data (standings, drafts, matchups, lineups, team and manager names). For Yahoo and private ESPN leagues it uses the session you're already signed in with; Sleeper's data is public and needs no sign-in.
- **Where it goes:** only into a JSON file that you save to your own computer. Nothing is sent to the author or to any third party. There is no server, analytics, or tracking.
- **Network requests:** only to Yahoo Fantasy hosts (`football.fantasysports.yahoo.com`, `fantasysports.yahooapis.com`, `pub-api-ro.fantasysports.yahoo.com`, `pub-api-rw.fantasysports.yahoo.com`), ESPN Fantasy hosts (`fantasy.espn.com`, `lm-api-reads.fantasy.espn.com`), and Sleeper (`api.sleeper.app`). The extension can also read the address of `sleeper.com` tabs, to detect which league you have open.
- **Credentials:** the extension never sees or stores your Yahoo or ESPN password, and never reads, copies, or stores your cookies. Requests are made from your browser, which attaches your signed-in session itself. For ESPN, requests are sent from inside your open `fantasy.espn.com` tab so ESPN's own login applies.
- **Request headers:** the extension uses Chrome's `declarativeNetRequest` permission only to set a `Referer` header (`https://football.fantasysports.yahoo.com/`) on its own requests to the Yahoo Fantasy API hosts above, because Yahoo's API expects it. It does not touch any other site's traffic.
- **Storage:** the extension doesn't persist anything. The export exists in memory until you save it or close the panel.

The exported file contains the names the site shows for your league's managers and teams (display names, not real names). Treat it like any league data: be thoughtful before posting it publicly.
