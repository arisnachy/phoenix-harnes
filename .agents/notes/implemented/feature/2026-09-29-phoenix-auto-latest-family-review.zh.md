# Agent Note: Phoenix Auto 最新家族执行与独立审查

Status: implemented

[English](2026-09-29-phoenix-auto-latest-family-review.md) | 中文

## Problem

Phoenix Auto 已经可以在 OpenAI Codex 中选择，但其具体路由固定为 `gpt-6-sol` 和 `gpt-6-luna`。因此 Codex 发布新的 Sol 或 Luna 后仍需要修改代码。之前的委派策略允许 Luna 并行执行，但没有保证由新的独立 Luna 完成审查、再由 Sol 做最终判断；对游戏和 3D 等视觉工作尤其不足。

## Decision

Phoenix Auto 现在从实时 OpenAI Codex 模型目录中分别解析最新发布的 Sol 和 Luna 版本。选择器仍显示合成的 `Phoenix Auto`，实际供应商模型会在选择时以及每个新回合开始前刷新。该解析器不会考虑 Astra。

执行契约如下：

1. 最新 Sol 负责规划和编排；
2. 最新 Luna 以 Max 负责主要执行；
3. 根 Luna 仅在确实能缩短关键路径时增加最多一个独立 Luna 执行 worker；
4. 模型审查前先运行确定性的测试和检查；
5. 通过 `workflow` 启动一个新的独立 Luna reviewer，其 prompt 必须以 `PHOENIX_AUTO_REVIEW` 开头；
6. reviewer 只审查、不修改，并返回紧凑的 PASS/FIX 摘要；
7. router 检测到审查完成后，把下一模型步骤交给 Sol 做最终决定；
8. 若 Sol 要求修正，则由 Luna 执行，只有发生实质性修改后才再次审查。

对于游戏、3D、网站以及其他视觉交付物，当工具允许时，reviewer 必须检查真实渲染截图或运行结果；仅仅构建成功不能作为视觉质量证据。

完整 preset 继续把 delegated workflow agent 的上限保持为两个。child route 仍以 `gpt-6-luna` 作为兼容 fallback，但当父代理正在使用 Luna 家族时会继承父代理的实时 Luna id，因此新采用的 Luna 版本也会自动传播到 subagent、fork 和 workflow child。

## Consequences

Phoenix Auto 可以在无需手工修改 router 的情况下采用未来的 Sol/Luna 版本，同时把 Sol 的成本集中在规划、救援和最终判断。Luna 负责执行和第一层独立审查，从而保持质量、速度和成本之间的目标平衡。现有直接模型选择行为不变。
