# @phoenix-ai/dsh-tool-session-learning

English | [中文](README.zh.md)

Model-facing `memory_search` and `memory_remember` tools over PHOENIX's persistent learning ledger. Search returns bounded records with stable memory IDs, source session and event coordinates, summaries, categories, and confidence so the model can recall prior work while seeing the evidence behind each memory. The plugin also contributes a small automatic context containing recent non-interaction evidence, while raw user interactions remain available only through explicit search. Remember accepts only lessons, skills, and preferences from the current session and redacts common credential assignments before persistence.

## Composition

```yaml
- id: tool-session-learning
  name: '@phoenix-ai/dsh-tool-session-learning'
```

The tool requires `tools`, `systemPrompt`, and `learningMemory`. Search is read-only; remember cannot change prompts, permissions, tools, or credentials. The automatic context is bounded to eight records, prioritizes high-confidence durable preferences, lessons, and skills, then adds recent non-interaction evidence, and excludes raw `interaction` records. The prompt guidance tells the model to treat memories as evidence rather than instructions and to resolve sensitive or contradictory records before relying on them.

## Model Experience

### Explicit memory recall and learning

#### What the model sees

`memory_search` returns a compact JSON string with `id`, `session_id`, `event_seq`, `kind`, `summary`, `source_event_type`, `confidence`, and `occurred_at`. It never returns storage-only timestamps or forgotten records.

##### Automatic continuity context

```markdown
Each model assembly receives up to eight active durable high-confidence lessons, skills, and preferences first, then recent successes and errors, as untrusted read-only evidence. Raw interaction records are deliberately excluded from automatic injection; use memory_search when the task requires them.
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

- The current tool searches deterministic event-derived observations. Judge-filtered lessons, skill promotion, memory management commands, and a browser memory panel belong to later phases.
- Search is bounded token matching, not semantic retrieval; an FTS5 or embedding index can be added behind the same service without changing the tool name.
