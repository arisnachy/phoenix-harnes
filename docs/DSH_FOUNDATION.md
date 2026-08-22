# PHOENIX on DeepSeek Harness

PHOENIX is a downstream distribution and evolution of DeepSeek Harness (DSH), not an independent competing harness.

## Foundation

The upstream engine is pinned in `PHOENIX_UPSTREAM.json` and mounted at `upstream/deepseek-harness`. PHOENIX modifications live as overlays, plugins, bundles, profiles, adapters, policies and UI/desktop packaging around that exact upstream commit. Upstream core is patched only when DSH exposes no stable seam capable of expressing the requirement.

This preserves three properties simultaneously:

1. PHOENIX genuinely runs on the DeepSeek Harness codebase.
2. PHOENIX can absorb new DSH releases by changing the pinned upstream commit and replaying/verifying the PHOENIX layer.
3. Every PHOENIX-specific behavior is attributable and testable instead of becoming an unreviewable hard fork.

## Migration map from the standalone prototype

| PHOENIX capability | DSH seam / destination |
| --- | --- |
| Universal provider bus | `ctx.llm` adapters + PHOENIX model/provider policy |
| Model Capability Ladder | provider/model directory + request-time policy plugin |
| Model Team Genome | agent/subagent selection policy + telemetry |
| Intelligent Router | `agent/request` interception + `ctx.llm` selection |
| Mission Graph | goals + continuable subagents + durable session events |
| Agent ROI Gate | pre-subagent dispatch policy |
| Token Flight Recorder | telemetry + system-prompt/tool-schema accounting |
| Zero-Loss Context | session event log + request projection/compaction plugin |
| Memory Genome | durable session/memory service layered on session events |
| Never-Stop Missions | agent continuation + jobs + provider failover policy |
| MCP Hibernate | tool/provider lifecycle plugin; lazy activation |
| Security Membrane | `tools/pre-execute`, `fs/*`, approvals, sandbox, credentials |
| Resource Governor | subprocess/sandbox/jobs admission policy |
| Rebirth | durable session fork/resume/checkpoint semantics |
| Local Evolution | local-only policy/strategy challenger service |
| Collective Evolution | observe-only inert evidence; no peer executable payloads |
| Toolsmith | sandboxed local capability forge after static + dynamic verification |
| Flight Deck | PHOENIX-branded DSH web/desktop UI |
| Windows app | PHOENIX desktop wrapper + packaged DSH runtime |

## Product rules

- Product identity is PHOENIX. DSH remains acknowledged upstream under its MIT license and third-party notices.
- The user should not need to understand DSH internals to use PHOENIX.
- New PHOENIX behavior should prefer DSH's documented plugin/service/event seams.
- No remote PHOENIX node may send executable code, MCP servers, commands or patches that another node auto-runs.
- Local evolution may optimize routing, context, team composition, skills and strategy, but may not self-rewrite the PHOENIX/DSH security boundary.
- Model capability and model authority remain separate concepts.
- High-risk release/security changes remain independently gated and reversible.

## Upstream update protocol

1. Select a DSH upstream commit/release.
2. Update the gitlink and `PHOENIX_UPSTREAM.json` together.
3. Re-apply PHOENIX overlays/plugins.
4. Run upstream DSH gates plus PHOENIX gates.
5. Run migration/regression/security/token benchmarks.
6. Only then promote the new PHOENIX baseline.

The objective is not to hide the upstream. The objective is to turn a strong plugin-first base into a provider-neutral, locally evolutive, security-bounded, resource-aware PHOENIX product.
