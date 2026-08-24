# Decisions

DECISION: Display the exact requested product label `PHOENIX HARDNESS` on startup.
WHY: The user repeated this as an explicit acceptance criterion.
IMPACT: Tests and startup copy must use that exact text even though `harness` is the conventional English term.

DECISION: Never collect an OpenAI password in PHOENIX.
WHY: Official Codex sign-in uses a browser OAuth flow and API-key access is a separate usage mode.
IMPACT: The GUI exposes distinct ChatGPT OAuth and API-key actions.

DECISION: Upstream automation may update quarantine refs but never merge directly to `main`.
WHY: Identity, security, Windows compatibility, and user data require review and rollback.
IMPACT: Promotion is an explicit reviewed operation with evidence.
