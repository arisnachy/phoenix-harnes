# Kira team conversation

English | [中文](2026-10-01-kira-team-chat-design.zh.md)

Kira coordinates bounded real work. Actual subagent responses appear in the parent chat with stable names and avatars alongside peer messages. The user can reply to a resumable teammate and every participant can add or remove any valid Unicode emoji on user, Kira, or teammate messages.

The existing Agent Teams service owns durable chat-only records and remote operations. It captures finalized text from child session events, excluding inherited fork history, reasoning and tool blocks. Capture never injects model history or wakes agents. Stable source identities de-duplicate replay; paginated chat reads expose message ids to agents. User replies use the existing authorized continuation operation. Reactions are idempotent actor/emoji updates, persisted in the root journal, projected to the browser, and never run an LLM.

The chat UI extends the existing Kira renderer and adds a shared message-action slot for ordinary user/assistant rows. A lazily opened maintained emoji picker supports search and tone variants. Common reactions remain quick buttons. Deployment-configured team limits remain (two specialists in the shipping default); collaboration guidance requires useful evidence, bounded scope, sparse communication and Kira review before completion.

Validation covers source identity, reasoning exclusion, fork suffixes, malformed emoji, toggle/retry races, cold continuation ownership, reload recovery and no model calls from reactions. A real Loader composition and browser scenario cover the full user interaction. Existing SDK projections and documentation are regenerated where durable events or tooling change.

Every interaction belongs to the existing main transcript and composer. Replies retain the exact original message and context. User mentions can address several existing continuable children while publishing one human message; durable admission and per-target receipts make retries safe. Kira receives quiet supervisory context, keeps mission/task authority, and closes the work. Side avatars reveal presence and highlight that agent’s existing interventions without opening a separate conversation. Real roster identity is stable independently of the selected model. No UI-generated dialogue, tool transcript, replacement-surface output or private reasoning is public chat.

Under Codex, the selected model plans, supervises and resolves blockers while the configured Luna Max workers execute bounded tasks. Other providers default to teammates inheriting the selected model. Failed provisioning retains diagnostics and names without occupying member capacity.
