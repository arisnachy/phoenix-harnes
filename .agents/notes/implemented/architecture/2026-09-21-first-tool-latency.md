# First-tool latency: evidence-first acquisition

## Symptom

On a tool-heavy coding turn the Web UI could remain at “preparing the response” for roughly 90–120 seconds before the first tool call appeared.

## Root cause

This was not WebView or browser startup. The agent loop does not execute a tool until the model finishes enough of the current response to emit a `tool-call` block. The Web model-selection bridge also used a static execution handoff and its tests treated steps as zero-based, while the live agent loop numbers the first step as 1.

That combination had two problems:

1. the selected route could be bypassed on the live first step even though the handoff contract said the first diagnosis/plan step should remain selected;
2. explicit artifact work still entered a full reasoning request before obtaining cheap filesystem/test evidence, so time-to-first-tool was dominated by model thinking rather than useful I/O.

The Codex adapter itself keeps `prepareCall()` zero-I/O when the selected model already exists in the current snapshot; catalog refresh is forced only on an exact-model miss. The first-tool stall therefore belongs in turn routing, not in model discovery or UI boot.

## Repair

- Make the execution-handoff boundary explicitly 1-based (`afterStep: 1`).
- Re-resolve the handoff from the live model selection on every step instead of freezing it when the Web agent is installed.
- Capture whether the assembled prompt actually exposes tools.
- Detect only narrow, explicit operational artifact requests (action verb + code/file/test/repo signal).
- For those requests only, route step 1 to `openai-codex / gpt-5.6-luna / medium` so Phoenix acquires real evidence quickly.
- After the first tool result, use the existing Luna/high execution route.
- Pure reasoning turns keep the user-selected model and effort, including Max. Non-Codex providers are untouched.

This is a quality-preserving latency trade: spend less reasoning before evidence exists, then spend the stronger reasoning budget after evidence exists.

## Regression coverage

`packages/core/agent/tests/model-selection.spec.ts` now covers:

- the real 1-based handoff boundary;
- Spanish and English operational-artifact classification;
- Luna/medium on the first tool-acquisition step;
- Luna/high on subsequent execution;
- preservation of Max on non-operational reasoning turns;
- no fast-acquisition reroute for non-Codex providers.

The remaining end-to-end latency is provider/network dependent, so this change intentionally avoids claiming a fixed wall-clock SLA. It removes the harness-owned pre-tool overthinking path and makes the fast route deterministic for explicit tool work.
