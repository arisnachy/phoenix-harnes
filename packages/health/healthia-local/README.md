# `@phoenix-ai/dsh-healthia-local`

[English](README.md) | [中文](README.zh.md)

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

### Encrypted local provider

#### What the model sees

The provider registers `ctx.healthia` but renders no prompt or patient data;
model-facing HealthIA consumers own every model-visible projection.

#### Token effect

Storage, encryption, locking, and credential resolution add no model tokens by
themselves.

#### KV Cache effect

The provider is cache-neutral. Reading or writing the encrypted record changes
a model prefix only if a consumer later projects those bounded records.

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
