# @phoenix-ai/dsh-client-ui-brand-official

[English](README.md) | 中文

在此下游仓库中，本包会在所有 Web build profile 中用 PHOENIX 品牌填充 `sidebar.brand.mark`、`sidebar.brand.name` 和 `conversation.hero.brand.mark`。标志采用响应式 SVG 凤凰，独立的 PHOENIX 字标则让侧边栏与 Hero 可以请求不同尺寸的标志。

三个占位者通过嵌套的 `slots.inject()` 作为一组声明感知注册安装。因此无论该包的条目先于还是后于侧边栏和会话声明方激活，它都能工作；任一声明折叠时会撤回全部占位者，HMR 期间不会留下混合品牌。上游包身份保持不变，以维持运行时兼容性。

## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **本包保留上游 npm 身份** —— `@phoenix-ai/dsh-client-ui-brand-official` 继续作为内部包名；用户可见产品身份为 PHOENIX。
- **浏览器标题相互独立** —— Web shell 与 official artifact profile 也会在 slot 系统之外选择 PHOENIX。
