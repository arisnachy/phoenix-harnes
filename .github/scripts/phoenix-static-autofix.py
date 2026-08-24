from pathlib import Path
import json

ROOT = Path('.')


def replace_once(path: str, old: str, new: str) -> None:
    p = ROOT / path
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'expected repair anchor missing: {path}')
    p.write_text(text.replace(old, new, 1))


# Publication policy: apps/vscode/package.json already declares this exact payload.
replace_once(
    'scripts/check-workspace-constraints.ts',
    "  '@deepseek-ai/dsh-web-frontend': ['dist', '!dist/**/*.map'],\n",
    "  '@deepseek-ai/dsh-web-frontend': ['dist', '!dist/**/*.map'],\n"
    "  '@deepseek-ai/dsh-vscode': ['extension.cjs', 'README.md', 'CHANGELOG.md', 'LICENSE'],\n",
)

# examples/mcp-chrome.cordis.yml and the memory examples resolve this workspace package.
examples_path = ROOT / 'examples/package.json'
examples = json.loads(examples_path.read_text())
deps = examples.setdefault('dependencies', {})
if deps.get('@deepseek-ai/dsh-mcp-client') != 'workspace:*':
    deps['@deepseek-ai/dsh-mcp-client'] = 'workspace:*'
    examples['dependencies'] = dict(sorted(deps.items()))
    examples_path.write_text(json.dumps(examples, indent=2, ensure_ascii=False) + '\n')

# JSDoc: fix the exact 19 current verify-export-jsdoc violations.
replace_once(
    'packages/credentials/authorization/src/index.ts',
    "  /**\n"
    "   * Read one flow's explicitly sanitized live telemetry, when it offers any.\n"
    "   * This method never reads the credential record itself and never returns an\n"
    "   * owner-defined opaque payload.\n"
    "   */\n"
    "  inspect(key: CredentialKey, signal?: AbortSignal): Promise<AuthorizationTelemetry | undefined> {",
    "  /**\n"
    "   * Read one flow's explicitly sanitized live telemetry, when it offers any.\n"
    "   * This method never reads the credential record itself and never returns an\n"
    "   * owner-defined opaque payload.\n"
    "   * @param key - credential record whose registered flow should be inspected.\n"
    "   * @param signal - optional cancellation signal for the live telemetry read.\n"
    "   * @returns sanitized telemetry from the flow, or undefined when it exposes none.\n"
    "   */\n"
    "  inspect(key: CredentialKey, signal?: AbortSignal): Promise<AuthorizationTelemetry | undefined> {",
)

replace_once(
    'packages/credentials/authorization/src/types.ts',
    'export type AuthorizationTelemetry = AuthorizationAccountTelemetry',
    '/** Fixed, secret-free telemetry schema exposed by an authorization flow. */\n'
    'export type AuthorizationTelemetry = AuthorizationAccountTelemetry',
)

replace_once(
    'packages/llm/llm-pi-ai/src/login.ts',
    "export const NATIVE_SESSION_AUTH_PROVIDERS = new Set<string>(['openai-codex'])",
    "/** Providers whose credentials are owned by a native product session rather than pi-ai login. */\n"
    "export const NATIVE_SESSION_AUTH_PROVIDERS = new Set<string>(['openai-codex'])",
)
replace_once(
    'packages/llm/llm-pi-ai/src/login.ts',
    'export function usesPiAiLogin(providerId: string): boolean {',
    "/**\n"
    " * Decide whether a provider should expose the generic pi-ai login flow.\n"
    " * @param providerId - catalog provider identifier.\n"
    " * @returns true when pi-ai, rather than a native session bridge, owns login.\n"
    " */\n"
    'export function usesPiAiLogin(providerId: string): boolean {',
)
replace_once(
    'packages/llm/llm-pi-ai/src/login.ts',
    'export function registerPiAiFlows(ctx: Context, auth: PiAiAuthInjection): void {',
    "/**\n"
    " * Register neutral authorization flows for every pi-ai provider that supports login.\n"
    " * @param ctx - Cordis context that owns the authorization service.\n"
    " * @param auth - credential-store adapter supplied to pi-ai.\n"
    " */\n"
    'export function registerPiAiFlows(ctx: Context, auth: PiAiAuthInjection): void {',
)

