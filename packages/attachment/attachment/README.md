# @phoenix-ai/dsh-attachment

English | [中文](README.zh.md)

The durable attachment seam. `ctx.attachments` validates and durably commits provider-independent images and arbitrary files, then returns serializable references; consumers never persist browser paths, object URLs, provider URLs, or base64 in session events.

Unsent composer images remain browser-owned temporary drafts. `validateImage` runs the complete admission policy without persisting. `saveImages` owns batch count and aggregate-byte limits, prepares every normalized attachment before publishing any member, then commits in order and returns references only after the complete batch succeeds. A later storage failure returns no partial references, although an earlier immutable content-addressed object may remain unreachable until reference-aware garbage collection exists. `AttachmentError.code` uses the closed `AttachmentErrorCode` string union. Its `ImageAdmissionErrorCode` subset marks caller-correctable image-input failures; `isImageAdmissionError` recognizes that subset at runtime so each protocol adapter can map its own error vocabulary. `saveImage` commits one accepted image before any model-visible session event is published and returns its `ImageAttachmentRef`. When normalization reduces the raster, the reference records the orientation-applied input size in `originalDimensions`. `readImage` verifies the normalized attachment against its logged metadata. `readImageRequest` deterministically derives a route-sized request version whose identity covers the attachment id, transform version, pixel and byte budgets, and encoder settings. Callers compose ordered batches with `Promise.all(refs.map(...))`; the local implementation still bounds compression through its instance limiter, cache, and singleflight. Callers may cancel reads and projections; implementations preserve cancellation instead of translating it into a storage failure.

`admitEncodedImages(attachments, images)` is the shared wire entry used by every RPC endpoint that accepts browser uploads (the session prompt endpoint and the command executor): it enforces canonical base64 on every member, then delegates batch admission — limits, validation, ordered commit — to `saveImages`. The base64 upload form is `EncodedImageAttachment`, exported from `@phoenix-ai/dsh-attachment/types` so wire contracts can reference it.

`admitEncodedFiles(attachments, files)` provides the same ordered, canonical-base64 admission path for CSV, PDF, source, HTML, and other arbitrary files. The local provider stores them content-addressed below the same durable attachment root, strips local path information from display names, and verifies the digest and byte length on every read. Provider adapters project bounded UTF-8 text files into text-model requests and describe binary files without inlining their bytes.

## Model Experience

Indirectly, through the role-neutral core `ImageBlock`/`FileBlock` vocabulary and provider adapters that resolve durable references into exact request input. Request descriptors expose the complete attachment id, verified byte length, MIME type, and (for images) actual request dimensions.

#### KV Cache effect

Adding an image changes the provider request and therefore invalidates the affected request suffix.

## Known Limitations and Deferred Work

- Version one accepts PNG, JPEG, WebP, and GIF only.
- Retention and garbage collection are deferred because resumed and forked sessions may share immutable objects.
- Audio, video, and persistent unsent drafts require separate lifecycle and provider contracts.
