# Image generation quality capability

## Problem

PHOENIX could construct HTML/CSS/SVG artifacts but had no first-class raster image generation tool. When a task needed visual artwork, the model could improvise decorative vector shapes or mascot-like imagery. That was technically renderable but visually poor and semantically wrong for polished splash/hero/product surfaces.

## Decision

Add `@phoenix-ai/dsh-image-generation` as one single-purpose package containing all three capability-seam roles for the first provider:

1. `ctx.imageGeneration` is the provider registry and durable-publication Service Definition.
2. Cloudflare Workers AI is the first provider.
3. `image_generate` is the model-facing Consumer.

The service returns durable `ImageAttachmentRef` values by writing provider bytes through the existing attachment service. The Web client already promotes image blocks from completed tool calls into the generated-image surface, so no new client card or image transport is required.

## Visual behavior

The consumer owns a prompt-quality policy. It directs PHOENIX to use generated imagery for aesthetic artwork/product visuals and not substitute crude CSS/SVG/emoji/ASCII assets. It explicitly forbids inferring a bird/phoenix/turkey/flame mascot from the PHOENIX product name.

Vectors, icons, logos, diagrams, and charts keep their existing shape-based renderers.

## Provider choice

Cloudflare FLUX.1 schnell was selected for the initial provider because it has a documented text-to-image REST surface, returns base64 image bytes, and can operate inside Cloudflare's free Workers AI allocation. Provider account/token setup remains user-owned; PHOENIX does not promise that an external free tier is permanent.

## Security and durability

- API token values resolve through `ctx.credentials` on each generation.
- Secrets never enter tool arguments/results or session events.
- Remote URLs are not persisted.
- Attachment admission validates and normalizes the image before the tool result becomes durable.
- Provider timeout and caller cancellation are fused.
- Provider/model selection is deployment config, not model-controlled input.

## Verification

Unit coverage pins visual prompt refinement and Cloudflare response validation. Repository typecheck/constraints/package checks and real bundle composition are required before promotion to stable.
