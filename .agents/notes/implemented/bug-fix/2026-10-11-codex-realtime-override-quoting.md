# Agent Note: Codex Realtime ChatGPT override must survive launch parsing

Status: implemented

English | [中文](2026-10-11-codex-realtime-override-quoting.zh.md)

## Problem

Phoenix Codex Live voice spawned the CLI with `-c forced_login_method='chatgpt'`. Codex CLI 0.162.1 could reject the argument before checking a valid ChatGPT account, emitting `Invalid override (missing '='): chatgpt`. Account reads could work while Live voice still failed. The Windows fallback builds a `cmd.exe /c` command string rather than an argv vector, so quote removal requires separate handling.

## Decision

The managed Node entrypoint and direct non-Windows Codex CLI receive one argv element containing the explicit TOML string `forced_login_method="chatgpt"`. The Windows `cmd.exe` fallback instead passes the equivalent unquoted `forced_login_method=chatgpt`: Codex's generic config override parser treats a value that does not parse as TOML as a literal string, avoiding Windows shell quote loss. No login, refresh, SQLite, realtime protocol or session persistence policy changes.

## Alternatives considered

Changing `CODEX_HOME` or forcing an account logout and reauthentication was rejected because an already-valid authenticated CLI account is not the cause of an argument parsing failure.

Using outer shell quoting for every invocation was rejected because only the Windows PATH fallback runs through `cmd.exe`, where its quote processing is platform-dependent. Managed Node invocations must retain the documented explicit TOML string directly in their argv.

## Consequences

Voice should no longer fail before `account/read` merely because the forced-login override is misquoted. This is a launch fix, not proof that Realtime/WebRTC services are reachable or authorized; post-launch errors remain separate and must be reported faithfully. Phoenix continues to remove `OPENAI_API_KEY` from the child environment and to use subscription-backed ChatGPT auth only.

## Testing

Regression checks assert the managed/Unix argv vector contains exactly one correctly quoted TOML override, while the Windows fallback contains the shell-safe equivalent. The mocked managed app-server also refuses initialization unless it actually receives the correct double-quoted value. Real Codex 0.162.1 and Windows Live voice verification remain integration checks.
