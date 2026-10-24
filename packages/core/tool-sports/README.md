# @phoenix-ai/dsh-tool-sports

Native chat-only sports tools for Kira: sports_chat_catalog, sports_chat_games, sports_chat_odds, and sports_chat_ticket. Sports questions use the existing conversation, not a menu. The assistant receives attributed data and declarative sports_game_card or sports_ticket_card blocks to show inside validated generative-ui fences.

## Provider access

PHOENIX_SPORTS_ESPN_ALLOWED=1 and PHOENIX_SPORTS_MLB_ALLOWED=1 require explicit provider terms review. THE_ODDS_API_KEY enables licensed bookmaker quotations. PHOENIX_SPORTS_ESPN_IMAGES_ALLOWED=1 is an additional opt-in after media rights review. Credentials stay in the host environment and never appear in tool output. Only fixed hosts can be queried.

## Model Experience

The tools offer league-specific fixtures with source, Santo Domingo-local times and team data, plus real bookmaker quotes and simulation-only tickets. Tool outputs contain renderable JSON for the assistant to reproduce in the same chat. No wager is placed and there is no guaranteed winner. Missing data, unauthorized providers and unavailable lines are surfaced honestly. Repricing occurs before composing a ticket.

## Limitations

ESPN endpoints are unofficial and can change. Discovery and data rights require review. There is no calibrated predictor, direct bookmaking integration, or full player-by-player comparison for every discipline. The model still must emit the validated block in its final message; tool calls alone cannot force a user-facing card. Source adapter and client snapshot tests are necessary before describing it as universally operational.
