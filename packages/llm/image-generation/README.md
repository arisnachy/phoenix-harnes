# @phoenix-ai/dsh-image-generation

English | [中文](README.zh.md)

PHOENIX image generation capability. This single-purpose package contains the provider-neutral runtime, bundled remote providers, and the model-facing `image_generate` consumer.

- **Service Definition:** `ctx.imageGeneration` owns provider registration, automatic selection/fallback, cancellation, and durable publication.
- **Service Providers:** configured Cloudflare Workers AI / FLUX.1 schnell is preferred; AI Horde provides a zero-setup anonymous community fallback.
- **Consumer:** `image_generate` plus the visual-quality prompt policy.

Provider registration remains public, so a later local diffusion runtime can be added without changing the tool contract or session image format.

## Why generated images become attachments

Providers return encoded bytes, never the durable result. `ctx.imageGeneration` writes those bytes through `ctx.attachments.saveImage()` and returns an `ImageAttachmentRef`. The existing conversation client already lifts image blocks from completed tool calls and renders them as first-class generated images, so provider URLs never become session truth.

## Configuration

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

`provider: auto` prefers Cloudflare when its account is configured. If Cloudflare is unavailable, unauthenticated, rate-limited, out of quota, or transiently fails, PHOENIX falls back to AI Horde.

Cloudflare's account id falls back to `CLOUDFLARE_ACCOUNT_ID`; its token is resolved by reference through the credential seam. AI Horde uses the optional `AIHORDE_API_KEY` credential when present and otherwise uses the service's documented anonymous key. No secret belongs in Cordis config, tool arguments, or a session event.

The provider-neutral step hint stays in the 1–8 range. Cloudflare uses it directly; AI Horde maps it to a larger community-generation step budget. The tool maps `quality: fast` to 4 and `quality: high` to 8; omission uses the configured default.

## Visual quality policy

With `visualQualityPolicy: true`, PHOENIX is told to use `image_generate` for artwork, hero/splash/background images, concept art, and product visuals instead of fabricating decorative CSS/SVG/emoji/ASCII substitutes. Prompt refinement preserves the requested subject/style while adding composition, palette, lighting/material, polish, no-watermark, and no-accidental-text guidance.

The policy explicitly prevents a branding failure: the product name **PHOENIX** alone is not permission to insert a bird, phoenix, turkey, flame mascot, or logo.

SVG and primitives remain correct for actual vectors, icons, logos, diagrams, charts, and shape-based assets.

## Model experience

A successful `image_generate` call returns a short receipt plus an `image` content block backed by a durable local attachment. The Web conversation surface already recognizes tool-result image blocks and displays them outside the collapsed Tools group.

When all providers fail, the tool reports the real provider failure. The model-facing policy explicitly forbids replacing the requested artwork with a crude local primitive merely to avoid reporting that failure.

## Provider behavior

### Cloudflare Workers AI

The Cloudflare adapter calls Workers AI's REST API with the configured account id and a token resolved per operation through `ctx.credentials`. The shipped model is `@cf/black-forest-labs/flux-1-schnell` and returns JPEG bytes.

### AI Horde

The AI Horde adapter is the zero-setup fallback. With no stored key it uses the documented anonymous key and therefore has the community service's lowest queue priority. It submits one 1024×1024 safe-by-default request, polls the lightweight check endpoint, retrieves the final result once, and requests inline WebP bytes rather than persisting an expiring remote URL.

An optional registered AI Horde key can be stored under `AIHORDE_API_KEY` to receive the service's normal registered-user priority.

## Known limitations and deferred work

- External free allocations and community availability are controlled by their providers; PHOENIX cannot guarantee permanent quotas, queue times, or uptime.
- Version one generates one text-to-image result per call. Reference-image editing, masks, variations, seeds, explicit aspect-ratio control, and user-selectable provider/model UI are deferred.
- Anonymous AI Horde generation can be slower under load; automatic fallback is bounded by `hordeTimeoutMs`.
- A future local provider can register on the same seam to remove network/API dependence without changing the consumer.
