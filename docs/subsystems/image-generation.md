# Image generation

PHOENIX exposes original image creation through the provider-neutral `ctx.imageGeneration` seam and the `image_generate` tool.

The first implementation lives in `@phoenix-ai/dsh-image-generation`. It intentionally combines the Service Definition, the Cloudflare Workers AI provider, and the model-facing consumer while there is only one shipped provider. Provider registration remains public so future Cloudflare alternatives or local runtimes do not change the tool contract.

## Data flow

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

Generated images never use a provider URL as session truth. The attachment store validates, normalizes, content-addresses, and persists the bytes before the tool result is appended.

## Visual-quality rule

The consumer owns aesthetic guidance because it owns the user's/model's intent. Providers only execute a resolved prompt.

For original artwork and product visuals, PHOENIX prefers `image_generate` over decorative CSS shapes, emoji, ASCII art, or crude SVG stand-ins. SVG remains correct for vectors, icons, logos, diagrams, charts, and other intentionally geometric output.

The product name does not imply a mascot. Prompts must not add a phoenix, bird, turkey, flames, or a logo merely because the interface is named PHOENIX.

## Cloudflare provider

The bundled provider calls Workers AI's REST API with the configured account id and a token resolved per operation through `ctx.credentials`. The token value never enters Cordis config, tool arguments, result metadata, or the durable session log.

The shipped model is `@cf/black-forest-labs/flux-1-schnell`. Provider/model choice remains configuration, not a tool argument, so the model cannot redirect execution to an unreviewed backend.

## Failure semantics

Missing account configuration, missing credentials, authentication errors, quota/rate limits, timeouts, malformed provider responses, and remote failures use stable `IMAGE_GENERATION_*` codes.

When generation is unavailable, the model should report the missing provider connection rather than fabricate low-quality visual artwork locally.
