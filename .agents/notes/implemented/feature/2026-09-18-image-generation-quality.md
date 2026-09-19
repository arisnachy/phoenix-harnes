# Image generation quality capability

## Problem

PHOENIX could construct HTML/CSS/SVG artifacts but had no first-class raster image generation tool. When a task needed visual artwork, the model could improvise decorative vector shapes or mascot-like imagery. That was technically renderable but visually poor and semantically wrong for polished splash/hero/product surfaces.

## Decision

Add `@phoenix-ai/dsh-image-generation` as one single-purpose package containing all three capability-seam roles for the first provider:

1. `ctx.imageGeneration` is the provider registry and durable-publication Service Definition.
2. Cloudflare Workers AI and AI Horde are the first providers. `provider: auto` prefers configured Cloudflare and uses AI Horde as a zero-setup community fallback.
3. `image_generate` is the model-facing Consumer.

The service returns durable `ImageAttachmentRef` values by writing provider bytes through the existing attachment service. The Web client already promotes image blocks from completed tool calls into the generated-image surface, so no new client card or image transport is required.

## Visual behavior

The consumer owns a prompt-quality policy. It directs PHOENIX to use generated imagery for aesthetic artwork/product visuals and not substitute crude CSS/SVG/emoji/ASCII assets. It explicitly forbids inferring a bird/phoenix/turkey/flame mascot from the PHOENIX product name.

Vectors, icons, logos, diagrams, and charts keep their existing shape-based renderers.

## Provider choice

Cloudflare FLUX.1 schnell remains the preferred configured route because it has a documented text-to-image REST surface and a free Workers AI allocation. AI Horde is the zero-setup fallback: its official service documents the public anonymous key `0000000000`, with lowest queue priority and possible restriction under load. PHOENIX requests inline WebP results so expiring community URLs never become session truth. External free capacity remains provider-owned and is not a PHOENIX guarantee.

## Security and durability

- Cloudflare and optional registered AI Horde token values resolve through `ctx.credentials` on each generation.
- AI Horde falls back to its documented public anonymous key when no user credential is stored.
- Secrets never enter tool arguments/results or session events.
- Remote URLs are not persisted.
- Attachment admission validates and normalizes the image before the tool result becomes durable.
- Provider timeout and caller cancellation are fused.
- Provider/model selection is deployment config, not model-controlled input.

## Verification

Unit coverage pins visual prompt refinement and Cloudflare response validation. Repository typecheck/constraints/package checks and real bundle composition are required before promotion to stable.
