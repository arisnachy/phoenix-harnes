# Agent Note: 图像生成公开可复用的本地栅格图路径

Status: implemented

[English](2026-09-03-image-generation-local-path.md) | 中文

## Problem

`image_generation` 会把生成的栅格图复制到耐久附件存储，并返回附件引用，但面向模型的结果不包含本地路径。后续模型步骤虽然能看到图片结果，却无法使用 `read_image` 重新打开生成文件，也无法明确选择它用于另一个本地工件。

## Decision

成功结果现在会在耐久附件引用旁返回已验证栅格图的绝对路径。输出 schema、面向模型的渲染信封和工件 presentation 元数据都会携带该路径。检查生成图目录前，`CODEX_HOME` 会先解析为绝对路径。

## Alternatives considered

**只返回附件引用。** 否决，因为不透明附件 ID 适合耐久历史，但不能给面向模型的文件系统工具提供可重新打开的路径。

**把生成的栅格图复制到仓库工作区。** 否决，因为这会创建未请求的项目文件并污染 checkout；Codex 生成的文件已经在本地，绝对路径足以供本地文件系统能力使用。

## Consequences

后续步骤中，模型可以把返回的路径传给 `read_image`，同时附件仍是会话回放和提供方请求的耐久来源。该路径是主机本地元数据，不是公共 URL 或凭据。聚焦测试同时验证路径和耐久附件结果。
