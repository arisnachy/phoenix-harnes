# Agent Note: Telegram uses composed Phoenix sessions

Status: implemented

English | [中文](2026-10-09-telegram-composed-agent-dispatch.zh.md)

## Problem

The Telegram Host receiver created its own Agent with only a session id, bypassing the Phoenix chat gateway. That Agent had no chosen provider/model or per-session Kira preset. The loop contained the failed turn, so Telegram reported that execution had completed without text even though no normal model execution had occurred.

## Decision

Telegram must create or resume its session through the existing apiProxy.sessions.create path and deliver text through apiProxy.sessions.prompt, which also owns provider selection, preset mounting, durable message attribution and admission. A currently attached legacy Telegram Agent without provider/model is replaced with a new composed session; its old history is retained. The bot distinguishes model execution errors and blocked/aborted turns from a successful text answer.

## Alternatives considered

Teaching Telegram to copy default-model lookup and mount presets independently was rejected: it would duplicate the chat gateway and drift when routing or workspace policy changes. Continuing to use a bare Agent and editing only the fallback text was rejected because that would conceal the missing configuration rather than restore task execution.

## Consequences

Text requests use the same configured Phoenix execution path as its chat instead of a model-less Agent. Previously paired bots retain their owner authorization. A live legacy Telegram session may be replaced by a new session id, without deleting the previous log. Native calls and voice notes remain separate features; text receipt never activates realtime audio.

## Testing

The Telegram inbox tests cover creation via the gateway with explicit model options, admission via the normal prompt path, model error reporting and replacement of legacy active sessions. Windows end-to-end operation still requires a Host runtime test.
