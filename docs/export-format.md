# Export format

The extension writes one JSON file per league: `<league-name>-<provider>-history.json`, where `<provider>` is `yahoo`, `espn`, or `sleeper`. All three use the same shape; the differences are listed under [Provider differences](#provider-differences).

Top level:

```jsonc
{
  "schema_version": 1,
  "provider": "yahoo", // or "espn", "sleeper"
  "sport": "nfl",
  "import_id": "yahoo:nfl:<league id>", // "<provider>:nfl:<league id>"
  "provider_league_id": "<league id>",
  "name": "<latest league name>",
  "imported_at": "<ISO timestamp>",
  "seasons": { "2024": { /* one object per season */ } },
  "summary": { "total_seasons": 10 /* ... */ },
  "metadata": { "history_detail": "full" }
}
```

Each season object includes:

| Key | Contents |
| --- | --- |
| `league` | name, status, and basic settings (scoring type, roster size, etc.); scoring rules are not included |
| `users` | one entry per manager (Yahoo account id, display name, team name) |
| `rosters` | one entry per team |
| `standings` | final rank, wins/losses/ties, points for/against |
| `draft_picks` | pick order, team, player; auction drafts add a numeric `amount` (price paid) per pick, and `drafts[].settings.budget` when Yahoo reports one. `drafts[].metadata.yahoo_pick_fields` lists the fields Yahoo returned. Keepers are not reported (`is_keeper` is always false) |
| `players` | `yahoo:<id>` keyed catalog of every player seen (name, position, NFL team) |
| `matchups_by_week` | per team per week: `points`, `starters`, `players`, `players_points`, and matchup metadata (`is_playoffs`, `is_consolation`) |

Notes:

- Player ids are prefixed with the provider (`yahoo:`, `espn:`, `sleeper:`) and are that site's ids. The same NFL player has different ids on each site.
- Manager ids are prefixed `yahoo_user:`, `espn_user:`, or `sleeper_user:`.
- Each season's `league.league_id` is `<provider>:nfl:<league id>:<season>`, and `previous_league_id` links it to the season before.
- `matchups_by_week` is keyed by NFL week. Each matchup has one leg per team; `points` is that team's score for the week and is authoritative. `metadata.won_matchup` is `"true"`/`"false"` once decided (absent for ties and games in progress), and `metadata.is_playoffs` / `metadata.is_consolation` are `"1"`/`"0"`.
- Per-player points are what the site reported for each lineup.
- Seasons still in progress are exported as-is, with `status` not `complete`.

## Provider differences

| | Yahoo | ESPN | Sleeper |
| --- | --- | --- | --- |
| `provider_league_id` | Yahoo league id | ESPN league id (the same every season) | the newest season's league id (Sleeper gives each season a new one; each season's own id is in `league.metadata.sleeper_league_id`) |
| `standings[].rank` | Yahoo's final rank | ESPN's final rank (`rankCalculatedFinal`), else playoff seed | from the playoff bracket's placement games, then playoff depth, then record |
| Lineups (`metadata.lineup_source`) | `yahoo_roster` | `espn_boxscore` (about 2018 onward) | `sleeper_matchups` |
| `league.scoring_settings` | empty | empty | Sleeper's scoring rules |
| `rosters[].players` | empty | empty | the end-of-season roster |
| `draft_picks[].is_keeper` | always false | ESPN's keeper flag | Sleeper's keeper flag |

ESPN notes:

- ESPN can run one matchup over two NFL weeks (often in the playoffs). Each week still gets its own leg with that week's points. The leg's `metadata.matchup_weeks` (for example `"15,16"`) and `metadata.matchup_total_points` describe the whole matchup, and `won_matchup` reflects who won the whole matchup.
- `metadata.playoff_tier` keeps ESPN's playoff tier (`WINNERS_BRACKET`, `WINNERS_CONSOLATION_LADDER`, `LOSERS_CONSOLATION_LADDER`).
- Playoff byes are not matchups and are left out, as with Yahoo and Sleeper.

Sleeper notes:

- `points` uses Sleeper's `custom_points` (a commissioner's score override) when set; `metadata.score_source` says which.
- Player `team` and `position` come from Sleeper's current player list, so a player who has since changed teams shows the new team.
