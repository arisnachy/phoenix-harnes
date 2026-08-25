from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


catalog = "scripts/gen-cordis-catalog.ts"
replace_once(
    catalog,
    "  planMode: 'plan.md',\n",
    "  planMode: 'plan.md',\n"
    "  phoenix: 'phoenix.md',\n"
    "  phoenixAiBus: 'phoenix.md',\n"
    "  phoenixContinuity: 'phoenix.md',\n"
    "  phoenixRepoBrain: 'phoenix.md',\n",
)

replace_once(
    catalog,
    "  InvariantInstaller: 'invariants.md',\n",
    "  InvariantInstaller: 'invariants.md',\n"
    "  PhoenixMemoryRecord: 'phoenix.md',\n"
    "  PhoenixRememberRequest: 'phoenix.md',\n"
    "  PhoenixMemoryHit: 'phoenix.md',\n"
    "  PhoenixMemoryId: 'phoenix.md',\n"
    "  PhoenixCreateMissionRequest: 'phoenix.md',\n"
    "  PhoenixMissionRecord: 'phoenix.md',\n"
    "  PhoenixMissionId: 'phoenix.md',\n"
    "  PhoenixMissionTaskRecord: 'phoenix.md',\n"
    "  PhoenixMissionTaskId: 'phoenix.md',\n"
    "  PhoenixPivotTaskRequest: 'phoenix.md',\n"
    "  PhoenixComputeLane: 'phoenix.md',\n"
    "  PhoenixModelRef: 'phoenix.md',\n"
    "  PhoenixRouteSnapshot: 'phoenix.md',\n"
    "  CapabilityEvidence: 'phoenix.md',\n"
    "  ModelRef: 'phoenix.md',\n"
    "  PhoenixRole: 'phoenix.md',\n"
    "  RankedModel: 'phoenix.md',\n",
)

begin = "<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->"
end = "<!-- END GENERATED cordis-surface -->"

en = f'''# PHOENIX

English | [中文](phoenix.zh.md)

PHOENIX is the downstream intelligence and continuity subsystem layered on the native DeepSeek Harness seams. It owns evidence-based model authority, cost-lane classification, deterministic repository intelligence, durable Memory Genome state, and Mission Graph state without replacing the DSH agent loop, tools pipeline, storage, or provider adapters.

Sources: [`packages/phoenix/runtime`](../../packages/phoenix/runtime/) · [`packages/phoenix/ai-bus`](../../packages/phoenix/ai-bus/) · [`packages/phoenix/repo-brain`](../../packages/phoenix/repo-brain/) · [`packages/phoenix/continuity`](../../packages/phoenix/continuity/)

## API ownership

- `ctx.phoenix` owns evidence-ranked authority, bounded failover policy, quarantine, Token Flight Recorder, Agent ROI, and Mother Guard.
- `ctx.phoenixAiBus` classifies already-registered routes into cost lanes; it never grants model authority.
- `ctx.phoenixRepoBrain` owns the deterministic local repository index and bounded `repo_brain` tool surface.
- `ctx.phoenixContinuity` owns durable Memory Genome and Mission Graph state while leaving execution to native DSH workflows, jobs, and subagents.

The public PHOENIX types referenced by these services are documented by their owning package sources and surfaced here as one Cordis subsystem so generated signatures have a stable documentation destination. Capability does not imply authority: provisional or quarantined models cannot win PHOENIX routing.

{begin}
{end}
'''

zh = f'''# PHOENIX

[English](phoenix.md) | 中文

PHOENIX 是建立在 DeepSeek Harness 原生接缝之上的智能与连续性子系统。它负责基于证据的模型权限、成本通道分类、确定性仓库智能、持久化 Memory Genome 与 Mission Graph 状态，同时不替换 DSH 的 agent loop、tools pipeline、storage 或 provider adapters。

源码：[`packages/phoenix/runtime`](../../packages/phoenix/runtime/) · [`packages/phoenix/ai-bus`](../../packages/phoenix/ai-bus/) · [`packages/phoenix/repo-brain`](../../packages/phoenix/repo-brain/) · [`packages/phoenix/continuity`](../../packages/phoenix/continuity/)

## API ownership

- `ctx.phoenix` 负责证据排名权限、有界 failover、quarantine、Token Flight Recorder、Agent ROI 与 Mother Guard。
- `ctx.phoenixAiBus` 只对已注册路由做成本通道分类，绝不授予模型权限。
- `ctx.phoenixRepoBrain` 负责确定性的本地仓库索引和有界 `repo_brain` 工具表面。
- `ctx.phoenixContinuity` 负责持久化 Memory Genome 与 Mission Graph 状态，执行仍交给 DSH 原生 workflow、job 与 subagent。

这些服务引用的 PHOENIX 公共类型由各自 package 源码拥有，并统一映射到本 Cordis 子系统页面，以便生成签名拥有稳定的文档目标。能力不等于权限：provisional 或 quarantined 模型不能赢得 PHOENIX 路由。

{begin}
{end}
'''

Path("docs/subsystems/phoenix.md").write_text(en, encoding="utf-8")
Path("docs/subsystems/phoenix.zh.md").write_text(zh, encoding="utf-8")
