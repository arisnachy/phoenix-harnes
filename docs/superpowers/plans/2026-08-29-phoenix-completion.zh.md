# PHOENIX 完成实施计划

[English](2026-08-29-phoenix-completion.md) | 中文

> **对于代理执行者：** 使用 `superpowers:executing-plans` 按任务执行本计划。每一步使用复选框跟踪。

**目标：** 完成 PHOENIX 的持久化、自恢复任务流程，提供 Hermes 风格的操作控制，验证网页配额界面，并在所有检查通过后发布分支。

**架构：** 以 session log 作为唯一事实来源。把 supervisor 意图、策略选择、重试、撤销和 judge 反馈保存为有界的类型化事件；启动时重建进程状态，但需要明确权限才能继续会修改工作区的任务。复用现有 command registry、profile boot、Codex plugin bridge、MCP registry 和 Playwright fixture。

**技术栈：** TypeScript、Cordis、SQLite/JSONL、Vitest、Playwright、pnpm、GitHub CLI。

**规范：** 当前任务中用户提出的 supervisor 持久化/恢复、策略选择、retry/undo/doctor/config/update、连接器验证、配额视觉验证以及 GitHub 发布和提升。

## 全局约束

- Phoenix 自有包使用 `@phoenix-ai/*`；vendored Cordis 身份保留为明确的 upstream 依赖。
- 所有模型可见状态都必须记录并可从 session event stream 重建。
- retry 和策略切换必须受配置限制，不能绕过权限。
- 重启后的工作区修改必须由明确的 resume 权限授权。
- secret 只通过环境变量传递，不进入日志、snapshot、commit 或命令输出。
- 只有在验证 outgoing SHA、本地 gates、远程 checks 和合并结果后才能提升到 `main` 或 `stable`。

### 任务 1：持久化 mission supervisor 状态

**文件：**
- 修改：goal domain、goal tool 和 persistence catalog
- 新建：goal-round-driver supervisor helper
- 修改：goal-round-driver driver
- 测试：supervisor、goal 和 invariant tests
- 更新：goal-round-driver 双语 README
- 更新：同一 PR 的 Agent Note

**接口：**
- `goal/supervisor` 保存 goal identity、status、next action、attempts 和有界错误摘要。
- supervisor helper 提供 replay 和 checkpoint append。
- driver 在 session start 重建诊断状态，但只在精确 `update_goal resume` 后恢复权限。

- [ ] 为重启后的 supervisor checkpoint 重放添加测试。
- [ ] 证明恢复不会在明确 resume 前排队工作区修改。
- [ ] 实现类型化事件、解码、checkpoint 写入和恢复路径。
- [ ] 运行 supervisor、goal 和 judge 的聚焦测试。
- [ ] 更新 persistence catalog 和双语文档。
- [ ] 提交 `feat: persist mission supervisor state`。

### 任务 2：正式策略 registry 和有界选择

**文件：**
- 新建：goal strategy helper
- 修改：goal domain、prompt 和 driver
- 测试：strategy 和 driver tests
- 更新：goal-round-driver README 和 Agent Note

**接口：**
- `GoalStrategyId` 为 `baseline`、`verification-first`、`alternate-tool` 和 `minimal-change`。
- `selectNextStrategy` 确定性选择下一个策略，并避免立即重复。
- `goal/strategy` 在 prompt 准入前记录选择和原因。

- [ ] 测试确定性轮换、耗尽处理和持久化重放。
- [ ] 通过现有 session append API 实现策略选择和事件记录。
- [ ] 把策略和 judge 反馈放进规范 prompt。
- [ ] 运行 driver、invariant 和 judge 聚焦测试。
- [ ] 提交 `feat: record bounded goal strategies`。

### 任务 3：Hermes 风格的操作控制

**文件：**
- 修改：commands registry 和 command presentation tests
- 新建或修改：CLI doctor、config 和 update commands
- 修改：CLI dispatch 和 build-bin tests
- 修改：retry/undo session 记录和 snapshots
- 更新：CLI reference 文档和 Agent Note

**接口：**
- `dsh doctor` 输出不包含 secret 的 PASS/WARN/FAIL。
- `dsh config` 委托现有 boot-free config dump。
- `dsh update` 默认 dry-run，显式 apply 才安装。
- `/retry` 和 `/undo` 只追加 recovery event，不删除历史。

- [ ] 为命令和非法参数添加 parser/build-bin 测试。
- [ ] 使用现有 profile/home helper 实现 CLI dispatch 和 handler。
- [ ] 添加持久化 retry/undo 记录和 snapshot。
- [ ] 运行命令测试和 build-bin smoke。
- [ ] 提交 `feat: add Phoenix operator controls`。

### 任务 4：连接器和插件 e2e inventory

**文件：**
- 修改：built-bin 和 MCP inventory tests
- 新建：脱敏 connector verification report script
- 修改：发现真实回归时的 MCP tests
- 更新：connector verification 文档和 Agent Note

**接口：**
- 无凭据测试验证 plugin/MCP composition，并在缺凭据时 fail closed。
- 凭据测试只在对应环境变量存在时运行，报告不包含 secret。
- 报告使用 `PASS`、`SKIPPED_NO_CREDENTIAL` 或 `FAIL`。

- [ ] 添加无凭据 plugin/MCP composition inventory 测试。
- [ ] 为可用 provider 添加凭据门控的 connector smoke 测试。
- [ ] 运行 inventory 和可用的凭据测试，并明确记录跳过项。
- [ ] 提交 `test: inventory plugin and MCP connector health`。

### 任务 5：配额视觉验证

**文件：**
- 修改：CodexQuotaRemaining component、CSS 和 tests
- 修改或新建：quota Playwright fixture
- 新建：脱敏的确定性配额 visual snapshot

**接口：**
- Settings 相邻区域显示 5 小时和 7 天剩余百分比与重置倒计时。
- loading、不可用和零剩余状态必须可访问且互相区分。

- [ ] 添加浏览器断言，验证两个时间窗口、标签和重置倒计时。
- [ ] 运行聚焦 Playwright 测试并保存 screenshot/snapshot。
- [ ] 提交 `test: verify Codex quota presentation`。

### 任务 6：pre-push、发布和提升

**文件：**
- 除非 gate 发现真实缺陷，否则不修改源码。
- 只有知道准确发布 SHA 后才更新 release/Agent Note 文档。

- [ ] 运行 `pnpm run change-scope --base origin/stable` 并检查完整 outgoing scope。
- [ ] 根据 diff 运行聚焦测试、`pnpm run build`、`pnpm run hygiene` 和 `pnpm run doc-sync`。
- [ ] 推送 feature branch 并验证远程 SHA 相同。
- [ ] 创建或更新 PR，等待 GitHub checks。
- [ ] 按远程策略提升到 `stable`，验证 merge SHA 和 checks，再提升到 `main`。
- [ ] 报告本地 SHA、远程分支 SHA、checks、跳过的连接器和 LIVE 限制。

## 自检

本计划覆盖用户提出的六个阶段。凭据依赖的连接器检查保持条件执行，并明确区分无密钥组合证明与真实 provider 证明。持久化恢复状态不等于自动恢复工作区修改权限。