replace_once(
    'packages/subagent/subagent-codex/src/account.ts',
    "export const CODEX_ACCOUNT_KEY = credentialKey('subagent-codex', 'account')",
    "/** Credential marker for the Codex-managed ChatGPT account session. */\n"
    "export const CODEX_ACCOUNT_KEY = credentialKey('subagent-codex', 'account')",
)
replace_once(
    'packages/subagent/subagent-codex/src/account.ts',
    'export interface CodexAccountBridgeConfig {',
    '/** Runtime configuration required to open and dispose the native Codex account bridge. */\n'
    'export interface CodexAccountBridgeConfig {',
)
replace_once(
    'packages/subagent/subagent-codex/src/account.ts',
    'export interface CodexAccountSnapshot {',
    '/** Secret-free account, rate-limit, and usage snapshot returned by the Codex app-server. */\n'
    'export interface CodexAccountSnapshot {',
)
replace_once(
    'packages/subagent/subagent-codex/src/account.ts',
    " * Unknown provider fields are discarded rather than copied through.\n"
    " */\n"
    "export function codexAccountTelemetry(snapshot: CodexAccountSnapshot): AuthorizationTelemetry | undefined {",
    " * Unknown provider fields are discarded rather than copied through.\n"
    " * @param snapshot - native Codex account snapshot to sanitize.\n"
    " * @returns the fixed public telemetry projection, or undefined when no supported account is present.\n"
    " */\n"
    "export function codexAccountTelemetry(snapshot: CodexAccountSnapshot): AuthorizationTelemetry | undefined {",
)
replace_once(
    'packages/subagent/subagent-codex/src/account.ts',
    '/** Read the native Codex account plus rate-limit/token-activity snapshots. */\n'
    'export async function readCodexAccountSnapshot(',
    "/**\n"
    " * Read the native Codex account plus rate-limit/token-activity snapshots.\n"
    " * @param ctx - Cordis context used to spawn the Codex app-server.\n"
    " * @param config - environment and disposal policy for the native bridge.\n"
    " * @param signal - optional cancellation signal for the account read.\n"
    " * @returns the current secret-free Codex account snapshot.\n"
    " */\n"
    'export async function readCodexAccountSnapshot(',
)
replace_once(
    'packages/subagent/subagent-codex/src/account.ts',
    '/** Register the native Codex account authorization flow. */\n'
    'export function registerCodexAccountFlow(',
    "/**\n"
    " * Register the native Codex account authorization flow.\n"
    " * @param ctx - Cordis context that owns authorization and subprocess services.\n"
    " * @param config - environment and disposal policy for the native bridge.\n"
    " * @returns disposer that unregisters the Codex account flow.\n"
    " */\n"
    'export function registerCodexAccountFlow(',
)

# New evolution documents must enter the repository as complete bilingual pairs.
def ensure_switcher(path: str, switcher: str) -> None:
    p = ROOT / path
    text = p.read_text()
    lines = text.splitlines()
    if switcher not in text:
        lines.insert(1, '')
        lines.insert(2, switcher)
        p.write_text('\n'.join(lines) + '\n')


ensure_switcher('docs/evolution/PHOENIX_AUTO_UPDATE.md', 'English | [中文](PHOENIX_AUTO_UPDATE.zh.md)')
ensure_switcher('docs/evolution/PHOENIX_EVOLUTION_V16.md', 'English | [中文](PHOENIX_EVOLUTION_V16.zh.md)')
ensure_switcher('docs/evolution/ROLLBACK.md', 'English | [中文](ROLLBACK.zh.md)')

