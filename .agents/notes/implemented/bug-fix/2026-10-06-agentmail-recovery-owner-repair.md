# Agent Note: AgentMail recovery and owner repair

Status: implemented

English | [中文](2026-10-06-agentmail-recovery-owner-repair.zh.md)

## Problem

Kira mail could become trapped after an AgentMail credential rejection or an owner-email typo. Pending verification reused owner-bound sign-up for every recovery attempt, rotating the key when the existing key was still valid. A bare provider `403` could leave Settings in a repeated recovery loop. The recovery card displayed the persisted owner email but did not let the user correct it, so a typo could keep sending verification codes to the wrong address. A verified mailbox could also retain a deleted inbox id even after AgentMail returned a valid replacement inbox during credential recovery.

## Decision

Pending verification now uses `POST /v0/agent/human` first, which is AgentMail's supported OTP resend/owner-repair path and does not rotate a valid key. If that request proves the stored credential is rejected, Phoenix falls back to owner-bound sign-up to rotate the credential. Ready mailboxes recover by rotating and proving the credential without demoting the mailbox to pending verification.

Settings exposes the persisted owner address during pending or ambiguous recovery. Editing it calls an explicit owner-repair operation. For a live unverified organization Phoenix updates the human through `/agent/human`; when the stored key is unavailable or rejected, an explicit corrected owner starts a fresh owner-bound enrollment instead of looping on the bad address. Destructive replacement also carries the currently edited owner address.

Credential recovery proves the persisted inbox. If that inbox is gone but AgentMail's idempotent sign-up returns another inbox owned by the rotated key, Phoenix proves and adopts that returned inbox instead of remaining stuck on the stale local id.

## Consequences

A normal expired-key or bare-`403` failure no longer requires a pasted API key. OTP resends avoid needless key churn, owner typos can be repaired in place when possible, and stale local inbox ids can heal automatically. Provider verification and quota gates remain explicit; Phoenix still does not bypass AgentMail verification or request a paid upgrade.

## Testing

Focused onboarding tests cover OTP resend without key rotation, owner correction, bare-`403` fallback, corrected ambiguous enrollment, and stale-inbox adoption. The Settings test covers editing a bad owner address and issuing the owner-repair action.
