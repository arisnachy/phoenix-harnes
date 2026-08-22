# Agent Note: PHOENIX brand system

Status: implemented

[English](2026-08-22-phoenix-brand-system.md) | 中文

## Problem

这个下游仓库已经是 PHOENIX，但发布的 Web 呈现仍使用上游 DeepSeek Harness 的鲸鱼、字标、浏览器标题、PWA 名称和 favicon。这样会让产品身份与运行时及仓库身份互相矛盾，同时还迫使一张上游组合标志适配尺寸完全不同的界面。

## Decision

官方 browser-brand occupant 现在呈现 PHOENIX，同时保留与 DeepSeek Harness 上游同步所需要的 npm 包身份。侧边栏与会话 hero 接收响应式凤凰 SVG 标志，其 `size` 由所属 slot 提供。侧边栏名称使用独立 PHOENIX SVG 字标，因此小尺寸标志不会通过缩放一张大型组合 logo 来实现。

Web shell 默认把文档标题和 PWA 名称发布为 `PHOENIX`，并让 `/favicon.svg` 使用同一凤凰轮廓。构建期 `DSH_CLIENT_TITLE` 继续作为显式标题覆盖项受支持。

React 呈现中的凤凰复用现有 amber 和 red 设计 token，而不是另建一套平行主题色。内部 `@deepseek-ai/dsh-*` 包名、命令和实现术语继续作为技术性的上游身份存在，不被当作用户可见品牌。

## Alternatives considered

**重命名全部 DeepSeek Harness 包和命令。** 拒绝，因为视觉身份变化不足以证明一次性破坏上游同步、workspace import、CLI 命令、文档链接与包所有权是合理的。

**把生成的高分辨率组合图直接放进每个 slot。** 拒绝，因为同一张 raster 组合图无法同时良好适配 24 px 侧边栏标志和大型 hero，会增加客户端体积，并把字标与图标绑死。生成的视觉作品继续作为品牌参考，而运行时 UI 使用响应式 SVG 系统。

**保留鲸鱼，只修改浏览器标题。** 拒绝，因为最主要的可见标志仍会把产品识别成 DeepSeek Harness。

## Consequences

PHOENIX 现在在侧边栏、hero、浏览器标签、favicon 与已安装 PWA 元数据中具有一致的用户可见身份，同时保留 DeepSeek Harness 作为底层实现基础。SVG 标志在宿主请求的不同尺寸下保持清晰，也不需要二进制资产流水线。代价是运行时 UI 使用的标志会比电影感宣传作品更简化；宣传图可以继续保持更丰富的细节，而不必成为小尺寸应用图标。
