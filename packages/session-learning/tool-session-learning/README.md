# @phoenix-ai/dsh-tool-session-learning

English | [中文](README.zh.md)

Model-facing memory tools and continuity policy over PHOENIX's persistent cognitive ledger. The plugin keeps ordinary automatic recall project-scoped, records bounded mission episodes from observable work, learns reusable procedures through the existing verified-outcome engine, and activates broader temporal recall only for explicit history, learning, diagnostic, backward-reference, or profile questions.

## Composition

```yaml
- id: tool-session-learning
  name: '@phoenix-ai/dsh-tool-session-learning'
```

The plugin requires `tools`, `systemPrompt`, and `learningMemory`. `memory_search` is read-only and supports project, layer, time-window, and superseded-history filters. `memory_remember` stores bounded preferences or verified lessons, while `memory_teach` stores structured user-taught procedures. None of these operations can change permissions, credentials, or trusted plugins. Cross-project autobiographical recall is reserved for the intent-aware runtime path used when the user explicitly asks about prior work or learning.

## Model Experience

### Explicit and automatic continuity

#### What the model sees

Ordinary turns receive only bounded project-scoped evidence and validated procedures. Directed history context contains only the task and outcome evidence needed for a natural answer; it omits memory IDs, source URIs, event names, layer labels, confidence labels, storage paths, and raw tool arguments.

##### Directed temporal continuity

```markdown
Questions such as “what did we do yesterday?”, “what did you learn?”, or “continue the previous task” activate intent-aware retrieval with the appropriate temporal window. Explicit autobiographical/history questions may recall evidence across projects, while ordinary automatic recall and memory_search remain project-scoped unless a concrete project is requested.
```

##### Durable mission episodes

```markdown
A substantive user task starts a bounded in-flight trace. Public tool names may be retained, but raw tool arguments and raw tool results are excluded. Verified goal completion persists a high-confidence mission episode; an error can persist an unverified episode. Work-history recall prefers these structured episodes and can fall back to already-durable pre-v2 user-task events when needed.
```

#### Token effect

Ordinary continuity stays bounded. Directed history retrieval examines a bounded candidate set and presents at most twelve evidence items; explicit tool calls remain capped by `maxResults`.

#### KV Cache effect

Memory context is assembled into the dynamic request suffix and does not rewrite earlier conversation history.

## Known Limitations and Deferred Work

- The deterministic hybrid ranker does not claim embedding-level semantic equivalence; a future vector provider can enrich retrieval behind the same cognitive ledger.
- Browser memory inspection and user-facing memory management remain separate UI work.
