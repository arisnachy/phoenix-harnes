# Agent Note: 打包能力依赖

Status: implemented

[English](2026-09-07-packaged-capability-dependencies.md) | 中文

## Problem

工作区源码解析可能掩盖部署清单缺少的依赖。随附预设引用 HARDNESS 适配器和会话学习，基础 bundle 挂载 MCP 连接器注册表，而会话组件导入会话和审批服务时没有声明全部必要的安装关系。

## Decision

Python 运行时载体声明预设插件及其必需的工作区 peer，包括 HARDNESS 适配器要求的主机服务。基础 bundle 声明配置中的注册表插件。会话组件将 session 和 user-approval 声明为匹配的 peer 与开发依赖，并添加 TypeScript 项目引用。

会话学习将声明的 `./ledger` 导出构建为独立入口，包约束保留该公共运行时文件。静态未使用代码分析明确列出实际通过 YAML 加载的 Python 提供方和记忆测试插件，并将 Codex 识别为外部可执行程序。内置包的发布元数据标识 PHOENIX 修改后的源码，而 vendor 清单保留上游来源。

## Verification

运行时闭包、Cordis 配置和客户端包检查验证这些关系。发布仍然需要完整构建及构建产物检查；依赖图闭合本身不能证明运行时行为。

## Alternatives considered

- 从预设删除能力：通过减少功能来掩盖缺少的安装关系。
- 启用隐式 peer 安装：使部署闭包依赖包管理器推断。
- 将必需 peer 标记为可选：允许安装不完整并在使用时失败。

## Consequences

载体包含更多主机包，因为现有适配器需要它们。以后拆分主机专用适配器可以缩小安装体积，但这与提供随附预设所需依赖是不同的工作。
