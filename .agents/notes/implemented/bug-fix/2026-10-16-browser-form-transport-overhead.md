# Agent Note: Reuse CDP connections during browser form completion

Status: implemented

English | [中文](2026-10-16-browser-form-transport-overhead.zh.md)

## Problem

The Chrome connector previously opened a new DevTools WebSocket for every DOM action, screenshot, and verification. The MiniBrowser also refreshed JPEG previews frequently even while forms were being filled, and a shared DOM batch could keep references to controls replaced by an earlier field event.

## Decision

`CdpConnectionPool` keeps one DevTools socket per tab, correlates responses to concurrent command IDs, initializes viewport metrics once per connection, closes idle sockets, and rejects outstanding requests on disconnect. The form batch refreshes its shared DOM control list only when a target is absent or detached. The MiniBrowser reduces periodic JPEG capture to 3 seconds when expanded and 4 seconds otherwise; hidden tabs still suspend capture.

## Alternatives considered

**Continue to open one socket for every operation.** This isolates commands but incurs connection and viewport setup overhead repeatedly and encourages screenshot contention.

**Rebuild the entire DOM snapshot before every field.** This avoids stale elements but restores the repeated document scans that batching was built to eliminate.

**Disable the preview entirely.** This minimizes capture overhead but removes the user's ability to inspect live browser work in the chat.

## Consequences

Structured `fill_form` and `verify_form` continue to handle up to 30 controls per call without mouse-driven transcription or automatic screenshots. Dynamic fields can be discovered after an earlier input replaces the form section. The transport still requires explicit browser-action permission, and ambiguous, hidden, disabled, password verification, and file-upload restrictions remain unchanged. A preview can be several seconds behind the live page; the agent must rely on DOM verification rather than the preview as evidence of successful input.

## Testing

The CDP pool has focused tests for socket reuse, one-time viewport setup, command error handling, and reconnection after tab closure. Browser interaction tests cover a field that is synchronously replaced inside a batch. Runtime Chrome and Windows timing tests are required to quantify real-world acceleration.
