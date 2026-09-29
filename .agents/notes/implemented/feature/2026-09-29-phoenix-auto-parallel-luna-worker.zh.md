# Agent Note: Phoenix Auto parallel Luna worker

Status: implemented

[English](2026-09-29-phoenix-auto-parallel-luna-worker.md) | 中文

## Problem

Phoenix Auto 已经使用 GPT-6 Sol 进行规划或救援，并使用 GPT-6 Luna Max 执行，但长任务在存在独立分支时仍可能不必要地串行运行。若无条件启动额外代理，某些任务会更快，但许多任务反而会增加 token、重复工作和协调成本。

## Decision

Phoenix 的完整预设现在给根编排器加入了明确的自适应委派规则。当一个清晰独立的工作分支能够缩短总耗时时，根代理可以通过 `workflow` 通常启动一个 GPT-6 Luna Max worker，同时自己继续关键路径。只有确实存在两个独立分支时才允许使用两个 worker。

适合并行的分支包括独立研究、独立验证，或一个有明确边界且其结果不是根代理继续工作的前置条件的实现块。小任务、串行依赖、围绕同一即时修改的工作，以及可以由本地确定性测试完成的检查，都继续由根代理处理。

`standard`、`code` 和 `cordis` 三个完整预设中的 OpenAI Codex 进程内子代理路由现在统一固定为 `gpt-6-luna` + `max`。workflow 引擎每次运行最多两个并发 worker、最多两个总 worker。直接 subagent 和 fork 在父级使用 OpenAI Codex 时也采用相同的 GPT-6 Luna Max 路由。

是否需要委派由规划模型根据任务语义决定。路由层不会盲目启动代理，也不会为了判断是否并行而额外调用一次模型。

## Alternatives considered

**每个可执行任务都自动启动一个 worker。** 被拒绝，因为短任务或高度耦合任务只会增加延迟和 token，而不会缩短关键路径。

**允许无限 worker 池。** 被拒绝，因为质量更难协调，token 增长可能超过时间收益。

**使用第二个 Sol 作为 worker。** 被拒绝，因为 Sol 保留给规划和救援，Luna Max 才是执行 worker。

## Consequences

Phoenix Auto 现在可以在真正可并行的工作上缩短总耗时，同时不会把多代理变成默认行为。根代理仍负责集成和最终验证；被委派的 Luna worker 接收有边界的目标，并返回可直接复用的结果，避免与根代理重复劳动。
