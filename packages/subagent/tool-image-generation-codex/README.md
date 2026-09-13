# @phoenix-ai/dsh-tool-image-generation-codex

Phoenix model-facing image generation backed by the official Codex subagent provider.

The plugin registers `image_generation` only while its configured subagent provider (default: `codex`) is available. One call creates a Phoenix-owned directory under the initiating Agent workspace, asks Codex to use its built-in image-generation capability, accepts exactly one raster plus a bounded JSON manifest, disposes the Codex run, validates the filesystem result, and commits the bytes through `ctx.attachments.saveImage()`.

## Security and lifecycle

The generated path must remain inside `.phoenix/generated-images/<call>/`. The manifest may name only one basename and its declared media type must agree with the extension. Path traversal, symbolic links, non-regular files, unexpected files, multiple rasters, unsupported media types, oversized output, abnormal Codex termination, attachment rejection, and missing Agent/workspace context all fail closed. A failed call publishes no attachment and removes its call-owned output directory.

`ctx.attachments.saveImage()` is the publication boundary. The tool never exposes a host-absolute path or an arbitrary external URL to the model. Successful calls keep the workspace artifact and return the durable normalized `ImageAttachmentRef` used by Phoenix replay/history rendering.

## Model experience

The default model-facing tool name is `image_generation`. Input is a single detailed `prompt`. Success renders the generated image as a normal Phoenix image content block plus a concise workspace-relative path, so the caller can reuse the visual in a web page, presentation, report, or other artifact.

The shipped standard KIRA preset uses this tool when an original visual materially improves the requested deliverable. The tool does not silently fall back to another image provider or to an API-key route.

## Known limitations

Version one is text-to-image and publishes exactly one raster per call. Image editing, masks, multiple outputs, arbitrary file generation, and provider fallback are intentionally outside this package. Availability also depends on the installed Codex runtime exposing its built-in image-generation capability for the authenticated user/session.
