# Phoenix Sports Studio

## Usage

Sports Studio is a **standalone local preview** and not yet a built-in Phoenix menu item or an automatic agent tool. Run it from the repository root on Node.js 22 or later:

```powershell
node scripts/phoenix-sports-studio.mjs
```

Open \`http://127.0.0.1:3107\`. Only loopback access is supported, and no betting transactions are executed.

## Configure providers

Public ESPN and MLB results require no API key. Advanced commercial odds markets need optional credentials; ESPN moneyline odds are used without a key where ESPN provides real prices. No missing results or odds will be fabricated.

```powershell
# No keys required for default read-only ESPN/MLB results.
# Operators can disable a public provider if their policies require it:
# $env:PHOENIX_SPORTS_ESPN_DISABLED = "1"
# $env:PHOENIX_SPORTS_MLB_DISABLED = "1"
# ESPN logos also require confirmation of media rights.
$env:PHOENIX_SPORTS_ESPN_IMAGES_ALLOWED = "1"
# Optional: portraits require separate confirmation of media rights.
$env:PHOENIX_SPORTS_MLB_IMAGES_ALLOWED = "1"
# Optional: expanded bookmaker markets need an account with The Odds API.
# $env:THE_ODDS_API_KEY = "<your-secret-key>"
node scripts/phoenix-sports-studio.mjs
```

Keep API keys in the server environment or a secret manager, never in browser code, tickets, source control, public logs or screenshots. The service contacts fixed, documented provider hosts and blocks arbitrary URL access.

## Model and endpoints

Sports Studio offers 17 disciplines and a starting set of leagues in \`/api/catalog\`. The ESPN league discovery is \`POST /api/discover\` with \`{"source":"espn","sport":"soccer"}\`; discovered candidates need explicit \`POST /api/approve-league\` before scheduling requests. The Odds API supports catalog discovery with \`{"source":"the-odds-api"}\`. Discovery does not authorize an untrusted endpoint or silently accept arbitrary providers.

\`GET /api/board?sport=baseball&league=mlb&date=2026-10-24\` gives normalized fixture information. MLB enriches events with stadium and probable pitchers when the upstream response supplies them. \`GET /api/mlb/roster?team=...\` lists active pitchers, and \`GET /api/mlb/pitcher?id=...\` returns season statistics when supplied by MLB. Lack of a value remains explicit and never becomes a fabricated estimate.

\`GET /api/odds?sportKey=baseball_mlb&markets=h2h\` queries public ESPN Site/Core moneyline prices without a key when offered, or an optional configured The Odds API account. Availability varies by date and sport; unavailable lines remain unavailable. \`POST /api/ticket\` simulates decimal returns and marks correlated selections; it never places bets or claims winning picks. Expected value is not calculated unless a separate calibrated probability is provided. No prediction or backtesting model ships with this preview.

Source intelligence is persisted at \`~/.dsh/sports/intelligence.json\` or \`PHOENIX_SPORTS_HOME\`. The dashboard records success, failure and completeness; five consecutive provider failures trigger quarantine. An operator may restore a source after reviewing it. Scores measure **feed quality**, not a team's probability of winning; the dashboard does not auto-delete sources.

## Tests

```sh
node --check scripts/phoenix-sports-engine.mjs
node --check scripts/phoenix-sports-studio.mjs
node --check scripts/phoenix-sports-ui.js
node --test scripts/phoenix-sports.test.mjs
```

An isolated GitHub Actions workflow runs the same checks with Node 22. Never merge on a failed check.

## Limitations and next integration

Only ESPN, MLB and The Odds API have executable adapters in this preview; football-data.org, Sportradar and SportsDataIO are reference providers awaiting credentials, explicit licensing and adapters. Only MLB has pitcher and bullpen drilldowns. The preview has no integrated Phoenix/Cordis tool registration, no long-term predictive calibration, no confirmed images when no image rights exist, and no verified cross-provider event identity join. Each of these needs additional implementation and integration tests before describing the complete multisport experience as operational.

Provider reference: https://github.com/pseudo-r/Public-ESPN-API . The ESPN and MLB endpoints are undocumented, may change, and public reachability does not grant a right to redistribute data or media. The odds and other licensed providers have their own terms and quotas.
