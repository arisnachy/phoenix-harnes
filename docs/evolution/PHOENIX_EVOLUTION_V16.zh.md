# PHOENIX Evolution v16

[English](PHOENIX_EVOLUTION_V16.md) | 中文

PHOENIX 是产品本体。DeepSeek Harness 是 upstream foundation；Codex 和 Claude Code 是 capability references/native bridges。Upstream changes 可以改进 PHOENIX，但不得取代其身份、静默扩大权限、覆盖用户数据或绕过审查。

## 通道

- `main`：经过审查的稳定分发。
- `phoenix/evolution-inbox`：隔离/集成区。
- `phoenix/evolution-*`：候选版本与实验。
- DeepSeek source 可以成为 merge candidate。
- Codex/Claude changes 通过 PHOENIX seams 被观察和适配。
- 任何 evolution automation 都不得直接 merge 到 `main`。

## Codex/OpenAI 身份验证

OpenAI API keys 与 ChatGPT/Codex subscription sessions 属于不同的 credential domains。API keys 使用 OpenAI/API-provider route。ChatGPT Plus/Pro Codex sessions 必须使用官方 Codex login/app-server lifecycle。PHOENIX 不得索取 ChatGPT password、抓取 browser cookies，或从未文档化的 access-token claims 推断 account identity。

Codex account surface 只能使用受支持的 app-server data：account/auth mode、rate-limit windows 与 resets、可用时的 account token usage、per-thread token usage，以及受支持的 plan/spend-control metadata。缺失值显示为 unavailable。API billing 与 subscription quota 是彼此独立的 meters。

## Mission Kernel

对于重要工作，PHOENIX 执行：goal decomposition；capability/constraint discovery；specialist selection；tool selection 或 Tool Forge；checkpoint/rollback planning；execution；explicit verification；adversarial critique；当证据否定一条路线时切换 alternate strategy；以及 evidence-backed delivery。重试必须改变相关 hypothesis、strategy、model、tool 或 context，而不是盲目重复失败动作。

## Dynamic teams 与 Team Cockpit

当任务暴露 capability gap 时，PHOENIX 可以创建临时 specialists。每个 child 都携带 role、objective、model/provider、tools/data scope、budget/context envelope、dependency、live state 与 evidence channel。Web cockpit 应显示 team cards、current action、task graph、model/tool、progress/evidence、受支持的 token/cost/quota telemetry，以及 inspect/stop controls。它展示 operational status 和 evidence，而不是隐藏的 chain-of-thought。

## Tool Forge 与 Adaptive Lab

如果没有已安装工具能够完成任务，PHOENIX 可以在隔离 lab 中构建 scoped tool。只有通过 capability contract、static/type/security checks、unit/adversarial tests、fixture/historical-data evaluation、baseline comparison 和 side-effect review 后才可 promotion。

当被要求在某个领域达到卓越时，PHOENIX 首先研究 quality criteria 与 failure modes，定义可测量的 acceptance criteria/baseline，组织 specialists 与 data，测试相互竞争的 hypotheses，执行 held-out/leakage/overfit checks，只有 evidence contract 通过后才冻结 versioned strategy，再进行 bounded deployment，并在 drift 破坏 contract 时重新打开 lab。它可以优化经过测量的 sports/trading performance，但绝不声称 guaranteed profit 或 prediction。

## Full-Access Guardian

Full access 是 capability，不是 blanket permission。执行 high-impact actions 前，PHOENIX 会评估 necessity、least privilege、blast radius、affected data、reversible alternatives、recovery point、verification 与 restoration。如果不存在可信的 recovery path，则必须获得 explicit human approval。Unexpected mutation 会停止进一步写入、触发 recovery/integrity verification，并隔离责任 tool/strategy。

## Memory、温度与外部服务

PHOENIX 可以基于 consent 维护 user profile，用于记录用户主动提供的 name、preferred interaction、technical depth 与 relationships。Credentials 永远不属于 memory。温暖的呈现方式绝不会削弱 scientific rigor 或 safety gates。

Google Workspace 与其他 external services 应置于 connector/MCP/plugin seams 后，并使用具有最小实用 scopes 的 OAuth。Read/write/send/delete authority 必须保持可区分且可审计。

## 自我改进与 promotion

PHOENIX 记录 outcome evidence，而不是 private reasoning；它只能把 routing、prompts、specialist composition、tool choice 与 lab policy 的改进作为经过测试的 candidates。自我改进必须证明具有可测量收益，同时不得降低 identity、security、recovery、data boundaries 或 user control。

Promotion 到 `main` 要求 identity、repository CI、feature tests、secret/credential review、recovery evidence、upstream compatibility、KIRA review，以及从 reviewed inbox 进行 explicit human promotion。
