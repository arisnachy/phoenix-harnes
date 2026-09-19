# @phoenix-ai/dsh-image-generation

[English](README.md) | 中文

PHOENIX 图像生成能力。这个单一用途包同时包含 provider-neutral runtime、内置远程 provider，以及面向模型的 `image_generate` consumer。

- **Service Definition：** `ctx.imageGeneration` 负责 provider 注册、自动选择/回退、取消和持久化发布。
- **Service Providers：** 已配置的 Cloudflare Workers AI / FLUX.1 schnell 优先；AI Horde 提供零配置的匿名社区回退。
- **Consumer：** `image_generate` 与视觉质量 prompt policy。

Provider registry 保持公开，因此以后加入本地 diffusion runtime 时，无需改变 tool contract 或 session 图像格式。

## 为什么生成图像会变成 attachments

Provider 返回编码后的字节，而不是持久化结果。`ctx.imageGeneration` 通过 `ctx.attachments.saveImage()` 写入这些字节并返回 `ImageAttachmentRef`。现有 conversation client 已经会从完成的 tool call 中提取 image block，并显示为一等的生成图像，因此 provider URL 永远不会成为 session 的事实来源。

## 配置

```yaml
- id: image-generation
  name: '@phoenix-ai/dsh-image-generation'
  config:
    provider: auto
    accountId: YOUR_CLOUDFLARE_ACCOUNT_ID
    apiTokenEnv: CLOUDFLARE_API_TOKEN
    model: '@cf/black-forest-labs/flux-1-schnell'
    aihordeApiKeyEnv: AIHORDE_API_KEY
    steps: 6
    requestTimeoutMs: 60000
    hordeTimeoutMs: 120000
    toolTimeoutMs: 135000
    visualQualityPolicy: true
```

`provider: auto` 在 Cloudflare account 已配置时优先使用 Cloudflare。如果 Cloudflare 不可用、未认证、被限流、quota 用尽或发生临时故障，PHOENIX 会自动回退到 AI Horde。

Cloudflare account id 会回退到 `CLOUDFLARE_ACCOUNT_ID`，token 每次调用都通过 credential seam 按引用解析。AI Horde 在存在 `AIHORDE_API_KEY` credential 时使用它，否则使用该服务公开记录的匿名 key。Secret 不会进入 Cordis config、tool arguments 或 session event。

Provider-neutral 的 step hint 保持在 1–8。Cloudflare 直接使用该值；AI Horde 会把它映射到更大的社区生成 step budget。工具把 `quality: fast` 映射为 4，把 `quality: high` 映射为 8；省略时使用部署默认值。

## 视觉质量策略

当 `visualQualityPolicy: true` 时，PHOENIX 会被明确告知：对于 artwork、hero/splash/background 图像、concept art 和产品视觉，应使用 `image_generate`，而不是用装饰性 CSS/SVG/emoji/ASCII 伪造替代品。Prompt refinement 会保留用户要求的主体和风格，同时加入构图、配色、光照/材质、完成度、无水印和避免意外文字的指导。

策略特别防止一种品牌误判：产品名称 **PHOENIX** 本身并不允许自动加入鸟、凤凰、火鸡、火焰 mascot 或 logo。

SVG 和 primitive 仍适用于真正的 vector、icon、logo、diagram、chart 和其他基于几何形状的资产。

## Model experience

成功的 `image_generate` 调用会返回简短 receipt，加上一个由本地持久化 attachment 支撑的 `image` content block。Web conversation surface 已经能识别 tool-result image block，并将其显示在折叠的 Tools group 之外。

当所有 provider 都失败时，工具会报告真实的 provider 错误。面向模型的策略明确禁止为了掩盖失败而用粗糙的本地 primitive 假装完成 artwork。

## Provider 行为

### Cloudflare Workers AI

Cloudflare adapter 使用配置的 account id，并在每次操作时通过 `ctx.credentials` 解析 token，再调用 Workers AI REST API。默认模型为 `@cf/black-forest-labs/flux-1-schnell`，返回 JPEG 字节。

### AI Horde

AI Horde adapter 是零配置回退。没有保存 key 时，它使用该服务公开的匿名 key，因此具有社区服务最低的队列优先级。它提交一个 1024×1024、默认安全的请求，轮询轻量 check endpoint，只读取一次最终结果，并要求返回 inline WebP 字节，而不是把会过期的远程 URL 写入 session。

用户也可以把注册后的 AI Horde key 保存为 `AIHORDE_API_KEY`，以获得服务面向注册用户的正常优先级。

## 已知限制与后续工作

- 外部 free allocation 与社区可用性由各 provider 控制；PHOENIX 无法保证永久 quota、queue time 或 uptime。
- 第一版每次调用生成一张 text-to-image 结果。参考图编辑、mask、variation、seed、明确的 aspect-ratio 控制以及用户可选 provider/model UI 留待后续。
- AI Horde 匿名生成在高负载时可能更慢；自动回退由 `hordeTimeoutMs` 限时。
- 将来可以在同一 seam 注册本地 provider，从而消除网络/API 依赖，而无需改变 consumer。
