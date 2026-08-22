# @deepseek-ai/dsh-client-ui-brand-official

[English](README.md) | 中文

在此下游仓库中，本包会在所有 Web build profile 中用 PHOENIX 品牌填充 `sidebar.brand.mark`、`sidebar.brand.name` 和 `conversation.hero.brand.mark`。标志采用响应式 SVG 凤凰，并复用现有 amber/red 设计 token；PHOENIX 字标独立渲染，因此侧边栏与 hero 可以请求不同尺寸的标志，而不必缩放一张大型组合图。

三个占位者通过嵌套 `slots.inject()` 作为一组声明感知注册安装。因此，无论该包条目先于还是后于侧边栏和会话声明方激活，它都能正常工作；任一声明折叠时会撤回全部占位者，HMR 期间不会留下混合品牌。上游 npm/包身份保持不变，因此这个下游视觉层不会重命名 DeepSeek Harness 的实现依赖。

Web shell 另外默认把文档标题和 PWA 应用名称发布为 `PHOENIX`，并让 `/favicon.svg` 使用同一套凤凰轮廓；official artifact profile 也会把 `DSH_CLIENT_TITLE` 固定为 `PHOENIX`，因此 release build 不会静默恢复上游标题。

## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **包仍保留上游 npm 身份** —— `@deepseek-ai/dsh-client-ui-brand-official` 继续作为内部包名以保持上游兼容；用户可见呈现为 PHOENIX。
- **运行时图稿有意简化** —— 发布的 SVG 保留已批准的凤凰身份，同时在 24–34 px 仍可辨认；更丰富的电影感作品继续作为宣传资产，而不是小尺寸 UI 标志。
