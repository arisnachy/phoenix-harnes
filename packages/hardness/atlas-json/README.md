# `@deepseek-ai/dsh-hardness-atlas-json`

English | [中文](README.zh.md)

Host-side atomic JSON persistence provider for the HARDNESS Tool Atlas snapshot.

It validates `formatVersion`, preserves the last valid file across interrupted writes, and distinguishes corruption from an empty inventory. It stores no credentials and grants no permissions.

## Model Experience

### Durable Atlas snapshot

#### What the model sees

The persistence layer is not model-facing directly; consumers may expose stable snapshot metadata such as `formatVersion`, capability descriptors, and verification evidence without exposing the backing file or secrets.

#### Token effect

Persisting or loading the Atlas adds no model tokens by itself; tokens are added only when another consumer renders selected snapshot data into model context.

#### KV Cache effect

Persistence is cache-neutral; only changes to rendered capability or evidence data can invalidate model-side cache reuse.

## Known Limitations and Deferred Work

- Automatic composition with the `HardnessRegistry` lifecycle remains separate from this storage primitive.
