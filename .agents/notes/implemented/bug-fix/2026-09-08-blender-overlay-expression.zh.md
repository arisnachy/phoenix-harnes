# Agent Note: Blender 覆盖配置的参数表达式

Status: implemented

[English](2026-09-08-blender-overlay-expression.md) | 中文

## Problem

Blender 覆盖配置中未加引号的三元表达式包含冒号和随后的空格。YAML 将参数解析为映射而非 JavaScript 表达式，导致配置的 MCP 启动无法解析参数数组。回归测试还包含无效的 Unicode 正则表达式转义。

## Decision

使用折叠的 `!!js` 块标量保存参数表达式，并移除无效正则转义。通过真实 Loader 验证命令和参数环境变量覆盖，而不是在测试覆盖配置中替换这些字段。

## Verification

无密钥 MCP 场景通过配置的表达式启动本地测试服务并发现其命名空间工具。配置断言保留固定来源与重连默认值。测试服务不验证已安装的 Blender 插件或真实 Blender 连接。

## Alternatives considered

- 仅在测试中覆盖参数数组：绕过损坏的生产表达式。
- 删除可配置的三元表达式：移除文档中的本地镜像和受控升级覆盖功能。

## Consequences

提供方来源和超时策略保持不变。每个测试结束后恢复环境变量覆盖，包括资源释放失败的情况。
