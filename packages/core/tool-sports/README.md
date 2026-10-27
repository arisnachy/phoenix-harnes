# @phoenix-ai/dsh-tool-sports

English | [中文](README.zh.md)

Native chat-only sports tools for Kira: sports_chat_catalog, sports_chat_discover, sports_chat_games, sports_chat_mlb_pitchers, sports_chat_odds, and sports_chat_ticket. Sports questions use the existing conversation, not a menu. The assistant receives attributed data and declarative sports_game_card or sports_ticket_card blocks to show inside validated generative-ui fences.

## Provider access

ESPN Site/Core and MLB Stats are queried as publicly reachable read-only sources without needing an API key or a PHOENIX_SPORTS_ESPN_ALLOWED setting. Operators may opt out using PHOENIX_SPORTS_ESPN_DISABLED=1 or PHOENIX_SPORTS_MLB_DISABLED=1; public access does not grant a license to reuse data. THE_ODDS_API_KEY is optional and enables paid-provider breadth where licensed. If missing, ESPN Core/Site moneyline quotes are read when available, but no absent prices or missing markets are fabricated. PHOENIX_SPORTS_ESPN_IMAGES_ALLOWED=1 is an additional opt-in after media rights review. Credentials stay in the host environment and never appear in tool output. Only fixed hosts can be queried.

## Model Experience

### Verified sports fixtures and inline cards

#### What the model sees

Kira receives bounded `sports_chat_games` results containing attributed fixture data and declarative `sports_game_card` payloads with local time, teams, source, and optional verified pitcher, lineup, and bullpen information. `sports_chat_odds` may supply real quoted markets; `sports_chat_ticket` only simulates a ticket.

#### Token effect

Each sports request contributes only source-attributed event fields and bounded visual-card payloads to the model context; absent player statistics and prices remain absent rather than becoming synthetic tokens.

#### KV Cache effect

Live fixtures and odds can change between requests, so dynamic tool results may alter the request prefix and reduce KV-cache reuse; stable static tool schemas and instructions remain cacheable.

## PHOENIX Sports Intelligence: automatic ticket execution flow

- `sports_chat_ticket_auto` is the primary ticket-research tool. Pass the exact leg count (1–6), Dominican Republic match date and source sports keys such as `basketball_nba`. Do not show a scoreboard in lieu of the ticket.
- Search attributed h2h prices with a commercial source when configured. A failed or empty paid feed retries free ESPN pricing. A priced combined slip is built only if **all** legs have two competing outcomes, each event is future, quotes are not demonstrably stale, and every selection belongs to the **same bookmaker**.
- Match reported home/away team names against ESPN to enrich sourced logos and standings evidence, showing contradictions instead of masking them. A low bookmaker price is a **market favorite**, not a model's calibrated win probability or a guarantee of value.
- If a complete same-house price set is missing, bounded ESPN research proposes a visually distinct unpriced ticket. Exact league requests remain scoped (e.g. five NBA legs must not silently include NHL).
- Each requested leg is visible in the native ticket; incomplete output is explicitly labelled as a draft. Provider outages do not automatically erase other sources.
- The research engine currently lacks a calibrated predictive model, comprehensive injury/lineup confirmation and reliable across-provider market coverage. A fully priced ticket is **not** proof of positive expected value.
- Placing a real wager requires a named online bookmaker, an authorized user session, platform-specific support, a confirmed amount and market, explicit user approval and a real bookmaker receipt. None of the read-only sports tools performs this transaction. Kira must preserve the prepared ticket and explain the exact missing capability, rather than claim execution or refuse to construct the draft.
- Keep source timestamps and never synthesize odds, matchups, account access, booking links or transaction receipts.

## Known Limitations and Deferred Work

- ESPN's public endpoints are unofficial and can change or stop responding. Provider terms and image redistribution rights require independent review.
- Favorites are descriptive standings trends, not calibrated win probabilities or promised winners; missing evidence does not justify a pick.
- A bookmaker price can be displayed only when its source supplies it. No bet is placed, and no direct bookmaker transaction is supported.
- The assistant must emit a valid declarative UI block in its message; receiving a tool response alone does not guarantee that a visual card renders.
- Some disciplines lack player-by-player comparisons, confirmed lineups, or bullpen details. An unavailable value must be shown as unavailable.
