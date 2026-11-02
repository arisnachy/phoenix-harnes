# Agent Note: Telegram uses composed Phoenix sessions

Status: implemented

English | [中文](2026-10-09-telegram-composed-agent-dispatch.zh.md)

## Problem

The Telegram Host receiver created its own Agent with only a session id, bypassing the Phoenix chat gateway. That Agent had no chosen provider/model or per-session Kira preset. The loop contained the failed turn, so Telegram reported that execution had completed without text even though no normal model execution had occurred.

## Decision

Telegram must create or resume its session through the existing apiProxy.sessions.create path and deliver text through apiProxy.sessions.prompt, which also owns provider selection, preset mounting, durable message attribution and admission. A legacy Telegram Agent is replaced even after a Host restart, when only a cold persisted session remains. A dedicated credential marker identifies the session id last committed by the normal gateway: older ids lack this marker and cannot be resumed as configured sessions. An existing gateway session that fails workspace identity checks receives one fresh-session recovery attempt without discarding the old history. The bot distinguishes model execution errors and blocked/aborted turns from a successful text answer.

## Alternatives considered

Teaching Telegram to copy default-model lookup and mount presets independently was rejected: it would duplicate the chat gateway and drift when routing or workspace policy changes. Continuing to use a bare Agent and editing only the fallback text was rejected because that would conceal the missing configuration rather than restore task execution.

## Consequences

Text requests use the same configured Phoenix execution path as its chat instead of a model-less Agent. Previously paired bots retain their owner authorization. A legacy Telegram session, including one persisted across restarts, may be replaced by a new session id, without deleting the previous log. Telegram records session provenance separately from the pairing credential, clears it on token replacement, and reports a stage-specific safe failure code without leaking exception details. Native calls and voice notes remain separate features; text receipt never activates realtime audio.

## Testing

The Telegram inbox tests cover creation via the gateway with explicit model options, admission via the normal prompt path, model error reporting, migration of legacy active and cold sessions, durable gateway-session reuse, and recovery of moved-workspace session conflicts. Windows end-to-end operation still requires a Host runtime test.
