# Agent Note: AgentMail ensure 403 fallback

Status: implemented

English | [中文](2026-10-06-agentmail-ensure-403-fallback.zh.md)

## Problem

Kira mailbox creation could still fail at the first `phoenix_mail_identity action=ensure` call when AgentMail returned HTTP 403 from owner-bound `POST /v0/agent/sign-up`. Phoenix treated that rejection as terminal, so recovery improvements never ran because no mailbox or credential had been persisted.

## Decision

Keep owner-bound sign-up as the preferred recoverable path. When that unauthenticated sign-up is *confirmed* rejected with HTTP 403 (except an explicit provider quota limit), Phoenix falls back to AgentMail's documented two-step onboarding: create a receive-only inbox with `POST /v0/agent/sign-up` using only the username, immediately persist the one-time API key and inbox identity, then attach the stored human owner through authenticated `POST /v0/agent/human` so AgentMail sends the six-digit OTP.

The fallback persists the key before human attachment because email-less AgentMail keys cannot be recovered. If the attachment step fails, Phoenix retains the receive-only inbox and credential instead of losing them. A later explicit `ensure` on a pending mailbox resumes owner attachment through the existing recovery path. Bare unauthenticated gateway 403 is classified separately from a stale stored credential so diagnostics do not claim that a nonexistent key was rejected.

## Alternatives considered

Switching every signup to email-less onboarding was rejected because a lost response before the key is persisted would create an organization whose key cannot be recovered. Retrying owner-bound signup blindly after a confirmed 403 was rejected because it repeats the failing provider path. Asking the user to paste a provider API key was rejected because AgentMail's agent onboarding supports keyless programmatic signup.

## Consequences

A provider-specific 403 on the original owner-bound signup no longer prevents Kira from obtaining an inbox. The normal path remains idempotent and owner-recoverable, while the fallback uses AgentMail's supported receive-only plus attach-human flow. Explicit quota failures still stop instead of creating extra mailboxes.

## Testing

Transport tests distinguish unauthenticated signup 403 from rejected stored credentials. Onboarding tests cover successful receive-only fallback plus human attachment and preservation of the new inbox/key when attachment fails.
