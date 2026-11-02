# Agent Note: Telegram waits for Kira's first reply

Status: implemented

English | [中文](2026-10-10-telegram-kira-first-reply.zh.md)

## Problem

Telegram acknowledged every submitted prompt with a fixed "Recibido" chat message. That automatic message appeared before Kira's answer, even for short conversations, and suggested that the bot was responding independently of the configured Phoenix Agent.

## Decision

The Telegram Host receiver sends the Bot API's transient `sendChatAction(typing)` status while a permitted prompt is being admitted and executed. It refreshes the indicator until the dispatch settles, then stops it. The first ordinary chat reply is the configured Agent's visible text, or an explicit, sanitized execution failure. Typing delivery is best-effort and cannot block Agent execution or its reply.

## Alternatives considered

A templated first reply personalized from the user prompt was rejected because it would impersonate Kira without using the model. Waiting silently for lengthy turns was rejected because Telegram provides a transient typing status. Streaming unfinished internal Agent messages was deferred because this Host interface currently only selects results after whole-agent idle, and a separate per-turn delivery mechanism is required to attribute partial output safely.

## Consequences

Short conversations have no duplicate automatic receipt. Longer work displays Telegram's temporary typing indicator, not a fabricated Kira message. Agent-produced progress messages are not guaranteed before the final response; true streamed progress and cross-channel session sharing require a separately designed per-turn transport. Token pairing and authorized chats are unchanged.

## Testing

The Telegram inbox tests verify that no receipt is sent before the Agent becomes idle, the status is cancelled after completion, model text remains the first chat message, and failure of Telegram's typing action does not suppress a genuine answer. A Windows Host and Telegram live-network smoke test remain necessary.
