# Agent Note: Allowlist Home Assistant 网关

Status: implemented

[English](2026-08-30-home-assistant-gateway.md) | 中文

## 问题

PHOENIX 没有面向模型连接用户家庭设备的路径。宽泛的 LAN 连接器会暴露不安全的发现和控制面，而通用 HTTP 工具会绕过 harness 权限模型。

## 决策

Home 组增加 Home Assistant REST 能力和独立的面向模型工具消费方。能力只接受私有或本地端点，在请求时从环境变量读取 token，按实体 allowlist 过滤状态读取，并在控制调用前同时检查实体和完整服务 allowlist。只有存在 `PHOENIX_HOME_ASSISTANT_URL` 时，base bundle 才会挂载两行；缺少或为空的 allowlist 会让配置失败，而不是静默授予访问权。

消费方提供 `home_list_devices` 和 `home_control`，转发取消信号，贡献明确的模型指导，并渲染不含凭据的通用执行卡。不包含自动 LAN 发现或任意设备协议。

## 结果

模型可以通过与其他工具相同的工具注册表和 mission-failure 语义操作已批准的 Home Assistant 设备。用户必须有意配置端点、token 变量、实体 JSON 列表和服务 JSON 列表，功能才会出现。

## 考虑过的替代方案

拒绝直接由模型控制 LAN 请求，因为这会绕过端点和操作策略。拒绝把 token 嵌入 patch，因为凭据必须留在配置和日志之外。选择 Home Assistant 专用提供方，而不是通用网关，因为其 API 和 allowlist 语义可测试且有界。

## 测试

网关测试覆盖私有端点验证、token 转发、实体过滤、预检拒绝和批准的控制。工具测试覆盖模型 schema、提示指导、委托和取消转发。两个聚焦测试文件均通过，包类型检查也通过。