(ROOT / 'docs/evolution/PHOENIX_AUTO_UPDATE.zh.md').write_text(r'''# PHOENIX 稳定自动更新

[English](PHOENIX_AUTO_UPDATE.md) | 中文

PHOENIX 源码安装使用经过审查的稳定通道，而不是盲目拉取 GitHub 上的每一个 branch。

## 发布路径

```text
upstream / labs / feature branches
            |
            v
phoenix/evolution-inbox
            |
      KIRA + CI gates
            |
            v
          main
            |
       CI succeeds
            |
            v
 phoenix/update-channel
            |
            v
     PHOENIX installs
```

`main` 是稳定的事实来源，但新的 `main` commit 只有在仓库针对当前 `main` head 的 `CI` workflow 成功后才会被分发。随后，`.github/workflows/phoenix-stable-update-channel.yml` 会把精确的 40 字符 commit SHA 发布到隔离的 `phoenix/update-channel` branch 中的 `.phoenix/channel/stable.json`。

更新通道只包含元数据。实验性源码绝不会被复制到其中，客户端也绝不会从 `phoenix/evolution-inbox`、Codex branches、Claude branches、DeepSeek upstream branches 或 laboratory branch 安装。

## 客户端行为

源码 checkout 会运行 `scripts/phoenix-auto-update.mjs`。

默认策略是 `PHOENIX_UPDATE_MODE=auto`：

1. 验证 `origin` 是官方 PHOENIX 仓库；
2. 要求 checkout 位于 `main`；
3. 获取稳定通道 manifest；
4. 验证指定 commit 可从 `origin/main` 到达；
5. 拒绝降级或分叉历史；
6. 当 worktree 包含本地修改时拒绝自动变更；
7. 在候选 commit 上创建分离的临时 Git worktree；
8. 在其中执行 frozen dependency install、完整 build 和 CLI smoke test；
9. 将当前 commit 记录到 `refs/phoenix/recovery/last-good`；
10. 仅使用 `git merge --ff-only` 推进实时 `main`；
11. 安装、重建并对实时 worktree 执行 smoke test；
12. 如果实时步骤失败，则重置到 recovery commit 并重建最后一个已知良好版本。

更新器不会读取、复制、重置、删除或迁移 `$DSH_HOME`、credential stores、sessions、user projects、memories 或其他用户数据。

## PHOENIX 运行期间

CLI 会启动低频更新 watcher。默认轮询间隔为十分钟。当新的稳定 SHA 出现时，正在运行的 harness 会显示更新通知，但不会在 session 活跃期间替换自身文件。在 `auto` 模式下，安装会延迟到该 PHOENIX process 退出之后；届时候选版本会在安装前重新获取并重新验证。

下一次 Windows 启动也会在 boot 前执行更新检查。普通的网络/通道故障会保留最后一个已知良好的 PHOENIX。只有极端情况下实时更新和 rollback 都失败时，才使用致命 updater exit code `12`。

## 策略控制

- `PHOENIX_UPDATE_MODE=auto` — 默认；安全地通知并安装稳定更新。
- `PHOENIX_UPDATE_MODE=notify` — 通知有更新，但不修改 checkout。
- `PHOENIX_UPDATE_MODE=off` — 禁用稳定通道检查。
- `PHOENIX_UPDATE_POLL_MS=<milliseconds>` — watcher 间隔，最短限制为一分钟。

开发 branches 永远不会被自动更新。因此，开发者可以在 `phoenix/*`、`codex/*` 或其他 branch 上工作，而稳定更新器不会重写该 branch。

## 恢复与审计

更新前的最后一个源码 commit 保留在：

```text
refs/phoenix/recovery/last-good
```

最近一次 updater 结果写入仓库 Git 元数据：

```text
.git/phoenix-update-state.json
```

该状态记录 source/target SHAs 和结果，不记录 credentials 或用户内容。

## 信任边界

此机制只分发已经跨过 PHOENIX 稳定边界的 commit。它被刻意设计成不是点对点自我修改系统。本地 PHOENIX 可以在自己的 laboratory/evolution 边界内发明工具、specialists、strategies、experiments 或候选源码更改，但可执行的 evolution 仍必须成为经过审查的源码并通过仓库 gates，之后才能进入 `main`，也因此才能到达其他 PHOENIX 安装。
''')

(ROOT / 'docs/evolution/PHOENIX_EVOLUTION_V16.zh.md').write_text(r'''# PHOENIX Evolution v16

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
''')

