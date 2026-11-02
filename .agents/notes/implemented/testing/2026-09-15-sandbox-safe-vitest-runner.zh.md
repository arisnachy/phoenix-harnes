# Agent Note: A sandbox-safe Vitest runner that leaves the fork pool in place

Status: implemented

[English](2026-09-15-sandbox-safe-vitest-runner.md) | 中文

## Problem

在禁止 `child_process.spawn` 的 agent 沙箱中，`pnpm run test` 根本无法启动，而测试套件本身是健康的。在第一个测试文件加载之前，就已经发生了两次相互独立的 spawn。

Vite 8 通过 `optimizeSafeRealPathSync` 执行 `exec("net use")` 来解析 Windows 真实路径，该调用会在打包配置文件时被触达。被拒绝的 spawn 会以 `Error: spawn EPERM` 的形式报告在 `failed to load config from vitest.config.ts` 上，因此该失败看起来像是配置损坏，而不是环境受限。

默认的 `pool: 'forks'` 会在派生的子进程中启动每个测试文件，这是第二次被拒绝的 spawn。

其中只有第一项是偶发的。`pool: 'forks'` 之所以存在，是因为 Node 24 在 worker 线程下会中止 CJS 词法分析器，而 `scripts/ci-workflow.spec.ts` 用一个契约测试锁定了它，要求恰好出现两处 `pool: 'forks'` 声明。为满足沙箱而移除它，等于用环境限制换取受支持 Node 版本上的运行时缺陷。

## Decision

默认配置保持不变，另提供一个可选启用的启动器，为 spawn 受限的环境给出通路。该能力由三个文件承载。

`scripts/vitest-sandbox-preload.cjs` 包装 `node:child_process.exec`，只应答 Vite 为枚举驱动器盘符而发出的 `net use` 命令；其余命令都会到达原始实现。该包装器在 `process.nextTick` 上以空输出以及桩 `stdout`、`stderr`、`stdin` 流调用回调，与该签名调用方所读取的内容一致。

`scripts/test-sandbox.mjs` 设置 `NODE_OPTIONS=--require=<preload>`，并以 `--pool=threads` 运行真正的 Vitest CLI，同时转发调用方剩余的参数。它通过 `npm_execpath` 解析 pnpm，因为在 Windows 上 pnpm 是 `.cmd` 与 `.ps1` 垫片，无法被直接 spawn。

`package.json` 将该启动器暴露为 `test:sandbox`。

`vitest.config.ts` 未被改动：两处 `pool: 'forks'` 声明都保留，`scripts/ci-workflow.spec.ts` 无需修改即可通过。

## Testing

`pnpm run test:sandbox -- packages/util/atomic-write/tests/invariant.spec.ts --reporter=dot` 报告 `Test Files 1 passed (1)` 与 `Tests 1 passed (1)`。对同一文件使用未修改的 `pnpm exec vitest run`，则在配置加载阶段以 `spawn EPERM` 失败。

在该启动器下运行同一个包，报告 `7 passed | 1 failed`。该失败是 `packages/util/atomic-write/tests/atomic-write.spec.ts:66` 处的 `EPERM: operation not permitted, symlink`，属于对符号链接创建的另行限制，本次变更并不声称解决它。

在该启动器下，`scripts/ci-workflow.spec.ts` 报告 `2 failed | 14 passed`，其中进程隔离用例通过。这两处失败涉及 `.github/workflows/ci.yml` 的作业名称，早于本次变更。

## Alternatives considered

**把默认 pool 改为 `threads`。** 已否决：Node 24 在 worker 线程下会中止 CJS 词法分析器，这等于用沙箱限制换取运行时缺陷，并且会破坏锁定 fork pool 的契约测试。

**检测沙箱并自动选择 pool。** 已否决：pool 将取决于任何调用方都无法观测的环境属性，因此同一个提交在开发者机器与 CI 上会以不同的隔离度运行，而两种结果都无法说明实际使用了哪一种。

**打补丁或 vendor Vite 以跳过 `net use` 探测。** 已否决：vendored 依赖在每次升级时都必须重新差分，而该探测只有在 spawn 已被拒绝时才不可达，启动器无需触碰依赖即可应对。

**要求调用方自行提供 preload。** 已否决：这会让每次调用都变成两步序列，很容易只做对一半，而那一半状态会产生上文所述的误导性配置加载错误。

## Consequences

测试套件可以在 spawn 受限的沙箱中运行，同时 CI 保持其原有的隔离度。代价是多了一个有文档记载的入口：`test` 与 `test:sandbox` 在 pool 与加载器上都不同，因此在其中一个下通过，并不构成关于另一个进程隔离度的证据。

该 preload 是环境垫片，而非产品代码。只有 `scripts/test-sandbox.mjs` 加载它；`vitest.config.ts` 与所有运行时入口都不受影响，且该包装器会转发任何它不识别的命令。
