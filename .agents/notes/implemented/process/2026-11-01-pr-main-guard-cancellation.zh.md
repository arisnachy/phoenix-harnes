# Agent Note: 取消过时的 PR 检查，同时保留 main 构建

Status: implemented

[English](2026-11-01-pr-main-guard-cancellation.md) | 中文

## 问题

Windows main guard 对每个拉取请求 SHA 和 main 推送进行编译与测试。此前工作流对所有事件都配置 `cancel-in-progress: false`，自动提交多个连续修改时，过时的 PR 检查仍占用 Windows 托管运行器，延长集成时间，却无法证明最新 SHA 的正确性。

## 决定

main guard 保留按 `github.ref` 分组的并发规则，但仅在 `pull_request` 事件到来时取消正在运行的旧任务。main 分支推送和手动执行不会自动取消，从而保留稳定发布流程要求的准确 SHA 验证。最新 PR SHA 仍运行完整的 Windows 类型检查、回归测试、构建和原生清单检查。

主 PR CI 和诊断工作流已经会取消被新提交替代的 PR 检查。这一修改统一了 Windows main guard 的行为，不跳过测试、不改变检查名称、不绕过分支保护，也不改变 stable 发布规则。

## 备选方案

- **取消所有正在执行的检查。** 可能中断 main 合并后的必需验证并破坏自动更新 stable 的流程。
- **不再对 PR 运行 main guard。** 会删除合并前重要的 Windows 验证，降低发布质量。
- **只增加运行器容量。** 更多机器仍会为已经过时的 SHA 重复运行测试。

## 后果

新的 PR 提交会取代旧任务，最后一次提交仍须完整通过 guard 才能合并。自动化开发应先完成本地修改和测试，再一次性发布，避免反复取消和 CI 拥堵。其他静态检查和覆盖率错误仍需单独修复。

## 测试

工作流回归测试验证仅针对 PR 的取消表达式以及原有检查范围。GitHub Actions 应将过时的 PR main-guard 任务标记为已取消，main 推送仍完成验证并满足 stable 更新的要求。