(ROOT / 'docs/evolution/ROLLBACK.zh.md').write_text(r'''# PHOENIX Evolution 回滚契约

[English](ROLLBACK.md) | 中文

Capability 不等于 authority。Full-access 只改变 PHOENIX 能做什么；它并不授予 blanket permission。

在 destructive、credential、control-plane、filesystem-wide、connector-write 或 sandbox-bypass actions 之前，PHOENIX 必须对 side effect 分类，选择 least-privilege route，定义精确的 affected scope，创建可信的 recovery point（Git/worktree、backup、transaction/snapshot、export 或 explicit undo），定义 post-action verification，并明确 verification 失败时如何恢复 state。

如果不存在可信的 recovery path，则执行前必须获得 explicit human approval。

发生 unexpected mutation 时：停止 affected scope 内的进一步写入，在不包含 secrets 的前提下保留 diagnostics，恢复 recovery point，运行最小 integrity proof，并隔离责任 tool/strategy/model 组合，直到新的 lab candidate 通过。

任何 upstream update 都不能仅仅因为更新就进入 `main`。Identity、security、regression、recovery、KIRA review 与 human promotion 必须先通过。
''')

# README.zh.md already contains the Windows/VS Code delta. Add only the two
# English sections that are still missing so the pair remains a minimal update.
replace_once(
    'README.zh.md',
    "`phoenix-windows.cmd` 会自动进入自身所在的仓库目录，使用 Node.js 内置的 Corepack 准备依赖，在需要时构建 PHOENIX，并启动本地 Web UI。不需要全局安装 `pnpm`。\n\n### 在 Windows 上配置 OpenRouter",
    "`phoenix-windows.cmd` 会自动进入自身所在的仓库目录，使用 Node.js 内置的 Corepack 准备依赖，在需要时构建 PHOENIX，并启动本地 Web UI。不需要全局安装 `pnpm`。\n\n"
    "### 稳定自动更新\n\n"
    "PHOENIX 源码安装遵循仓库的稳定更新通道。新的 `main` commit 只有在当前 `main` 的 CI 成功后才会发布给客户端。运行中的安装会检测新的稳定 commit，并默认在活跃的 PHOENIX session 关闭后安装；Windows 也会在下一次启动前检查稳定通道。\n\n"
    "自动安装要求官方 `origin`、`main` branch、干净的 worktree、fast-forward history、成功的隔离 preflight build，以及 recovery checkpoint。实时更新失败时会 rollback 到之前的已知良好 commit。Development branches 和本地修改过的 checkout 永远不会被自动覆盖，而且 updater 永远不会修改 PHOENIX 用户数据、credentials、sessions、memories 或 projects。\n\n"
    "设置 `PHOENIX_UPDATE_MODE=notify` 可只接收通知而不安装，设置 `PHOENIX_UPDATE_MODE=off` 可禁用检查。完整的 release、recovery 与 trust contract 参见 [PHOENIX 稳定自动更新](docs/evolution/PHOENIX_AUTO_UPDATE.zh.md)。\n\n"
    "### 在 Windows 上配置 OpenRouter",
)
replace_once(
    'README.zh.md',
    "提供方、密钥、端点、模型目录和当前模型都通过 Web UI 管理。免费模型适合测试，但仍受 OpenRouter 的可用性与速率限制约束。\n\n## 社区与支持",
    "提供方、密钥、端点、模型目录和当前模型都通过 Web UI 管理。免费模型适合测试，但仍受 OpenRouter 的可用性与速率限制约束。\n\n"
    "### 连接 ChatGPT / Codex\n\n"
    "PHOENIX 将 OpenAI API-key 身份验证与 ChatGPT subscription 身份验证严格分开。原生 Codex bridge 使用官方 Codex app-server 管理的 ChatGPT login，因此 OAuth persistence 与 token refresh 由 Codex 自己负责。PHOENIX 不会索取 ChatGPT password，也不会解析、复制或持久化 ChatGPT OAuth tokens。\n\n"
    "挂载原生 Codex bridge 后，**设置 → 模型 → 账户连接**会提供 **ChatGPT / Codex** 登录。同一个原生 account plane 可以读取当前 ChatGPT plan、Codex rate-limit windows、reset times 与 account token-activity data，而无需通过通用 `pi-ai` OAuth adapter 路由 subscription。\n\n"
    "## 社区与支持",
)

print('PHOENIX static source repairs staged in worktree')
