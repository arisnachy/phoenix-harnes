# PHOENIX voice control: inline orb and native playback recovery

## Problem
The 158px floating Kira portrait was absolutely positioned above the composer, where it could overlap the latest user bubble. Independently, a browser refusing HTMLAudioElement.play() during an authorized Codex WebRTC response left no in-chat user gesture for resuming audio. An upstream Quicksilver v2 refusal is a distinct server capability error and cannot be corrected by a visual change.

## Change
The persistent composer microphone is the single control for starting/stopping voice, now containing a 34px PHOENIX emblem with listening/speaking states. A passive analyser samples the existing input or output MediaStream for scale animation without connecting any node to the speaker output. There is no portrait overlay, extra microphone, or audio stream substitution. A rejected browser play promise publishes a blocked state and reveals a small **Activar sonido** action, which retries play synchronously on the user's click. The existing explicit Codex-unavailable diagnostic and consent-gated Kokoro/browser fallback remain unchanged.

## Verification
Focused composer tests must assert that the orb stays inside the microphone in inactive/listening states and that no floating avatar renders. Native voice tests must exercise blocked playback, the user-triggered retry, continued authorized speech, and the original input/response cancellation gates. Native Codex availability still requires a live authenticated installation and browser microphone/WebRTC check.
