# `@deepseek-ai/dsh-hardness-adapters`

English | [中文](README.zh.md)

Projects metadata from existing PHOENIX tools and skills into the HARDNESS Tool Atlas.

The adapters do not execute tools, load skill bodies, or grant permissions; each source registry retains authority.

## Model Experience

### Projected capability metadata

#### What the model sees

Consumers may expose stable capability identifiers such as `tool:<name>`, `skill:<name>`, and `openclaw:<id>` together with compatibility and verification state; execution remains behind PHOENIX approval and canonical registries.

#### Token effect

Only capability metadata selected for a mission contributes model tokens; indexing source registries does not add prompt text on its own.

#### KV Cache effect

The projected catalog is cache-friendly while source schemas, extension metadata, and verification state remain unchanged.

## Known Limitations and Deferred Work

- External extension execution remains governed by the Capability Broker and isolated package-host contract rather than being activated eagerly at startup.
