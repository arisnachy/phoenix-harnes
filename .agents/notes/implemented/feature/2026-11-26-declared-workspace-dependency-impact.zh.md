# Agent Note: 声明的工作区依赖影响

Status: implemented

## Problem

包的注入元数据只描述源码树中的部分关系。自适应源码检查器在估算源码变更的潜在影响时，需要区分显式工作区依赖和已注册的服务。

## Decision

源码检查器通过独立的 `workspaceGraph` 表示 dependencies、peerDependencies、optionalDependencies 和 devDependencies 中显式的 `workspace:` 声明。唯一的包名称解析为清单中的路径；缺失或有歧义的目标保持未解析状态。该图记录依赖类型、传递性的潜在依赖方以及规范化声明的指纹。现有注入图保持独立。

## Alternatives considered

**用包依赖图取代注入图。** 不采用，因为包关系不能证明服务已注册或正在运行。

**推断未解析声明的目标。** 不采用，因为无法保证清单覆盖范围和包身份。

## Consequences

该图支持源码层面的影响估算，不声称具有因果证明、运行时健康状态或修改权限。它包含开发依赖，并继续遵循现有清单限制。新图不公开版本说明、外部依赖 URL 或命令内容。源码检查器的针对性测试覆盖依赖类型、传递影响、有歧义的目标、未解析目标和确定性指纹。
