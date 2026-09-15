# Agent Note: Provider accordion, connector catalog, and OAuth popup

Status: implemented

English | [中文](2026-09-15-web-provider-accordion-connector-auth.zh.md)

## Problem

The composer model selector rendered every provider group fully expanded under a sticky heading. Long directories scrolled the first rows under the next group's sticky title, visually clipping them, and the whole catalog stayed unwieldy. The Settings → Connectors catalog had no entries for the Codex and OpenClaw runtimes, and the OAuth sign-in opened its consent window from a polling timer, which browser popup blockers frequently swallowed so the authorize button appeared to do nothing.

## Decision

`ModelSelect` renders each provider as a collapsible group: a full-width header button toggles the group, the group holding the current model is the only one expanded by default (falling back to the first group when the current model is no longer advertised), and collapsed groups render no model rows. The sticky group title is replaced by this header, which removes the scroll-under clipping. Manual toggles are component-local state and win over the default.

The connector catalog gains `codex` (native, OpenAI family) and `openclaw` (native) entries so both runtimes surface in Settings → Connectors alongside their real telemetry. `useAuthorizationAttempt.begin` opens a blank same-origin window synchronously inside the click gesture and the status poll navigates it to the consent URL once the backend returns one, falling back to a plain link when a blocker still refuses.

`workflow-worker-thread` adds a regression test asserting that a non-OpenAI root inherits the parent route (no `agentOptions`), so `gpt-5.6-luna` is only ever forced onto `openai-codex` roots. `api-proxy.selectModel` also writes the resolved provider, model, and effort back onto the live `agent.options` in the same commit: delegators read that object, so without the write a model switch away from `openai-codex` left the stale route and `childRoute` kept forcing `gpt-5.6-luna`. A host test covers the switch-then-delegate path.

## Alternatives considered

**Keep every group expanded.** Rejected: it preserved the clipping and the long, hard-to-scan menu the accordion removes.

**Persist expansion state in a declared store.** Rejected: which group a user has open is a reading gesture, component-local state, with no host or cross-entry stake.

**Open the consent URL only inside the timer.** Rejected: that is exactly what popup blockers intercept; the synchronous-in-gesture window is the standard mitigation and the manual link remains the fallback.

## Consequences

The model menu is shorter and each provider is independently browsable; keyboard focus still walks only the visible headers and rows. The connector hub now names Codex and OpenClaw. OAuth sign-in opens reliably from the authorize button. Non-OpenAI delegation is pinned by a test so a future regression to Luna routing fails CI.
