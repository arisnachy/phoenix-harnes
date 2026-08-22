# Decisions

DECISION: Extend through plugins, profile bundles, and presets.
WHY: DeepSeek Harness documents those extension points and remains in developer preview.
IMPACT: No PHOENIX behavior is added to `agent-loop` or `vendor`.

DECISION: Treat OrcaRouter free as quota-limited and fail closed.
WHY: The current free route consumes claimed free-call allowances and returns an error when exhausted.
IMPACT: PHOENIX never silently selects a paid OrcaRouter model.

DECISION: Make the public CLI package the final PHOENIX bundle layer.
WHY: A public CLI cannot depend on an unpublished fork-private bundle and still be installable from npm.
IMPACT: The Phoenix profile composes only published installation packages; its router is exported from `@deepseek-ai/dsh/phoenix-router`.

DECISION: Route on `agent/inbox/claimed`.
WHY: The task is known there and system-prompt assembly has not yet taken its model snapshot.
IMPACT: Provider request, persona `{{model}}`, and request headers observe one consistent selection.
