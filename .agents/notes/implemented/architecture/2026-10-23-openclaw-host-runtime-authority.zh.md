# Agent Note: 受管 OpenClaw Host 运行时授权

Status: implemented

[English](2026-10-23-openclaw-host-runtime-authority.md) | 中文

## 问题

OpenClaw 插件依赖 `openclawManagedRuntime`，但已发布的 Host 组合未注册该服务，因此原生执行始终断开。读取 `openclaw.json`、信任保存的 PID 或仅接收 Gateway 工具预览，都不足以证明进程所有权和用户 Lead 会话授权。

## 决策

基础组合挂载已发布的 OpenClaw 插件，该插件在自身 Cordis 生命周期内注册 Host 所属服务。适配器在每次状态检查、预留、执行和恢复前刷新有效路由，包括 Phoenix 启动后 Gateway 才就绪的情况。启动器管理器验证当前进程所拥有的子进程、活动 PID 与端口、运行时发行包、Windows TCP 监听者、经认证的 Gateway 健康检查和准确的配置摘要。服务只接受认证的回环 OpenClaw、精确匹配的 Codex 代理、受限制的只读沙盒及工具允许列表，并核查 Agent Teams 真实会话的所有权。在预留、原生执行及恢复前重复 Host 检查，不接管孤立进程。

## 后果

只有同一个 Host 管理器启动并持续持有官方 Gateway，且配置完全一致时，适配器才可连接。换进程重启不会继承内存内的执行许可。在全局静止状态和原生批准机制得到验证之前，本改动不自动重启，也不启用可写操作。正式发布前仍必须完成官方 Gateway 的 Windows 验收测试。

## 考虑过的替代方案

拒绝信任保存标记或可连接的 WebSocket，因为旧 PID 与无关的本地服务都可能伪造就绪状态。拒绝接管无法确定所有权的 Gateway 进程，因为会绕过所有权检查。拒绝把 `tools.effective` 预览视为实际运行时授权，因为它不能强制约束原生工具调用。
