# Agent Note: Phoenix Auto 价值学习与 Codex CLI 新鲜度

状态：已实现

[English](2026-09-29-phoenix-auto-learning-and-codex-cli-update.md) | 中文

## 问题

Phoenix Auto 已能使用 Sol 6.1 进行规划/救援，并使用 Luna Max 执行，但固定的委派策略无法知道对于重复类型的任务，串行执行、一个 Luna worker 或两个 Luna worker 哪一种最好。只优化速度可能浪费 token 或降低质量；只优化 token 又可能让用户等待更久。

本地 Codex CLI 也是一个独立变化的依赖。PHOENIX stable 更新和 Codex plugin 更新都不能保证已安装的 Codex 可执行文件本身是最新的，因此旧 CLI 可能延迟新的账户可见模型或 app-server 修复。

## 决策

Phoenix Auto 只从已验证完成的任务中学习执行策略。现有 session-learning 遥测记录端到端耗时、模型 token、工具调用、工具失败、重试和人工干预。Phoenix 另外记录无秘密的路由事实：已验证运行是否使用 Sol 6.1 planner 与 GPT-6 Luna、发生多少 Sol/Luna 路由阶段、多少救援阶段，以及启动了零个、一个还是两个 workflow worker。

保留的执行策略为：

- `serial`：仅 Luna Max root；
- `parallel-1`：Luna Max root 加一个有界 Luna Max worker；
- `parallel-2`：Luna Max root 加最多两个有界 Luna Max worker。

任何策略都不会因为一次成功就被提升。每种策略至少需要两个已验证运行，并且至少需要两个可比较策略。Phoenix 复用现有 Pareto 优化器，只有当恰好一个已验证策略在不降低质量底线的前提下支配其他方案时，才提升为路由偏好。如果时间与 token 之间存在权衡而没有唯一胜者，就保持未决，而不是发明任意加权分数。学习得到的指导仍然要求当前任务确实存在支持并行的独立分支。

PHOENIX 还运行独立的 Codex stable 更新 watcher。它解析 stable `@openai/codex` 包版本，并在 `$DSH_HOME/codex-runtime` 下维护 Phoenix 自己的 runtime。新的 app-server/账户进程以及实时模型发现都会优先使用这个已验证的 managed runtime；发布包中固定的 Codex 依赖和环境 PATH 命令仍作为安全回退。如果当前全局 `codex` 命令可以明确归属于 npm 或 pnpm，watcher 也会更新该安装；有歧义或不支持的全局安装保持不变，而 Phoenix 仍可通过 managed runtime 前进。watcher 不会降级领先/预发布安装，不会把预发布版本当作 stable 目标，在可见 Codex 进程活动时延迟更新，并在安装后验证 managed/global 结果。

Codex/upstream watcher 与 PHOENIX stable 激活互相独立。即使 Windows supervisor 拥有 PHOENIX 自身 updater，它们也继续运行，因此 supervisor 模式不再抑制生态更新检查。

## 隐私与安全

学习只保存聚合的策略/资源事实，以及原本已经过清理的任务指纹/摘要。worker prompt、worker 输出、凭据、原始工具参数和身份不会被加入路由学习聚合。未验证或失败的任务不能教会首选路由。

Codex updater 是 best effort。失败只写入诊断状态并让 PHOENIX 继续运行。无效或不完整的 managed runtime 会被自动忽略并回退到 bundled 版本；对于不支持或有歧义的全局安装方式，它不会猜测如何修改。

## 结果

重复工作可以逐渐收敛到已经实际证明在保持已验证质量的同时更快、资源更少的执行形态。新任务仍然探索；检测到漂移时会回到审慎复核；并行永远不会成为无条件默认值。

Codex 新鲜度不再与 PHOENIX 发布绑定：执行、原生账户元数据和实时模型发现都可以收敛到同一个已验证 managed runtime，同时包所有权与 stable 版本边界可防止全局自动更新变成不安全的猜测。
