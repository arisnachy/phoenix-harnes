# PHOENIX Repo Brain

`@deepseek-ai/dsh-phoenix-repo-brain` is PHOENIX's deterministic repository map. Its purpose is to stop spending model context rediscovering the same codebase structure every turn.

## What it knows

- indexed source/config/document paths;
- lightweight symbols such as functions, classes, interfaces, types, constants, Python definitions, and Markdown headings;
- relative JavaScript/TypeScript import edges;
- reverse dependencies for change-impact exploration;
- lexical/path/symbol relevance for targeted retrieval.

## What it deliberately does not do

The v13 index uses **no embeddings and no LLM calls**. It is not a compiler and does not pretend its regex-level symbol extraction is semantic truth. It provides a cheap structural first pass so expensive model reasoning starts with a much smaller candidate set.

## Incremental behavior

A refresh traverses repository metadata, but an unchanged file is reused when its size and modification time are unchanged. Changed files are read only up to `maxFileBytes`; deleted files are removed from the next committed index view. VCS metadata, dependency/build outputs, caches, and discovered symlinks are excluded.

## Model-facing tool

The PHOENIX bundle registers `repo_brain` with four actions:

- `search` — rank files and symbols relevant to a query;
- `impact` — walk reverse relative-import dependencies from one indexed file;
- `refresh` — refresh the incremental map;
- `stats` — report indexed files, symbols, and edges.

Repo Brain is read-only; it has no source mutation operation. It constrains repository-relative paths, but it is not an OS sandbox. Strong process/filesystem confinement remains the responsibility of the DSH sandbox capability.

## Model Experience

### Repository guidance

#### What the model sees

When the plugin is mounted, the system prompt includes this stable guidance:

##### Repo Brain guidance

```markdown
Use repo_brain before broad repository grep/read sweeps when locating architecture, symbols, or reverse dependency impact. It is a deterministic local index and uses no model calls.
```

#### Token effect

A fixed, small prompt cost is present while the plugin is mounted. Building, refreshing, searching, and calculating impact use no additional model calls.

#### KV Cache effect

The guidance is prefix-stable while the plugin composition and literal remain unchanged. Index refreshes do not alter this prompt prefix.

### `repo_brain` tool

#### What the model sees

The model receives the `repo_brain` tool schema while the package is mounted and receives textual results only for calls it makes. The schema exposes `search`, `impact`, `refresh`, and `stats`; results contain repository-relative paths, bounded hit counts, lightweight symbol names, or index statistics.

#### Token effect

The tool schema adds fixed request context. A tool call adds data-dependent result tokens; `search` and `impact` cap returned items at 50, while source indexing itself consumes no model tokens.

#### KV Cache effect

The tool schema is stable across index refreshes. Tool-call results append new conversation content after the reusable request prefix rather than rewriting earlier prompt content.

## Known Limitations and Deferred Work

- **Structural rather than compiler-semantic** — symbol extraction is intentionally lightweight and may miss language-specific constructs; compiler/LSP-backed enrichment is deferred.
- **Import graph scope** — v13 resolves relative JavaScript/TypeScript-family imports, including emitted `.js` specifiers that map back to TypeScript sources. Workspace aliases, package exports, Python imports, and other language dependency graphs are deferred.
- **Process-local index** — the index is rebuilt after process restart; durable index persistence is deferred until a stable cache invalidation contract exists.
- **Change fingerprint** — incremental reuse currently keys on file size and modification time, so filesystems with unusually coarse timestamps can theoretically miss an equal-size rewrite until another metadata change.
- **Result byte ceiling** — complete model-facing tool text is capped at 16 KiB with UTF-8-safe truncation. This protects context growth, but unusually large result sets can end with `[truncated]`.
