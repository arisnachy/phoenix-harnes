# Agent Note: Bound slow local model prefill and expose an Ollama picker

Status: implemented

## Problem

An on-device CPU model can spend more than ninety seconds loading or evaluating the first prompt without sending a visible streaming event. A provider stream watchdog and Ollama loopback proxy may end that otherwise valid request. The Settings page already lists installed Ollama models and can pull a typed tag, but requires users to know the exact tag in advance.

## Decision

The `phoenix-local` route defaults to a nine-minute adapter inactivity interval, while the Ollama stream proxy uses an eight-minute activity-resettable deadline and keeps a ten-minute request-wide cap. Other providers, especially Codex, retain their own configured limits. The config parser leaves the optional idle value absent so provider-specific defaults are resolved once rather than masked by a schema default. Explicit overrides remain authoritative.

Settings → Models → Phoenix Local exposes a responsive, searchable, curated set of official Ollama tags, a filter for locally installed models, a link to the current complete official Ollama library, and one-click installation or reconnection through existing authenticated loopback Host remotes. Unlisted tags remain installable through the existing manual input. Unlink and permanent Ollama deletion remain distinct actions.

## Alternatives considered

**Disable idle watchdogs completely.** Rejected because hung local processes and broken transports must eventually release the turn and leave a clear failure.

**Globally extend all provider timeouts.** Rejected because a slow CPU prefill is not evidence that hosted providers or Codex should also tolerate long silent streams.

**Scrape a live third-party catalog in the browser.** Rejected for this iteration: it adds a nonlocal dependency and unbounded catalog/version concerns to a panel whose Host already controls trusted local installation. The official library link preserves discovery breadth without pretending the curated list is exhaustive.

## Consequences

Slow local prefill has more time to produce a first token while hung inference remains bounded. An explicit shorter per-provider timeout can still cause earlier failure and should be reported as configured rather than silently overwritten. The catalog is curated, not a live complete index; it uses the same existing Ollama pull operation, with real byte progress and no shell commands. The change does not measure the user's actual CPU, RAM, or installed PHOENIX version.

## Testing

Configuration tests cover parser-level omission, local default, Codex isolation, and an explicit override. UI tests exercise official link, tag filtering, and one-click install; existing Ollama proxy regression tests retain their injectable short deadlines.
