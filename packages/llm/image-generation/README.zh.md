# @phoenix-ai/dsh-image-generation

[English](README.md) | 中文

PHOENIX 图像生成能力。这个单一用途包目前同时包含 capability seam 的三个角色：

- **Service Definition：** `ctx.imageGeneration` 负责 provider 注册、选择、取消以及持久化发布。
- **Service Provider：** 面向 `@cf/black-forest-labs/flux-1-schnell` 的 Cloudflare Workers AI adapter。
- **Consumer：** 面向模型的 `image_generate` 工具及其视觉质量 prompt policy。

在只有一个内置 provider 的阶段，把三种角色放在一个包里可以保持实现紧凑，同时仍然公开 provider registry。以后可以把其他 provider 拆成独立包，而无需改变工具或 session 图像格式。

## 为什么生成的图像会变成 attachments

Provider 返回的是编码后的字节，而不是持久化结果。`ctx.imageGeneration` 会通过 `ctx.attachments.saveImage()` 写入这些字节，并返回 `ImageAttachmentRef`。现有 conversation client 已经会从完成的 tool call 中提取 image block，并把它显示为一等的生成图像，因此 provider URL 永远不会成为 session 的事实来源。

## 配置

```yaml
- id: image-generation
  name: '@phoenix-ai/dsh-image-generation'
  config:
    provider: cloudflare
    accountId: YOUR_CLOUDFLARE_ACCOUNT_ID
    apiTokenEnv: CLOUDFLARE_API_TOKEN
    model: '@cf/black-forest-labs/flux-1-schnell'
    steps: 6
    requestTimeoutMs: 60000
    toolTimeoutMs: 90000
    visualQualityPolicy: true
```

`accountId` 会回退到 `CLOUDFLARE_ACCOUNT_ID`。`apiTokenEnv` 始终只是 credential reference；每次生成时才通过 credential seam 解析真正的 token。secret 不应出现在 Cordis 配置或 session event 中。

默认模型最多接受 8 个 diffusion steps。工具把 `quality: fast` 映射为 4，把 `quality: high` 映射为 8；省略时使用部署配置的默认值。

## 视觉质量策略

当 `visualQualityPolicy: true` 时，PHOENIX 会被明确告知：对于艺术图像和产品视觉，应使用 `image_generate`，而不是用装饰性 CSS/SVG/emoji/ASCII 伪造替代品。Prompt refinement 会保留用户请求的主体和风格，同时加入构图、配色、光照/材质、完成度、无水印和避免意外文字的指导。

策略特别防止一种品牌误判：产品名称 **PHOENIX** 本身不意味着需要鸟、凤凰、火鸡、火焰 mascot 或 logo。只有用户明确要求时才应加入这些元素。

SVG 和 primitive 仍适用于真正的 vector、icon、logo、diagram、chart 和其他基于几何形状的资产。

## Model Experience

成功的 `image_generate` 调用会返回简短 receipt，加上一个由本地持久化 attachment 支撑的 `image` content block。Web conversation surface 已经能识别 tool-result image block，并将其显示在折叠的 Tools group 之外。

如果 provider 尚未配置，工具会明确失败。面向模型的策略要求 PHOENIX 提示需要连接 provider，而不是用低质量 primitive 假装完成视觉设计。

## 已知限制与后续工作

- 内置 provider 需要 Cloudflare account id 与 Workers AI token。外部 free allocation 属于 Cloudflare 的政策，PHOENIX 不保证其永久存在。
- 第一版每次调用生成一张 text-to-image 结果。参考图编辑、mask、variation、seed、明确的 aspect-ratio 控制和多 provider fallback 留待后续。
- 内置 FLUX.1 schnell adapter 按该模型的公开返回格式记录 JPEG 输出。
- 将来可以在同一 seam 注册本地 diffusion runtime，消除网络/API 依赖，而无需改变 consumer。
