# Agent Note: Evidence-gated provider economics for PHOENIX Nexus

Status: proposed

## Problem

PHOENIX has working model directories, a Codex-focused Eclipse route, and visible team identities, but no universal contract separating verified zero cost, limited free quotas, unknown charges and paid use across configured providers. A model name ending in `-free` does not establish billing eligibility, and a generic team glyph obscures real provider provenance.

## Proposal

Implement Nexus as a provider-neutral layer over the existing configured model directory, preserving Eclipse separately. Candidate models carry provider/account authorization, actual serving identity, verified pricing evidence and TTL, capability signals, quality checks, quotas and error observations. A zero-cost-only policy fails closed for unknown prices; a paid policy requires explicit authorization. Local routing stays off by default and must be opted into explicitly. The governor distinguishes local usage receipts from provider-reported account balances and never claims to know the latter when unavailable.

## Alternatives considered

**Use model-name suffixes as free-tier evidence.** Provider pricing and promotions change; a `-free` suffix can be stale or subject to account-specific charges.

**Make Codex Sol supervise every free model call.** The additional premium calls can eliminate savings and fail to catch some mistakes. The user explicitly declined this supervisory model.

**Replace Eclipse immediately.** Eclipse has extensive Codex-specific tool and continuity semantics; invasive replacement before end-to-end tests risks current workloads.

## Acceptance criteria

- All configured provider models are inventoried with explicit authorization and availability states.
- Verified-free, limited-free, paid and unknown states remain distinct and are tied to dated evidence.
- Codex five-hour and seven-day quota forecasts distinguish estimates from account facts.
- Opt-out local routing and no unapproved paid API calls are enforced in runtime.
- Kira/team shows true provider logos and exact serving model without replacing team identity.
- End-to-end provider routing and recovery pass UI, agent, and provider integration tests before enabling Nexus by default.

## Risks

This change starts with a pure pricing/router library and provider-mark rendering. Production wiring, account-aware quota probes, persistence, and real-provider acceptance tests are still required before automatic cross-provider routing can be enabled safely.
