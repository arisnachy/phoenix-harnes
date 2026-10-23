# Agent Note: Desktop Live pinned-window preview

Status: implemented

## Problem

In a browser-only `pnpm phoenix` session, Desktop Live displayed one PNG saved after the most recent Computer action, not a live window feed. The chat displayed that image for up to 90 seconds and the UI stopped polling altogether while the document was hidden. Native Windows captures followed the foreground application when no window selector had been supplied, so switching to Chrome/Phoenix could replace Paint with a recursive view of the chat. Post-action screenshots were also recorded from the whole screen even when the driver knew which HWND had accepted the action.

## Decision

**Phoenix Web** offers an explicit `Compartir ventana en directo` action using the browser's native `getDisplayMedia` picker. It accepts only `displaySurface === 'window'`; whole-screen and browser-tab sources are stopped immediately, not labeled as application video. Only the current user gesture authorizes capture. The stream stops on navigation to a different conversation, deactivation, browser-native track termination or explicit user Stop. The video is local to the currently rendered chat, is never uploaded through Desktop Live routes and does not provide model input authority. Existing session-owned verified Computer screenshots remain available without a new grant and are still labeled `captura reciente` instead of video. Desktop status polling no longer depends on the foreground browser tab.

**Phoenix.exe** pins `PrintWindow` snapshots to the selected top-level HWND plus PID rather than dynamically resolving the active application. New session owners clear the prior window selector; a closed or replaced HWND is not silently replaced with whichever application happens to have focus. The native viewer refreshes at 500 ms (a sequence of verified screenshots, not an encoded video feed). Explicit `computer focus(target)` supplies the HWND/title selector. No new injection API or cross-session capture route was added.

**Computer verification** keeps the latest resolved HWND in a WeakMap keyed by the in-memory agent session. Subsequent screenshot and input actions with no new selector reuse that application; `windows` remains global and a new explicit `focus` changes the target. It chooses the explicit target or the HWND returned by the completed action, capturing that application using `PrintWindow` rather than a screenshot of whichever window the user brought to the foreground. Cropped screenshots explicitly warn that their pixel coordinates are window-relative, while Computer mouse input still expects absolute screen coordinates obtained from the `computer windows` bounds. Windows' safe foreground guard still blocks sending keystrokes or clicks into the wrong window. The legacy Desktop.exe screenshot fallback remains available for untargeted observations only.

## Scope and limitations

Browser window capture is user-authorized by design and requires the user to choose a single app in Chrome's selector. PrintWindow may fail for minimized, DRM-protected, privileged or some GPU-backed windows. Browser track behavior when a selected window is minimized is OS-dependent. Both viewers are observers; continuous input to a background Windows application requires a separate, safely isolated input actuator and is not claimed here. Do not bypass the active-window input guard to make tests green.

## Acceptance

- Sharing a real application window produces continuous browser video independent of chat-tab focus. Monitor and tab captures are rejected.
- Ending sharing or changing conversations stops the track; the recent-screenshot fallback is not mislabeled as video.
- Native preview stays on the selected HWND and PID as the operator brings Phoenix to the foreground; when the target closes, the viewer reports that it is unavailable instead of showing another window.
- Post-action `computer` observations use the acted-on HWND when available; attempting a targeted capture that fails does not leak a fallback capture of another app.
- Keyless client and Computer helper tests cover the capture-source guard and target-selection contract; Windows CI and a real Paint session are still needed to validate the full native pipeline.
