# Agent Note: ChatGPT Web 网桥生命周期

状态：已实现

[English](2026-08-30-chatgpt-web-lifecycle.md) | 中文

## 问题

PHOENIX 已有命名的 `chatgpt-web` 模型路由与健康检查，但用户仍须单独管理本地网桥进程。因此，已安装但尚未运行的网桥需要未记录的手动步骤。

## 决定

`dsh chatgpt-web start|status|stop` 现在管理一个显式配置的本地网桥。`PHOENIX_CHATGPT_WEB_COMMAND` 按 JSON argv 数组解析，并且不经过 shell 启动。`PHOENIX_CHATGPT_WEB_URL` 默认使用 `http://127.0.0.1:17841/v1`，并拒绝非 loopback 主机、嵌入式凭据和不支持的 scheme。控制器在启动成功后以原子方式写入仅所有者可读的状态记录，并在停止或进程失败时移除记录。

状态记录只包含 schema、进程 id 和 loopback 端点。浏览器 profile、cookie、password、authorization header 和命令输出仍由外部网桥负责，绝不会复制到 PHOENIX 状态中。状态查询 `/v1/models`，只公开有界的 ready/unavailable 结果。

## 结果

该路由具有显式的本地生命周期，并可在启动器退出后诊断或恢复。此命令不会捆绑非官方 ChatGPT 登录，也不会在外部网桥不可用时声称其可用。用户仍须单独安装并认证网桥，然后配置其 argv。

## Alternatives considered

启动任意 shell 命令会让转义和凭据泄漏更难控制，因此命令使用显式 argv 数组。保存完整命令可能将 secret 复制到状态文件，因此所有权记录只保存进程 id 和端点。

## 测试

`apps/cli/tests/chatgpt-web-bridge.spec.ts` 覆盖 loopback 配置、错误命令拒绝、原子所有权状态、模型健康和所有者进程停止。`apps/cli/tests/doctor.spec.ts` 继续覆盖有界健康解析。聚焦测试通过了 2 个文件和 9 个测试。
