# Agent Note: Codex 与 OpenClaw staged upstream intake

Status: implemented

[English](2026-08-31-codex-openclaw-upstream-intake.md) | 中文

## 问题

Codex 与 OpenClaw bridges 会直接同步到 `$DSH_HOME`，因此 upstream change 或部分 bridge failure 可能替换可用 skills，并让 PHOENIX 失去可用 integration。

## 决策

PHOENIX 增加了独立的 upstream intake worker `scripts/phoenix-upstream-update.mjs` 和 launcher command `dsh upstream-update`。

worker 将已初始化 bridge 的 state 与 `openai/plugins` 和 `openclaw/openclaw` 的官方 `main` heads 比较，在同卷的私有 staging home 中暂存有变化的 bridge，运行原生 `sync` 与 `verify`，并且只激活已验证的 candidate。

Activation 通过带 journal 的 filesystem transaction 移动 bridge roots 与 provider-namespaced managed skills；user-owned skills 保持在 transaction 之外。Live verification failure 会从每次运行的 backup 反向恢复 transaction，中断的 transaction 会在下一次 check 前恢复。

Watcher 独立于 PHOENIX profile boot。`auto` 会应用已验证的 candidate，`notify` 会记录可用性，`off` 会禁用 intake。未配置的 bridge 会保持 idle。Update state 记录 commits、statuses、errors 与 transaction identifiers，但不记录 credential values。

Codex 提供 structural `verify` command，用于检查 source identity、unique plugins 与 skills、managed paths、enabled MCP references 以及 generated patch safety。Intake 会拒绝 generated state 和 patches 中旧的 `@deepseek-ai/` references 与类似 credential 的字面值。

## 考虑过的替代方案

**直接同步到 active bridge**：拒绝，因为 fetch、解析或 verification failure 可能损坏可用 installation。

**替换整个 DSH home**：拒绝，因为这可能危及 user skills、sessions、memories、credentials 与其他 provider data。

**自动初始化缺失的 bridge**：拒绝，因为 watcher 不应静默安装用户尚未启用的 catalog。

**使用 PHOENIX source `main` 或 `stable` 作为 upstream source**：拒绝，因为 external bridge updates 需要与 PHOENIX source releases 分离的 trust 与 rollback boundary。

## 结果

已初始化的 Codex 与 OpenClaw bridges 可以接收未来的 upstream revisions，而不会让 active harness 依赖网络可用性或未验证的 candidate。失败的 candidate 会保留以便诊断，最后一个已验证的 bridge 保持 active。Bridge update transaction 会在 `$DSH_HOME/.phoenix-upstream-updates` 下保留 backups，后续 maintenance feature 需要进行有界清理。

## 测试

Intake tests 覆盖 mode validation、official commit parsing、update classification、credential 与 namespace rejection，以及排除 user-owned skills 的 activation plan。Source launcher coverage 会运行 `dsh upstream-update --help`；已安装 Codex bridge 通过 structural verification，live intake check 读取两个 official upstream heads 但不激活它们。
