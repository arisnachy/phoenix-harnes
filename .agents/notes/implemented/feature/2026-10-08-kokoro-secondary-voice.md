# 2026-10-08 — Kokoro as a second conversational voice

## User-visible behavior
Codex Realtime continues as the native first-choice voice. When unavailable, Windows uses the per-user Kokoro ONNX resident daemon, then native speech synthesis. Assistant profile gender and conversation language are transported per utterance, so changing the assistant from feminine to masculine changes Spanish voice from ef_dora to em_alex without altering the model configuration.

## Installation and lifecycle
The Windows supervisor starts an isolated installer without delaying Host boot. Weights and dependencies remain in %LOCALAPPDATA%/Phoenix/voice/kokoro, not in update worktrees. Partial downloads are removed; completed files are reused. Installer attempts use an exclusive file lock and a six-hour retry cooldown after failure. Readiness is published only after both Spanish voice syntheses pass. PHOENIX_KOKORO_AUTO_INSTALL=0 disables automatic setup.

## Risks and verification
The Python model uses the upstream kokoro-onnx CPU pipeline and needs sufficient disk, an available Python 3.12 installer and model downloads on first setup. All provider errors preserve platform-native fallback. Validate setup and actual Spanish playback on Windows hardware; TypeScript unit tests cover provider registration and gender payload, and Python offers --self-test and --check commands. No Windows installation was executed in this GitHub-only authoring environment.
