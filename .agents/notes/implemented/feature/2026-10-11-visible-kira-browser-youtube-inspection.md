# Agent Note: Visible Kira browser and YouTube evidence

Status: implemented

English | [中文](2026-10-11-visible-kira-browser-youtube-inspection.zh.md)

## Problem

The in-chat MiniBrowser was only inserted when the user's words resembled a request to open or visit a website. Kira could use the Chrome MCP connector while researching or investigating a YouTube tutorial but leave the reader with a hidden CDP tab, sometimes with audible media and no associated view. Chrome MCP could read page text and screenshots, but could not retrieve timecoded subtitles or seek video frames for technical analysis.

## Decision

A Chromium navigation tool call now marks the active user turn as a browser turn, even when the user asks for research rather than navigation. Only MCP Chrome/browser navigation, YouTube search, video inspection and new-tab actions count; unrelated web search, read-page, and file tools do not. A separate keyed MiniBrowser card stays attached to its originating conversation turn, and its initial appearance/new page triggers a single automatic scroll into the chat viewport (not continuous scroll while the user reads). The browser still runs with an isolated headless Chromium profile; its audio is muted. Official YouTube watch URLs instead expose a visible embedded player preview in chat, without autoplay, with an explicit human playback button.

The Chrome connector adds a scoped `youtube_video_inspect` tool. Its URL parser accepts only HTTPS YouTube video IDs; its caption reader accepts only YouTube `/api/timedtext` endpoints. The tool reads available public JSON3/XML subtitle tracks, prefers Spanish then English, and reports timestamps and truncation. With browser-action permission it can seek the real Chromium video and attach up to three verifiable screenshot JPEGs as multimodal tool results. It never invents unavailable speech, claims audio recognition, bypasses login/DRM, opens separately billed services, or substitutes generated screenshots.


## Local audio evidence extension

The initial YouTube inspector relied on timed-text and three JPEGs, leaving videos without captions unanalyzable. The Chrome connector now exposes a fixed, bounded in-page MediaRecorder capture of its own video element and streams nothing to third-party speech APIs. A local Python `faster-whisper` runtime is installed/reused on demand through `uv`; captured WebM exists only in an owner-local temporary directory and is deleted immediately after inference. The new `youtube_video_listen` tool lets Kira request timecoded 3–9-second segments on the same tab; the original inspector samples eight seconds only if subtitle text is absent and action permission is granted. The number of real still frames can now be up to twelve (six by default), while each screenshot still requires a verifiably decoded video element. Kira must never equate a short sampled segment with having listened to the full video.

Browser protection, autoplay gating, copy protection, denied access to an audio track, unavailable Python/uv, or failed first-time model downloads are legitimate failure outcomes. Every failure gets a bounded reason code rather than fabricated speech. The normal PHOENIX browser-action authorization is mandatory for playback-based audio capture. The browser host stays muted, while the explicitly activated visible YouTube player handles human playback separately.

## Verification

Focused browser-flow tests cover indirect MCP navigation, unrelated tool exclusion, and video-review requests. MiniBrowser component tests pin non-autoplay preview, explicit playback, and the control to return to Chromium. Browser connector tests pin muted headless Chromium. Video utility tests cover URL/host enforcement, malicious caption endpoint rejection, language priority, JSON3/XML timestamps and missing caption text. CI and an actual Windows Chrome/YouTube session must confirm bundled behavior before a live multimedia guarantee.

## Alternatives considered

Requiring the user to paste transcripts was rejected because accessible public subtitles should be checked automatically first. Showing any new Chrome desktop window was rejected because it breaks the in-chat navigation contract. Using a silent static image as proof of a decoded video was rejected because screenshots can capture buffering or blank surfaces.

## Consequences

Kira can analyze real, accessible YouTube timed-text and inspect selected visible frames, and browser navigation performed during other tasks becomes observable in the MiniBrowser. The headless CDP tab stays isolated and muted, while playback with audio is explicitly human-initiated in the in-chat player. YouTube access, playback and subtitle availability still depend on the video's public visibility, server behavior and permissions.

## Limits and recovery

YouTube can refuse caption retrieval, hide player state, or prevent reliable video-frame seeking. The tool reports missing transcript and missing frames explicitly rather than presenting title/description as full video analysis. Images confirm a Chromium JPEG capture, not that every pixel is a decoded video frame; the model must inspect returned images. Other websites stay CDP screenshot-based, and browser-action permissions remain enforced. Future local audio transcription may be added as an independent, opt-in capability.
