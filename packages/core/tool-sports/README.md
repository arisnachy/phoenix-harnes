# @phoenix-ai/dsh-tool-sports

English | [中文](README.zh.md)

Native chat-only sports tools for Kira: sports_chat_catalog, sports_chat_discover, sports_chat_games, sports_chat_mlb_pitchers, sports_chat_odds, and sports_chat_ticket. Sports questions use the existing conversation, not a menu. The assistant receives attributed data and declarative sports_game_card or sports_ticket_card blocks to show inside validated generative-ui fences.

## Provider access

ESPN Site/Core and MLB Stats are queried as publicly reachable read-only sources without needing an API key or a PHOENIX_SPORTS_ESPN_ALLOWED setting. Operators may opt out using PHOENIX_SPORTS_ESPN_DISABLED=1 or PHOENIX_SPORTS_MLB_DISABLED=1; public access does not grant a license to reuse data. THE_ODDS_API_KEY selects the existing `api.the-odds-api.com` v4 adapter, with its own quota and license. Separately, `THEODDSAPI_API_KEY` selects the optional `api.theoddsapi.com` adapter, which publishes a free NBA/MLB moneyline tier (registration and a key still required); **these are independent services, credentials and JSON schemas**. If both keys are present the original v4 adapter takes priority; without either, PHOENIX tries published ESPN moneylines. The free adapter uses a fixed HTTPS host, a server-only `x-api-key` header, a bounded response and a 90-second per-account cache. No provider key is written into the URL or a rendered card. If missing, ESPN Core/Site moneyline quotes are read when available, but no absent prices or missing markets are fabricated. PHOENIX_SPORTS_ESPN_IMAGES_ALLOWED=1 is an additional opt-in after media rights review. Credentials stay in the host environment and never appear in tool output. Only fixed hosts can be queried.

## NBA research (source-derived, not calibrated)

`sports_chat_nba_research` reads recent NBA final scoreboards once per date (shared across the slate), computes actual wins, average margins and approximate hours since the previous game, and records archive coverage. `sports_chat_ticket_research_auto` now rejects NBA candidates that have insufficient completed-game evidence. These are descriptive trends **not** win-probability estimates or edge calculations. Official NBA injury reports, roster validation, advanced efficiency metrics and true calibrated model-based predictions remain separate integration requirements; unverified NBA player leaders are temporarily hidden.

## Model Experience

### Verified sports fixtures and inline cards

#### What the model sees

Kira receives bounded `sports_chat_games` results containing attributed fixture data and declarative `sports_game_card` payloads with local time, teams, source, and optional verified pitcher, lineup, and bullpen information. `sports_chat_odds` may supply real quoted markets; `sports_chat_ticket` only simulates a ticket.

#### Token effect

Each sports request contributes only source-attributed event fields and bounded visual-card payloads to the model context; absent player statistics and prices remain absent rather than becoming synthetic tokens.

#### KV Cache effect

Live fixtures and odds can change between requests, so dynamic tool results may alter the request prefix and reduce KV-cache reuse; stable static tool schemas and instructions remain cacheable.

## Known Limitations and Deferred Work

- ESPN's public endpoints are unofficial and can change or stop responding. Provider terms and image redistribution rights require independent review.
- Favorites are descriptive standings trends, not calibrated win probabilities or promised winners; missing evidence does not justify a pick.
- A bookmaker price can be displayed only when its source supplies it. No bet is placed, and no direct bookmaker transaction is supported.
- The assistant must emit a valid declarative UI block in its message; receiving a tool response alone does not guarantee that a visual card renders.
- Some disciplines lack player-by-player comparisons, confirmed lineups, or bullpen details. An unavailable value must be shown as unavailable.
