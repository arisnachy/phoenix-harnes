# Agent Note: Single-call verified browser form workflow

Status: implemented

English | [中文](2026-10-16-single-call-browser-form-workflow.zh.md)

## Problem

A 12-field form took over five minutes despite requiring no model screenshots. Phoenix used thirteen browser calls and twenty model steps; its recorded model execution accounted for roughly four minutes, while browser tool time was roughly ten seconds. Multiple model decisions around suggestion selection and speculative receipt wording dominated actual DOM work.

## Decision

The Chrome MCP connector exposes `complete_form`: after one `inspect_page` call, Kira passes up to four ordered phases of at most thirty total typed DOM actions, up to thirty verification expectations, and an optional explicitly confirmed submit target. The backend executes these phases and the checks on the same selected Chromium tab, allowing a short reactive render turn between phases. The first failed action or expectation stops the procedure before submission. A verified form is submitted at most once, and the tool returns a bounded DOM excerpt with the resulting URL and elapsed time. Optional caller-supplied receipt text may be checked, but its absence never becomes an invented confirmation.

The existing `fill_form`, `verify_form` and `submit_form` remain for cases requiring separate actions. Kira Max's browser prompt prefers the new deterministic path, avoids unnecessary HARDNESS/tool discovery and model-routing ceremonies for routine forms, and reports one result rather than narrating each operation.

## Alternatives considered

**Only speed up CDP screenshots and mouse events.** The observed call time was a small part of overall latency, so transport-only optimization cannot eliminate repeated model inference.

**Guess a success message after submission.** The test site used different wording, producing avoidable wait time and a false tool failure. A bounded page excerpt preserves evidence without guessing.

**Submit first and repair afterward.** Repeated submissions can cause duplicate side effects and must not be used to recover unconfirmed autocomplete selections.

## Consequences

One model tool call now performs filling, selection, verification and one authorized submit, reducing model handoffs on predictable form tasks. React-dependent controls can be separated into short phases. The workflow never retries submission after a missing receipt and does not bypass existing permission checks. The result differentiates submission attempts from confirmed receipts. The tool does not promise a universal wall-clock bound, handle cross-origin dialogs, or prove how quickly the model discovers unknown controls.

## Testing

Keyless DOM tests verify a committed autocomplete tag, submission exactly once, failure-before-submit on missing selections, and no replay when receipt wording does not match. A real browser acceptance test is still needed to quantify end-to-end latency.
