# Agent Note: Fast verified form filling in Phoenix (Chrome/Chromium)

Status: implemented

English | [中文](2026-10-16-dom-batch-forms-without-screenshot-loop.zh.md)

## Problem
The embedded MiniBrowser refreshed Chrome JPEG screenshots every 350 ms expanded or 600 ms otherwise. This continuous CDP/video workload competed with Kira form actions even while no visual analysis was required. Kira sometimes chose a visual click→screenshot→text cycle despite `inspect_page` and `fill_form` already supporting up to 30 fields per one CDP call. Internally `browserBatchExpression` rescanned the entire document separately for each field.

## Decision
- Reuse the first field's sanitized DOM element/candidate snapshot across the batch, refuse detached controls if the page mutates under us.
- New `verify_form` performs one separate read-only DOM comparison for up to 30 field expectations. Only boolean success/failure and sanitized reasons are returned; no actual values, password guess verification, hidden/disabled/readonly inspection, or script injection.
- Lower mini-browser capture rate to 1100/1600 ms, skip captures while the host tab is hidden, refresh on visibility restoration; explicit UI actions still use their real CDP commands.
- In both Kira presets and connector tool metadata prefer `inspect_page` once → `fill_form` in batches → `verify_form` once. Screenshot only if structural DOM is unavailable or the view needs inspection; resubmit nothing automatically. Stop and report protected fields and unexpected mutations.

## Verification
Automated jsdom test checks actual batch serialization executes, traverses the DOM once, verifies filled values, detects a page-side overwrite, and refuses password/hidden reads. Windows typecheck/build and a live Brandpoll run are independent verification requirements, not assumed passed.

## Consequences

Read-only verification still rejects protected fields, unexpected mutations and unsupported DOM states.

## Alternatives considered

Inspect each field through a separate screenshot and DOM traversal. Rejected because repeated captures slow the batch workflow.
