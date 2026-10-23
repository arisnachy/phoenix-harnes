# Agent Note: Desktop Live visible native Windows applications

Status: implemented

English | [中文](2026-10-22-desktop-live-visible-native-applications.zh.md)

## Problem

Phoenix already exposes a guarded Windows `computer` model tool and a current-user browser-control named pipe. The model captures screenshots for its next step, but the Windows desktop shell displays only the MiniBrowser. Paint, Notepad, and other native applications are invisible to the user while Kira operates them. Computer Use also requires an explicit environment opt-in.

## Decision

The Windows composition registers Computer Use by default, unless `PHOENIX_DESKTOP_COMPUTER=0`. Existing sandbox authority and per-call approvals continue to control input. Ordinary browser work continues through the Chrome connector and the existing WebView2 MiniBrowser.

Before desktop mutations, the model tool requests a Desktop Live native-side preflight over the existing current-user named pipe. Requests carry a conversation id and optional window selector; a 30-second lease rejects competing conversation mutations. The native viewer adds a pause toggle which rejects subsequent desktop mutation preflights; this denial is not bypassed through the PowerShell fallback. The viewer shows the chosen native window in the existing 60/40 desktop side pane using `PrintWindow` on an 850 ms refresh; successful native screenshots are also used for the model's visual re-observation. It does not steal focus during preflight, so guarded click/typing still targets the intended app.

The user can hide the viewer without having it automatically reappear, then reopen it with Ctrl+F10. No new unrestricted keyboard/mouse backend is introduced. Without a desktop host, Computer Use retains its existing PowerShell actuator and permission policy.

The previous native-only side pane did not appear when Phoenix was used through its ordinary web conversation, so users could see tools spin without seeing an application. The web app now serves bounded, read-only `/phoenix-desktop-live/state` and `/phoenix-desktop-live/frame` routes over the same local Windows pipe. The broker refuses frames unless the exact conversation id owns an active, visible native viewer. A conversation-level React card appears for explicit Desktop Live/Paint requests, polls real state and verified PNG captures, and shows an unambiguous disconnected diagnosis rather than a fake picture. The MiniBrowser and its own session-scoped CDP controls are unchanged.

For the CLI-only `pnpm phoenix` route, the already-authorized `computer` tool also publishes its verified post-action screenshots into owner-only, expiring temporary files keyed by a hash of the session id. The chat viewer can display those real recent images even without Phoenix.exe; it labels them **recent captures, not live video**. This is a visual fallback, not independent desktop control or additional screenshot authority. The 90-second age limit prevents indefinite retention.

Kira Max previously mandated code-only presentation even when a provider incorrectly called `fs_status` directly. Its scoped tool presentation now uses the supported `both` mode: `run_code` remains available for batched work, while directly named registered tools can execute under the exact same permission policy. This spends more tool-schema tokens to avoid a repeated UNKNOWN_TOOL/no-output failure for models unable to compose a valid code program. The selected provider/model stays under the user's control.

## Alternatives considered

**Replace MiniBrowser with a universal embedded web view.** Rejected: WebView2 cannot embed arbitrary native app windows or run their accessibility trees, and this would regress browser sessions.

**Send input by activating the Phoenix window for each visual frame.** Rejected: it steals foreground focus from the target app, violating the window guard on the next action. Window-targeted `PrintWindow` avoids that coupling.

**Introduce another independent autonomous desktop executor.** Rejected: the existing fixed PowerShell/C# driver already has the security and post-action observation contracts. A second driver doubles policy surface and does not fix visibility.

## Consequences

Kira's existing Computer tool can show Paint and other applications in the native side pane, with a human-visible pause and a per-conversation lease. Native preview is distinct from the original browser and continues to require the existing approval policy. Windows graphics capture is imperfect: some GPU/privileged applications reject `PrintWindow`, and the UI must show an unavailable state rather than fabricated frames. The lease serializes concurrent conversations, but it does **not** provide separate OS desktops or isolated virtual machines. CI Windows and a real Paint session remain required for end-to-end validation.
