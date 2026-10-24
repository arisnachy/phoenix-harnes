# @phoenix-ai/dsh-tool-sports

English | [中文](README.zh.md)

Native sports tools for Kira run inside the existing conversation, never in a separate menu. The model can query public read-only game feeds and optional bookmaker data, and can return validated declarative chat cards. No wager is placed.

## Provider access

ESPN Site/Core and MLB Stats can be queried without a commercial key, subject to the provider's conditions and availability. Operators can disable these sources with `PHOENIX_SPORTS_ESPN_DISABLED=1` or `PHOENIX_SPORTS_MLB_DISABLED=1`. `THE_ODDS_API_KEY` enables additional licensed odds coverage; absent prices are never fabricated. Image loading requires the separate `PHOENIX_SPORTS_ESPN_IMAGES_ALLOWED=1` opt-in after rights review. Credentials are retained by the host; outbound HTTPS requests use a fixed allowlist.

## Model Experience

### Sports context and inline rendering

#### What the model sees

The model receives `sports_chat_catalog`, `sports_chat_discover`, `sports_chat_games`, `sports_chat_mlb_pitchers`, `sports_chat_odds` and `sports_chat_ticket` tool results. Game feeds include attribution, Santo Domingo-local game times and structured `sports_game_card` data. Tickets are expressly simulations, not transactions. Phoenix renders validated sports cards directly from tool results in the conversation, without making the model repeat JSON fences. The model explains findings and sources in prose.

#### Token effect

The six tool definitions and brief routing guidance consume context tokens when installed. Calling a tool adds a bounded JSON result to the conversation; `sports_chat_games` exposes at most six immediate card blocks in a response, with a remaining-count indicator. Missing source data produces an explicit explanation rather than invented statistics or prices.

#### KV Cache effect

The registered tool definitions and system guidance are stable over the session and can be cached as a prompt prefix where the model provider supports it. Retrieved fixtures, changing odds and simulated ticket selections are dynamic tool results and should not be treated as reusable static KV-cache content.

## Known Limitations and Deferred Work

- ESPN public endpoints are not guaranteed stable and do not confer data or media redistribution rights; operators must review their terms.
- Not every league or market provides results or verified odds, and no calibrated prediction model is included.
- The client extracts validated cards from tool results; end-to-end tests still must verify actual display and guard against duplicate rendering.
- Tickets never place real bets, and their quoted odds must be rechecked before simulation.
