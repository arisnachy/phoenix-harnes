# 图像生成

[English](image-generation.md) | 中文

PHOENIX 通过 provider-neutral 的 `ctx.imageGeneration` seam 与 `image_generate` 工具提供原创图像生成能力。

第一版实现位于 `@phoenix-ai/dsh-image-generation`。它在一个包中组合 Service Definition、两个内置 Service Provider 和面向模型的 Consumer，同时保持 provider registry 公开。

## 数据流

```text
model -> image_generate
      -> visual prompt policy
      -> ctx.imageGeneration
      -> provider selection / fallback
      -> encoded image bytes
      -> ctx.attachments.saveImage()
      -> durable ImageAttachmentRef
      -> tool/result image block
      -> existing Web message-image renderer
```

生成图像永远不会把 provider URL 当作 session 真相。Attachment store 会在 tool result 变成 durable 记录之前验证、规范化、content-address 并持久化图像字节。

## 视觉质量规则

Consumer 拥有审美指导，因为它最接近用户/模型的视觉意图。Provider 只执行已经解析好的 prompt。

对于原创 artwork 与产品视觉，PHOENIX 应优先使用 `image_generate`，而不是装饰性 CSS shape、emoji、ASCII art 或粗糙 SVG 替代品。SVG 仍适用于 vector、icon、logo、diagram、chart 与其他有意采用几何形状的输出。

产品名并不等于 mascot。Prompt 不得仅因为界面叫 PHOENIX 就自动加入 phoenix、bird、turkey、flame 或 logo。

## Provider 选择

`provider: auto` 在存在 Cloudflare account 配置时优先使用 Cloudflare。可恢复的 Cloudflare 故障——认证、quota、rate limit、timeout 或临时 transport/service failure——会回退到 AI Horde。

Cloudflare 使用 `@cf/black-forest-labs/flux-1-schnell`。Token 每次操作都通过 `ctx.credentials` 解析。

AI Horde 始终作为零配置社区回退可用。它会尝试解析可选的 `AIHORDE_API_KEY`；如果没有保存 key，则使用该服务公开记录的匿名 key。Adapter 请求 inline WebP 输出，因此会过期的 provider URL 不会进入 durable session。

显式选择 provider 时采用 fail-closed：选择 `cloudflare` 或 `aihorde` 会关闭自动 fallback。

## 失败语义

Provider 选择、缺少 credential、认证错误、quota/rate limit、queue timeout、格式异常的 provider 响应以及远端故障都使用稳定的 `IMAGE_GENERATION_*` code。在 auto mode 下，只有明确可恢复的 provider 错误才会进入下一个 provider。

当所有生成路径都失败时，模型应报告真实失败，而不是在本地伪造低质量 visual artwork。
