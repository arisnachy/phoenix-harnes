# Agent Note: Bounded MiniBrowser recovery and exact browser targets

Status: implemented

English | [中文](2026-10-16-bounded-minibrowser-recovery.zh.md)

## Problem

A pending preview request can prevent every later frame from loading. Repeated tab discovery, descriptor writes, and WebSocket setup compete with browser tasks. An explicit tab identifier that disappears can send the Chrome connector to an unrelated page, prompting further inspection and retries against the wrong application.

## Decision

The MiniBrowser bounds HTTP operations through their response bodies and cancels work when its card becomes inactive. It preserves the last valid image and refreshes after a completed user action. Browser startup receives a separate deadline and an ambiguous timeout does not trigger repeated automatic starts. Hidden conversations suspend polling and capture. A FIFO preserves rapid user gestures; a failed operation stops dependent queued gestures instead of replaying them against uncertain state.

The Web bundle reuses CDP connections per target, correlates concurrent commands, shares concurrent captures, and lists tabs once per state read. It publishes the shared browser descriptor only when its contents change; reading a deliberately scoped preview does not select that tab globally. Action deadlines and HTTP disconnects cancel pending CDP commands and prevent later mutation steps. The Chrome connector closes failed transports and rejects an unavailable explicit target. Text waits read page text without collecting form controls. Serialized DOM operations provide their own compiler naming helper so both source and built launchers execute them in a fresh page context. These changes extend the existing [form transport decision](2026-10-16-browser-form-transport-overhead.md).

## Alternatives considered

**Increase the polling frequency.** This adds capture traffic while an outstanding request can still block the preview indefinitely.

**Repeat a timed out action automatically.** A missing response does not establish that a browser mutation failed, so replay can duplicate work or change the wrong page.

**Merge desktop WebView2 and isolated Chromium profiles.** This changes cookies, isolation, and permission ownership without being necessary to repair the preview. Desktop control retains its authenticated native channel, while browser previews and browser tools share the selected CDP target.

## Consequences

Transient preview failures preserve the last image without presenting it as a fresh verification result. An unavailable deliberate target requires a new selection rather than silent fallback. Local HTTP applications remain accessible in the shared browser, and browser DOM tools verify their results directly. Native Computer verification must run through the trusted Host process; an unrelated test process is rejected by the desktop broker.
