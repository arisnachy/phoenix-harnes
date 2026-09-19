# @phoenix-ai/dsh-image-generation

English | [中文](README.zh.md)

PHOENIX image generation capability. This single-purpose package currently contains all three seam roles:

- **Service Definition:** `ctx.imageGeneration` owns provider registration, selection, cancellation, and durable publication.
- **Service Provider:** a Cloudflare Workers AI adapter for `@cf/black-forest-labs/flux-1-schnell`.
- **Consumer:** the model-facing `image_generate` tool and its visual-quality prompt policy.

Keeping the three roles in one package makes the first implementation small while still exposing a provider registry. A later provider can be split into its own package without changing the tool or session image format.

## Why generated images become attachments

Providers return encoded bytes, never the durable result. `ctx.imageGeneration` writes those bytes through `ctx.attachments.saveImage()` and returns an `ImageAttachmentRef`. The existing conversation client already lifts image blocks from completed tool calls and renders them as first-class generated images, so provider URLs never become session truth.

## Configuration

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

`accountId` falls back to `CLOUDFLARE_ACCOUNT_ID`. The token is always resolved through the credential seam by reference, once per generation; no secret belongs in Cordis config or a session event.

The default model accepts up to 8 diffusion steps. The tool maps `quality: fast` to 4 and `quality: high` to 8; omission uses the configured default.

## Visual quality policy

With `visualQualityPolicy: true`, PHOENIX is told to use `image_generate` for artwork and product visuals instead of fabricating decorative CSS/SVG/emoji substitutes. Prompt refinement preserves the requested subject/style while adding composition, palette, lighting/material, polish, no-watermark, and no-accidental-text guidance.

The policy explicitly prevents a common branding failure: the product name **PHOENIX** alone is not permission to insert a bird, phoenix, turkey, flame mascot, or logo.

SVG and primitives remain correct for actual vectors, icons, logos, diagrams, charts, and shape-based assets.

## Model Experience

A successful `image_generate` call returns a short text receipt plus an `image` content block backed by a durable local attachment. The Web conversation surface already recognizes tool-result image blocks and displays them outside the collapsed Tools group.

If the provider is not configured, the tool fails explicitly. The model-facing policy tells PHOENIX not to fake the requested artwork with low-quality primitives as a fallback.

## Known Limitations and Deferred Work

- The bundled provider requires a Cloudflare account id and Workers AI token. The provider's free allocation is external policy and is not guaranteed by PHOENIX.
- Version one generates one text-to-image result per call. Reference-image editing, masks, variations, seeds, explicit aspect-ratio control, and multi-provider fallback are deferred.
- The bundled FLUX.1 schnell adapter records JPEG output because that is the provider's documented response for this model.
- A future local provider (for example a user-owned local diffusion runtime) can register on the same seam to remove network/API dependence without changing the consumer.
