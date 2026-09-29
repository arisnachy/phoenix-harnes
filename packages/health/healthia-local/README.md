# `@phoenix-ai/dsh-healthia-local`

Encrypted owner-local provider for `ctx.healthia`.

The provider keeps HealthIA data outside PHOENIX conversation/session memory.
The canonical document is encrypted with AES-256-GCM before it is written. The
encryption secret is resolved through `ctx.credentials`; when the configured
reference is absent and writable, the provider creates a random 256-bit secret
there instead of embedding a key beside the health record.

Writes use the repository's cross-process writer lock and atomic replacement,
with owner-private file/directory modes on platforms where POSIX modes apply.
Every mutation re-reads the committed document under the lock, preventing one
PHOENIX process from silently overwriting another process's just-committed
patient change.

Default key reference: `PHOENIX_HEALTHIA_DATA_KEY`.

## Model Experience

None, as `@phoenix-ai/dsh-healthia-local` is a storage provider and contributes
no model-visible prompt or tool surface.

#### KV Cache effect

None. Reading or writing the encrypted record does not by itself alter a model
request; a HealthIA consumer decides which bounded data enters context.

## Known Limitations and Deferred Work

- **Single encrypted local document** — suitable for the first owner-local
  foundation. Large imaging/document bytes should use a separate encrypted
  attachment/evidence store rather than expanding this JSON envelope.
- **No OS keystore binding yet** — the encryption secret is protected by the
  existing PHOENIX credential seam. A platform-keystore provider can later
  strengthen at-rest key protection without changing `ctx.healthia`.
- **No sync/clinical interoperability provider yet** — FHIR, Health Connect,
  hospital, laboratory, and cloud providers should map into the same
  provider-neutral service rather than bypassing it.
