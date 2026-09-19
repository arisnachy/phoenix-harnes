# 图像生成

[English](image-generation.md) | 中文

PHOENIX 通过 provider-neutral 的 `ctx.imageGeneration` seam 与 `image_generate` 工具提供原创图像生成能力。

第一版实现位于 `@phoenix-ai/dsh-image-generation`。在目前只有一个内置 provider 的阶段，它有意同时包含 Service Definition、Cloudflare Workers AI provider 与面向模型的 Consumer。Provider registry 仍然保持公开，因此未来加入 Cloudflare 的替代 provider 或本地 runtime 时，不需要改变工具 contract。

## 数据流

```text
model -> image_generate
      -> visual prompt policy
      -> ctx.imageGeneration
      -> selected provider
      -> encoded image bytes
      -> ctx.attachments.saveImage()
      -> durable ImageAttachmentRef
      -> tool/result image block
      -> existing Web message-image renderer
```

生成图像永远不会把 provider URL 当作 session 真相。Attachment store 会在 tool result 写入 durable log 之前验证、规范化、content-address 并持久化图像字节。

## 视觉质量规则

Consumer 拥有审美指导，因为它最接近用户/模型的视觉意图。Provider 只执行已经解析好的 prompt。

对于原创 artwork 与产品视觉，PHOENIX 应优先使用 `image_generate`，而不是装饰性 CSS shape、emoji、ASCII art 或粗糙 SVG 替代品。SVG 仍然适用于 vector、icon、logo、diagram、chart 与其他有意采用几何形状的输出。

产品名并不等于 mascot。Prompt 不得仅因为界面叫 PHOENIX 就自动加入 phoenix、bird、turkey、flame 或 logo。

## Cloudflare provider

内置 provider 通过 Workers AI REST API 调用模型。Account id 来自配置或环境变量，token 每次操作都由 `ctx.credentials` 解析。Token 值不会进入 Cordis config、tool arguments、result metadata 或 durable session log。

默认模型为 `@cf/black-forest-labs/flux-1-schnell`。Provider/model 选择属于部署配置，而不是 tool argument，因此模型无法把执行重定向到未经审查的 backend。

## 失败语义

缺少 account 配置、缺少 credential、认证错误、quota/rate limit、timeout、格式异常的 provider 响应以及远端故障都会使用稳定的 `IMAGE_GENERATION_*` code。

当生成能力不可用时，模型应该提示缺少 provider connection，而不是在本地伪造低质量 artwork。
