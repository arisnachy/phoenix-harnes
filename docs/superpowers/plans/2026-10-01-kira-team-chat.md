# Kira Team Chat Implementation Plan

English | [中文](2026-10-01-kira-team-chat.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Restore visible real teamwork and user/agent emoji participation.

**Architecture:** Extend the existing Agent Teams service with chat-only capture, canonical targets and idempotent reactions. Extend the existing conversation renderer and typed message-action slot; retain current scheduling and member limits.

**Tech Stack:** Cordis, TypeScript, Typert remotes, session projections, React, emoji-picker-react, emoji-regex.

**Spec:** [Kira team conversation](../specs/2026-10-01-kira-team-chat-design.md).

## Global Constraints

No additional LLM calls from capture or reactions. No reasoning/tool blocks in public chat. Keep deployment-configured member limits (shipping default: two specialists); Kira selects only as many as real work needs. All interaction stays in the existing main chat and composer. User reply uses the existing parent-authorized continuation. Preserve pinned pnpm and ordinary Git hooks.

## Review Focus

Fork seed duplication, cross-team targets, multi-codepoint emojis, reaction retries/removal, and unloaded plugin callbacks must remain correct.

### Task 1: Durable conversation

Files: agent-team/src/chat-types.ts, chat.ts, chat-projection.ts, index.ts; agent-team/tests/team.spec.ts.

Interfaces: chatMessages({sessionId,limit}) lists canonical id/name/text targets; chatReact({sessionId,messageId,emoji,active}) commits a human reaction; chatReply({sessionId,requestId,targetId,targetIds,text,replyTo}) accepts an authorized continuation. reactToChat(agent,request) uses exact live agent authority.

- [ ] Add failing capture, emoji/toggle, ownership and no-LLM tests.
- [ ] Run focused tests and observe failures.
- [ ] Implement source-suffix capture, bounded read/reply, remote operations and projection.
- [ ] Run owning package tests and persistence cases.

### Task 2: Browser participation

Files: ui-kira-teams/client/TeamChatMessage.tsx, TeamMessageActions.tsx, index.ts; ui-conversation/conversation-nodes/kira-team-message.ts, contract/slots.ts, chat/ChatNodeSeat.tsx, apply.ts.

Interfaces: session-scoped react/reply callbacks and teamChatReactions projection; message-actions slot receives canonical messageId and author identity.

- [ ] Add failing projection and click/reply tests.
- [ ] Implement stable avatars, full emoji picker, reaction removal and directed replies.
- [ ] Verify both ordinary conversation rows and team responses, including reconnect/reload.

### Task 3: Model and assembled checks

Files: tool-agent-team/src/index.ts; relevant READMEs, Agent Note, generators and real browser/Loader scenarios.

- [ ] Add bounded chat-read and Unicode reaction tools with sparse collaboration guidance.
- [ ] Exercise real composition and browser interaction; measure zero reaction model calls.
- [ ] Run relevant tests, typecheck, build, documentation and independent review.
- [ ] Publish the patch; integrate main only after checks and verify stable promotion.

### Expanded acceptance from the user specifications

- [ ] Real Kira + two-agent conversation, interleaved with user intervention in the main composer.
- [ ] Mention routing to one or several real agents; one visible human row; contextual reply; Kira supervision.
- [ ] Stable persona/avatar/role across reload and completed-agent history, independent of runtime model.
- [ ] Durable per-target receipts and idempotent retries; reconnect does not duplicate messages or reactions.
- [ ] Lateral avatars select details and highlight the same transcript rather than opening another chat.
- [ ] Reactions on user, Kira and agent messages, all Unicode emojis, grouping, identities, removal, no LLM calls.
- [ ] Keep Phoenix Auto, trajectory, model controls, input availability, responsive design and configured cost bounds.

- [ ] Verify selected Codex planner + Luna Max workers and selected-model inheritance on other providers.
- [ ] Retain failed-provisioning evidence while releasing capacity.
