# @phoenix-ai/dsh-voice-local

English | [中文](README.zh.md)

Local process providers for [`@phoenix-ai/dsh-voice`](../voice/). The package does not download models or start a process during boot.

## Config

```yaml
- id: voice-local
  name: '@phoenix-ai/dsh-voice-local'
  config:
    kokoroCommand: null
    kokoroArgs: []
    sttCommand: null
    sttArgs: []
    systemTts: true
```

When `kokoroCommand` is present, the `kokoro` provider receives normalized UTF-8 text on stdin and has priority over the system provider. `sttCommand` receives audio bytes on stdin and must print one transcript to stdout. The system provider uses PowerShell `System.Speech` on Windows, `say` on macOS, and `espeak-ng` on Linux.

Commands run with `shell: false`, explicit arguments, hidden Windows windows, bounded stdin/stdout pipes, and abort handling. No secret is put in command arguments or logs by this package.

## Extension points

Inject a `VoiceCommandRunner` in tests or a host wrapper. Deployments can supply a Kokoro command backed by the official local pipeline; the provider package intentionally does not choose model weights, download policy, or a shell script.

## Model Experience

### Local voice provider

#### What the model sees

This package is host-only. It contributes no model-visible tools or context and never determines mission completion; `VoiceCommandRunner` remains a host extension point.

#### Token effect

The local providers add zero model tokens; they receive text or audio through host pipes after the model-facing work is complete.

#### KV Cache effect

There is no cache effect because command execution and audio playback stay outside prompt assembly.

## Known Limitations and Deferred Work

- Availability checks are configuration checks; command installation is validated when the first request runs.
- STT format conversion, microphone capture, and audio playback policy belong to the client or deployment adapter.
