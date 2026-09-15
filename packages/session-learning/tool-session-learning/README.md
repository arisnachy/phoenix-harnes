# @phoenix-ai/dsh-tool-session-learning

English | [中文](README.zh.md)

Model-facing memory tools and continuity policy over PHOENIX's persistent cognitive ledger. The plugin keeps ordinary automatic recall project-scoped, records bounded mission episodes from observable work, learns reusable procedures through the existing verified-outcome engine, and activates broader temporal recall only for explicit history, learning, diagnostic, backward-reference, or profile questions.

## Composition

```yaml
- id: tool-session-learning
  name: '@phoenix-ai/dsh-tool-session-learning'
```

The plugin requires `tools`, `systemPrompt`, and `learningMemory`. `memory_search` is read-only and supports project, explicit cross-project, layer, time-window, and superseded-history filters. `memory_remember` stores bounded preferences or verified lessons, while `memory_teach` stores structured user-taught procedures. None of these operations can change permissions, credentials, or trusted plugins.

## Model Experience

### Explicit and automatic continuity

#### What the model sees

Ordinary turns receive only bounded project-scoped evidence and validated procedures. A user question such as “what did we do yesterday?”, “what did you learn?”, or “continue the previous task” activates intent-aware retrieval with temporal and project scope appropriate to that request. Work-history recall prefers structured mission episodes and can use already-durable pre-episode user-task events as a compatibility fallback. The directed context contains task/outcome evidence needed for a natural answer but omits memory IDs, source URIs, event names, layer labels, confidence labels, storage paths, and raw tool arguments.

`memory_search` can still return bounded diagnostic JSON when the model explicitly needs technical provenance. Its `cross_project` flag must be requested deliberately; normal automatic recall remains isolated to the active project.

##### Durable mission episodes

A substantive user task begins a bounded in-flight trace. Public tool names may be retained, but raw tool arguments and raw tool results are excluded. Verified goal completion persists a high-confidence `mission` episode; an error can persist an unverified episode. The same verified completion events already consumed by procedural learning continue to reinforce reusable procedures, so episodic continuity does not create a second skill store.

#### Token effect

Ordinary continuity stays bounded. Directed history retrieval examines a bounded candidate set and presents at most twelve evidence items; explicit tool calls remain capped by `maxResults`.

#### KV Cache effect

Memory context is assembled into the dynamic request suffix and does not rewrite earlier conversation history.

## Known Limitations and Deferred Work

- The deterministic hybrid ranker does not claim embedding-level semantic equivalence; a future vector provider can enrich retrieval behind the same cognitive ledger.
- Browser memory inspection and user-facing memory management remain separate UI work.
