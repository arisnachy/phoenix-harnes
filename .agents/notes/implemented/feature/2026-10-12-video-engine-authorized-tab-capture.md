# Agent Note: Video Engine authorized capture and local media analysis

Status: implemented

English | [中文](2026-10-12-video-engine-authorized-tab-capture.zh.md)

## Problem

YouTube often rejects playback inside the dedicated, muted and isolated Chrome CDP tab. Empty timed-text, zero decoded frames and timeout of the in-page `video.captureStream()` recorder leave Kira with metadata but no authentic visual or audio evidence. Repeating the same failed player call cannot produce media; a longer timeout cannot fix a rejected player.

## Decision

Phoenix retains safe and minimal YouTube caption inspection but adds a second, **user-authorized capture transport**. The human MiniBrowser presents `Compartir pestaña para Kira`; a click opens Chrome's native `getDisplayMedia` chooser, not an automatic background screen recorder. The user chooses the tab whose actual media plays and explicitly selects audio sharing. MediaRecorder records a bounded 30-second WebM of both tracks with a 24 MB upload ceiling. The same-origin, loopback-only MiniBrowser endpoint rejects untrusted and oversized payloads and writes private, UUID-addressed temporary WebM to a shared local capture directory, with one-hour expiry and opportunistic cleanup. No recording is silently started; a different app, tab, or private session cannot be selected by the agent.

The Chrome connector introduces `video_media_inspect`, which uses the latest valid user-authorized capture or a file whose parent directory was explicitly allowed by `PHOENIX_VIDEO_ALLOWED_DIRS`. Decoding uses local FFmpeg, first from PATH or `PHOENIX_VIDEO_FFMPEG`, otherwise a cached copy provisioned through `uv`/`imageio-ffmpeg`. It samples up to eight timestamped JPEG frames; audio is extracted as mono WAV and transcribed by existing local `faster-whisper`. Existing voice transcription is factored into a reusable local-media routine. Only verified frames and text with timestamps are returned to the model; raw audio remains local and intermediate WAV is deleted.

If the internal YouTube player fails, Kira should request the authorized user-facing capture once, then use `video_media_inspect` rather than inventing content or invoking prohibited download workarounds.

## Alternatives considered

Unrestricted downloading or scraping of third-party streaming media was rejected because it may circumvent platform restrictions or copyrighted access. Automatically capturing arbitrary Chrome tabs was rejected because it would violate user expectation and browser permissions. Capturing the headless browser again after it had rejected playback was rejected because there is no decoded audio to record. Automatically granting local file-system access was rejected in favor of the explicit directory allowlist.

## Consequences

User participation is required for tab capture. Chrome's picker must permit audio capture, and protected DRM media may still be blocked. The standalone media input tool can process authorized MP4/WebM/MOV/MKV files independently of YouTube playback, but initial FFmpeg and Whisper environment provisioning may need Internet. The Web app and the MCP connector must share the same OS temporary directory. The video path does not install a browser extension or capture tab audio without consent.

## Verification

Unit tests check authorized request boundaries, EBML WebM marker and size enforcement, deterministic frame timestamps, and local path allowlisting. Typecheck and package tests in CI are required; full Windows Chrome chooser + YouTube playback + FFmpeg/Whisper transcription remains a manual integration acceptance step. A valid thumbnail, title or JPEG shell is not proof that video speech was captured. The test must produce both a real decoded frame and nonempty timestamped speech, or a precise limitation.
