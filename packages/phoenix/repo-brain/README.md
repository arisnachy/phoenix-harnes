# PHOENIX Repo Brain

`@deepseek-ai/dsh-phoenix-repo-brain` is PHOENIX's deterministic repository map. Its purpose is simple: stop spending model context rediscovering the same codebase structure every turn.

## What it knows

- indexed source/config/document paths;
- lightweight symbols such as functions, classes, interfaces, types, constants, Python definitions, and Markdown headings;
- relative JavaScript/TypeScript import edges;
- reverse dependencies for change-impact exploration;
- lexical/path/symbol relevance for targeted retrieval.

## What it deliberately does not do

The v13 index uses **no embeddings and no LLM calls**. It is not a compiler and does not pretend its regex-level symbol extraction is semantic truth. It provides a cheap structural first pass so expensive model reasoning starts with a much smaller candidate set.

## Incremental behavior

A refresh traverses repository metadata, but an unchanged file is reused when its size and modification time are unchanged. Changed files are reread up to `maxFileBytes`; deleted files are removed from the next atomic index view. VCS metadata, dependency/build outputs, caches, and symlinks are excluded.

## Model-facing tool

The PHOENIX bundle registers `repo_brain` with four actions:

- `search` — rank files and symbols relevant to a query;
- `impact` — walk reverse relative-import dependencies from one indexed file;
- `refresh` — refresh the incremental map;
- `stats` — report indexed files, symbols, and edges.

The system-prompt hint tells agents to use Repo Brain before broad repository grep/read sweeps when appropriate.

## Safety boundary

All traversal starts from one resolved repository root, symlinks are skipped, and `impact` rejects paths that escape that root. Repo Brain is read-only; it has no source mutation API.
