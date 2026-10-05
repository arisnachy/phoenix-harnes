# Agent Note: 预留 Google 刷新并拒绝注册表 URL 模板

Status: implemented

[English](2026-10-05-host-release-refresh-and-registry-validation.md) | 中文

## Problem

并发 Google API 调用方可能在凭据查询结束前进入 token 刷新。在这些 await 之后才赋值共享刷新 promise，会允许多次刷新，并可能重复读取同一个 provider 响应。注册表 URL 规范化会对模板花括号进行百分号编码，因此在规范化后仅检查字面量左花括号，会将未解析的模板接受为安装端点。

## Decision

Google broker 在解析客户端凭据之前预留共享刷新 promise。每个调用方都根据得到的 grant 检查所需 scope，包括共享同一次刷新的调用方。注册表候选投影拒绝规范化远程端点中的字面量和百分号编码花括号。这些修复保留固定目的地和已授予 scope 边界。

Google fixture 独立于新增的 GitHub flow 选择 Google 授权 flow，并为客户端 secret 测试提供可写的引用存储。scope 拒绝和 secret 脱敏断言保持有效。

## Alternatives considered

**接受多次刷新或放宽 scope 断言。** 这会掩盖准入竞态，并削弱每个调用方仅获得已同意能力的验证证据。

**期望编码后的模板端点。** 未解析的模板不是安装契约要求的具体端点；调整断言会隐藏规范化错误。

## Consequences

所属 Google 和注册表测试套件的 19 个测试全部通过。并发 scope 覆盖断言 token 仅刷新一次、Gmail 请求成功，以及未授予的 Drive 能力被拒绝。注册表投影在前置的字面量和编码模板候选之后保留具体 HTTPS 端点。不修改发布阈值或测试排除项。
