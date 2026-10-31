# @phoenix-ai/dsh-tool-voice

English | [中文](README.zh.md)

PHOENIX audio perception and speech tools for Kira. The installed base bundle exposes
these tools in the runtime registry; a restarted Host and active native shell are required
to capture Windows audio.

## Tools

- `phoenix_voice_status`: inspect local speech providers, queue, and Codex Live readiness.
- `phoenix_voice_speak`: synthesize explicitly requested speech, using authorized providers.
- `phoenix_audio_status`: inspect Windows output and microphone availability without recording.
- `phoenix_audio_listen`: capture 3–12 seconds of approved speakers or microphone audio.
- `phoenix_audio_file_listen`: transcribe local media from explicitly allowed directories.
- `phoenix_senses_status`: inspect actual viewers, device availability, and voice state.

## Configuration

PHOENIX uses `PHOENIX_VOICE_ENABLED`, `PHOENIX_VOICE_LANGUAGE` (default `es-DO`),
and the existing local voice services. Native audio requires the Windows `Phoenix.exe`
bridge and user consent for each sample. The optional `PHOENIX_AUDIO_ALLOWED_DIRS`
variable contains semicolon-separated trusted directories for local media. The
transcriber uses local CPU `faster-whisper` via `uv`, installed on demand.

## Model Experience

### Consent-gated perception tools

#### What the model sees

The tools `phoenix_audio_listen` and `phoenix_audio_file_listen` return actual
timecoded speech segments or explicit errors. `phoenix_senses_status` reports
capability metadata; it does not contain images or recorded audio.

#### Token effect

Only short transcripts and structured receipts enter the model context; raw WAV
bytes remain transient in the Host. The response size is bounded.

#### KV Cache effect

The small, stable tool descriptions and prompt guidance are reused across turns;
captured transcripts are dynamic and do not have reusable token prefixes.

## Known Limitations and Deferred Work

These tools do not listen continuously, identify every acoustic event, infer who
spoke, or bypass protected media. Speaker synthesis does not prove audibility.
Desktop viewer availability does not prove that a frame was captured. Each Windows
audio request requires a human decision in a native permission dialog.
