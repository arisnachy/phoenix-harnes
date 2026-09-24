# Image generation

English | [中文](image-generation.zh.md)

PHOENIX exposes original image creation through the provider-neutral `ctx.imageGeneration` seam and the `image_generate` tool.

The first implementation lives in `@phoenix-ai/dsh-image-generation`. It combines the Service Definition, two bundled Service Providers, and the model-facing Consumer in one package while keeping provider registration public.

## Data flow

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

Generated images never use a provider URL as session truth. The attachment store validates, normalizes, content-addresses, and persists bytes before the tool result becomes durable.

## Visual-quality rule

The consumer owns aesthetic guidance because it owns the user's/model's intent. Providers only execute a resolved prompt.

For original artwork and product visuals, PHOENIX prefers `image_generate` over decorative CSS shapes, emoji, ASCII art, or crude SVG stand-ins. SVG remains correct for vectors, icons, logos, diagrams, charts, and other intentionally geometric output.

The product name does not imply a mascot. Prompts must not add a phoenix, bird, turkey, flames, or a logo merely because the interface is named PHOENIX.

## Provider selection

`provider: auto` prefers Cloudflare when its account configuration is present. Recoverable Cloudflare failures—authentication, quota, rate limit, timeout, or transient transport/service failure—fall through to AI Horde.

Cloudflare uses `@cf/black-forest-labs/flux-1-schnell`. Its token is resolved per operation through `ctx.credentials`.

AI Horde is always available as the zero-setup community fallback. It resolves an optional `AIHORDE_API_KEY`; when none is stored it uses the service's documented anonymous key. The adapter asks for inline WebP output so an expiring provider URL never becomes part of the durable session.

Explicit provider selection is fail-closed: choosing `cloudflare` or `aihorde` disables automatic fallback.

## Failure semantics

Provider selection, missing credentials, authentication errors, quota/rate limits, queue timeout, malformed provider responses, and remote failures use stable `IMAGE_GENERATION_*` codes. In auto mode only explicitly recoverable provider failures advance to the next provider.

When all generation paths fail, the model reports that failure instead of fabricating low-quality visual artwork locally.
