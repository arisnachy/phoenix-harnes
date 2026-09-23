# Agent Note: Windows Credential Manager broker

Status: implemented

[English](2026-09-23-windows-credential-manager-broker.md) | 中文

## 问题

桌面登录流程需要请求并复用凭据，同时不能把它们放入模型可见的 Computer 请求、结果或会话数据。早期的 AppContainer 文件设计无法在私有 SID ACL 下持久写入，返回 `0x80070005`。

## 决策

桌面凭据 broker 作为当前 Windows 用户下的普通进程运行；持久记录使用 `CredWriteW` 写入、`CredReadW` 读取、`CredDeleteW` 删除。每个目标名由稳定的 Phoenix 命名空间和规范化 HTTPS origin 的 SHA-256 哈希组成，因此 origin 不会出现在 Credential Manager 目标名中。

`remember=false` 仍只保存在进程内存中。持久 generic credential 使用 Windows 512 字节 credential blob 上限；host 和 broker 会在成功响应产生前拒绝更长的 UTF-8 secret。broker 保留私有命名管道、host PID 检查、nonce 重放检查、绑定 origin 的 capability 和 capability 单次消费；kill-on-close job 会在桌面 host 退出时结束 broker。

Credential Manager 是当前用户范围的存储。该设计不宣称能隔离拥有相同 Windows 权限的另一个进程。account 和 secret 不会进入进程参数、日志或通用 Computer 协议；secret 只经过私有 broker 管道，并在成功的 `FillOnce` 响应中返回给 native host。

## 考虑过的替代方案

**把 secret 保存到桌面配置文件。** 不采用，因为普通应用文件没有 Windows Credential Manager 的保护，而且会增加另一种需要维护的含密格式。

**通过通用 Computer 协议或会话历史传递凭据。** 不采用，因为这些值可能进入模型请求、工具结果和持久化会话记录。

**继续把存储放在 AppContainer 隔离内。** 不采用，因为私有 AppContainer SID 无法访问当前用户的 Credential Manager，ACL 文件写入也失败。

## 结果

记住的凭据保存在当前 Windows 用户的 Credential Manager 中，只能由相同 Windows 账户使用。该设计无法隔离拥有同一用户权限的其他进程。持久 generic credential 的 UTF-8 上限为 512 字节；未选择保存的凭据只保留到 broker 消费它或退出为止。

## 证据

本地 Windows 集成 probe 使用合成数据通过了 15 项检查，覆盖保存、重启后读取、fill、forget、临时凭据不持久、不同 origin 不存在、一次性 capability 重放拒绝、超长 secret 拒绝和诊断脱敏。Windows workflow 会在发布 broker 后运行该 probe。单独的 host-kill probe 报告 `BROKER_EXITED_AFTER_HOST_KILL=True`。

凭据不会进入通用 Computer 协议、工具结果、会话学习投影、进程参数或 broker 诊断。集成 probe 只使用合成凭据。
