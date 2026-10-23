# Agent Note: Desktop Live pinned-window preview

Status: implemented

English | [中文](2026-10-23-desktop-live-pinned-window.zh.md)

## Problem

In a browser-only `pnpm phoenix` session, Desktop Live displayed one PNG saved after the most recent Computer action, not a live window feed. The chat displayed that image for up to 90 seconds and the UI stopped polling while the document was hidden. Native Windows captures followed the foreground application when no window selector had been supplied, so switching to Chrome or Phoenix could replace Paint with a recursive view of the chat. Post-action screenshots could also capture the entire screen after the driver had identified the target HWND.

## Decision

**Phoenix Web** offers an explicit `Compartir ventana en directo` action using the browser's native `getDisplayMedia` picker. It accepts only `displaySurface === 'window'`; whole-screen and browser-tab sources are stopped immediately, not labeled as application video. Only a deliberate user gesture authorizes capture. The stream stops when the user changes conversation, deactivates the view, ends browser sharing, or chooses Stop. The video stays inside the current chat and is never uploaded through Desktop Live routes or supplied to the model as input. Existing owner-scoped verified Computer screenshots remain available without a new grant and are labeled `captura reciente`, not video. Desktop status polling no longer depends on the browser tab being in the foreground.

**Phoenix.exe** pins `PrintWindow` snapshots to the selected top-level HWND plus PID rather than dynamically resolving the active application. New session owners clear the previous selector; a closed, minimized, or replaced HWND is not silently replaced with whichever application has focus. The native viewer refreshes every 500 ms using successive screenshots, not an encoded video feed. Explicit `computer focus(target)` supplies the application selector. No new injection API or cross-session capture route is introduced.

**Computer verification** keeps the latest resolved HWND in a WeakMap keyed by the in-memory agent session. Subsequent screenshot and input actions without a new selector reuse that application; `windows` remains global and an explicit `focus` changes the target. It uses `PrintWindow` to capture the selected application instead of whatever the user foregrounds after an action. Cropped screenshot descriptions warn that image pixel coordinates are window-relative, while Computer mouse input still expects absolute screen coordinates from `computer windows`. Windows' foreground input guard still blocks keystrokes or clicks into the wrong window. The legacy Desktop.exe screenshot fallback remains available only for untargeted observations.

## Alternatives considered

**Continuously capture the full desktop.** Rejected because it could expose unrelated windows and recursively display Phoenix chat when the user switches focus.

**Force focus back to the selected window for every viewer frame or input.** Rejected because it steals user focus and creates the risk of misdirected keyboard and mouse actions.

**Automatically grant browser screen sharing to every agent.** Rejected because browser capture requires deliberate user approval and must never silently bypass browser privacy controls.

## Consequences

Users can see continuously updated video of a deliberately shared application window in Phoenix Web, while the native viewer observes the same identified HWND even when chat becomes foreground. Closing or minimizing an application reports unavailability rather than pretending a previously stored image is live. Window capture is user-authorized and is not independent computer-control authority. Some minimized, DRM-protected, privileged, or GPU-backed windows cannot be captured with `PrintWindow`. Background Windows input remains subject to the existing safe foreground guard; this change does not introduce a background keyboard-and-mouse actuator.

## Testing

Unit tests cover refusal of whole-screen and tab sources, session-pinned targets, and window-relative coordinate guidance. Desktop Live native Windows contracts and chat UI tests exercise the changed surfaces. A real Paint session on Windows remains necessary to verify the complete interactive workflow end to end.
