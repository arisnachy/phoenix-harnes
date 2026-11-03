# Agent Note: Consistent Kira conversations and unfinished Team work

Status: implemented

English | [中文](2026-10-31-kira-conversation-consistency.zh.md)

## Problem

The main conversation can present a direct specialist answer as internal dialogue, and a Lead turn can appear complete while a real teammate still has an active work receipt. Generic references such as "la compañera" hide the durable roster identity, while status-only updates obscure whether an artifact was actually handed off.

## Decision

Use durable message recipient and reply metadata to distinguish a direct human answer from peer-only speech; keep the engine separate from agent identity. Track the latest mission-owned participant work status in the existing Session event stream when evaluating mission closure. The working, running and provisioning phases keep a mission open; done and failed remove that specific hold, without overriding independent goals, checklists or task receipts. Lead social guidance uses the specialist's real name, avoids duplicate waiting narration and requires verification before claims of completed deliverables.

## Alternatives considered

A second language-model pass to rewrite agent messages would increase cost and could fabricate relationships or results. Hiding all Team messages would remove transparent coordination. Treating every active roster member as perpetually unfinished would make an already settled mission impossible to close.

## Consequences

No additional model or network call is introduced. A working teammate prevents premature automatic closure, and user-directed answers are visibly distinguished from internal Team handoffs. Participant status is not proof that the artifact itself passed functional testing; existing evidence and mission gates remain necessary.

## Verification

Focused tests cover Kira's named reporting instructions, unfinished participant status and the visible recipient of direct human replies. Full assembled application snapshots and CI are required before promoting to main and stable.
