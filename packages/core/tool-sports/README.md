# @phoenix-ai/dsh-tool-sports

Native chat-only sports tools for Kira: sports_chat_catalog, sports_chat_discover, sports_chat_games, sports_chat_mlb_pitchers, sports_chat_odds, and sports_chat_ticket. Sports questions use the existing conversation, not a menu. The assistant receives attributed data and declarative sports_game_card or sports_ticket_card blocks to show inside validated generative-ui fences.

## Provider access

ESPN Site/Core and MLB Stats are queried as publicly reachable read-only sources without needing an API key or a PHOENIX_SPORTS_ESPN_ALLOWED setting. Operators may opt out using PHOENIX_SPORTS_ESPN_DISABLED=1 or PHOENIX_SPORTS_MLB_DISABLED=1; public access does not grant a license to reuse data. THE_ODDS_API_KEY is optional and enables paid-provider breadth where licensed. If missing, ESPN Core/Site moneyline quotes are read when available, but no absent prices or missing markets are fabricated. PHOENIX_SPORTS_ESPN_IMAGES_ALLOWED=1 is an additional opt-in after media rights review. Credentials stay in the host environment and never appear in tool output. Only fixed hosts can be queried.

## Model Experience

### Sourced sports discovery and cards

#### What the model sees

The tools discover additional league IDs from ESPN Core/Web, then offer league-specific fixtures with source, Santo Domingo-local times and team data, plus real bookmaker quotes and simulation-only tickets. Tool outputs contain renderable JSON for the assistant to reproduce in the same chat. No wager is placed and there is no guaranteed winner. Missing data, operator-disabled providers and unavailable odds are surfaced honestly. Repricing occurs before composing a ticket.

#### Token effect

League discovery and game/odds lookups return bounded source-attributed tool results on demand rather than injecting a live sports inventory into every turn. Avoid repeating unchanged queries.

#### KV Cache effect

Stable tool schemas preserve the reusable prompt prefix. Fixtures, player details and bookmaker results are appended only when requested, so changing scores or prices do not invalidate unrelated context.

## Known Limitations and Deferred Work

- ESPN endpoints are unofficial and can change. Discovery and data rights require review. There is no calibrated predictor, direct bookmaking integration, or full player-by-player comparison for every discipline. The model still must emit the validated block in its final message; tool calls alone cannot force a user-facing card. Source adapter and client snapshot tests are necessary before describing it as universally operational.
