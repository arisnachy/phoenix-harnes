# @phoenix-ai/dsh-tool-session-learning

English | [中文](README.zh.md)

Model-facing `memory_search` and `memory_remember` tools over PHOENIX's persistent cognitive ledger. Search returns bounded records with layers, stable IDs, project, entities, relations, source URI, temporal coordinates, and explainable confidence/ranking signals. The plugin contributes task- and project-scoped automatic evidence to Kira and direct subagents; prompt-variable delimiters inside untrusted text are neutralized before injection. Ordinary tool-driven turns and blocked tasks retain low-confidence diagnostic experience (duration, tokens, failed tool names) without counting as verified success. Only verified mission completion can promote a successful procedure or habit. Remember accepts lessons, skills, and preferences and redacts secrets before persistence.

## Composition

```yaml
- id: tool-session-learning
  name: '@phoenix-ai/dsh-tool-session-learning'
```

The tool requires `tools`, `systemPrompt`, and `learningMemory`. Search is read-only; remember cannot change prompts, permissions, tools, or credentials. Search supports project, layer, time-window, and superseded-history filters. Automatic context is bounded to eight project-scoped cognitive records and excludes raw conversation records. Similar tasks silently reuse verified procedures; incomplete attempts are diagnostic warnings only. No tool arguments, secrets, or form values are stored in the experience metrics.

## Model Experience

### Explicit memory recall and learning

#### What the model sees

`memory_search` returns bounded JSON with `id`, `session_id`, `event_seq`, `kind`, `layers`, `project_id`, `entities`, `relations`, `source_uri`, `confidence`, `importance`, `frequency`, an explainable `score`, and `reasons`. It never returns explicitly forgotten records.

##### Automatic continuity context

```markdown
Each model assembly receives up to eight active project-scoped cognitive records as untrusted read-only evidence. Raw conversation records remain excluded from automatic injection; use memory_search with a project or time filter when the task requires them.
```

##### Explicit learning record

```markdown
memory_remember stores one bounded preference, lesson, or skill from the current session. The ledger applies the same provenance, retention, and credential-redaction rules used for automatic observations.
```

#### Token effect

The tool adds tokens only when the model calls it; the configured result cap bounds the returned record count.

#### KV Cache effect

The result is a normal tool message appended after the current request and does not rewrite earlier conversation history.

## Known Limitations and Deferred Work

- Judge-filtered lessons, skill promotion, memory management commands, and a browser memory panel belong to later phases.
- Retrieval is a deterministic hybrid of normalized lexical, entity, relation, metadata, and recency signals; a vector provider can be added behind the same service without replacing the canonical ledger.
