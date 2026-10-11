# Export format

The extension writes one JSON file per league: `<league-name>-yahoo-history.json`.

Top level:

```jsonc
{
  "schema_version": 1,
  "provider": "yahoo",
  "sport": "nfl",
  "import_id": "yahoo:nfl:<league id>",
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
| `league` | name, status, scoring/roster settings Yahoo exposes |
| `users` | one entry per manager (Yahoo account id, display name, team name) |
| `rosters` | one entry per team |
| `standings` | final rank, wins/losses/ties, points for/against |
| `draft_picks` | pick order, team, player; auction price when applicable |
| `players` | `yahoo:<id>` keyed catalog of every player seen (name, position, NFL team) |
| `matchups_by_week` | per team per week: `points`, `starters`, `players`, `players_points`, and matchup metadata (`is_playoffs`, `is_consolation`) |

Notes:

- Player ids are prefixed `yahoo:` and are Yahoo's, not any other service's.
- Historical matchup totals come from Yahoo's scoreboard (`points`) and are authoritative; per-player points are what Yahoo reported for each lineup.
- Seasons still in progress are exported as-is, with `status` not `complete`.
- Yahoo's scoring *rules* are not exported, only the results.
