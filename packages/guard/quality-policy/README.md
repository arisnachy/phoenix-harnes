# @phoenix-ai/dsh-quality-policy

English | [中文](README.zh.md)

A low-latency completion-quality guard. It does not call a model, scan the filesystem, or run tests by itself. Instead it observes work PHOENIX is already doing, invalidates verification evidence when a successful mutation occurs, accepts only evidence observed after that mutation, and uses the existing tool-result and turn-stop flow to keep the model from mistaking stale evidence for completion.

The compliant path adds no model round: the first successful mutation appends a short, source-attributed context to the next step that already has to consume the tool result. If the model verifies before stopping, the guard is silent. Only a turn that tries to close while still dirty can receive a bounded corrective steer.

## Config

~~~yaml
- id: quality-policy
  name: '@phoenix-ai/dsh-quality-policy'
  config:
    maxStopNudges: 1
~~~

maxStopNudges is a latency budget, not a quality score. Zero disables stop correction; valid values are 0 through 3. A direct human prompt starts a fresh task-local ledger. Each successful mutation increments an internal generation. Successful verification marks only the current generation as fresh; a later mutation invalidates it immediately. This prevents needless reruns while refusing to reuse evidence after the artifact changed.

## Activity classification

The guard classifies calls locally from tool name and JSON arguments. Native file mutation tools such as write, edit, str_replace_editor and common create/update/delete/move/upload/deploy names count as mutations. Shell, PowerShell and Code calls are classified with bounded command-pattern checks: common test/build/lint/typecheck commands count as verification, while common filesystem, package-management and git mutation commands count as mutations. Read/search/fetch/screenshot calls count as inspection.

The artifact domain is inferred from touched paths: code, web, docs, data, config, or generic. Code, web, and config require automated evidence; docs, data, and generic work may be satisfied by inspection. The policy deliberately stays conservative and cheap: it does not parse source trees or launch an evaluator merely to classify work.

## Evidence and latency behavior

- Evidence freshness, not repetition. A verification stays valid until a later successful mutation. Re-reading or rerunning the same unchanged state is not required by the policy.
- Cheap first. The reminder directs the model toward deterministic checks before an LLM judge and toward one focused high-signal command rather than exhaustive redundant suites.
- Parallel where possible. Independent checks should be batched into one command or run concurrently.
- Real boundary. Domain hints prefer the actual build/start/render/read-back surface instead of internal helper-only tests.
- Bounded correction. A missed verification receives at most maxStopNudges correction steps for one direct human task; the default is one. A new direct user prompt resets that budget.
- No side-effect fiction. A successful mutation remains dirty even if a later post-execute policy blocks its presentation, because tool side effects are not rolled back.
- Concurrency-safe freshness. Parallel calls settle in observed order: verification that finishes before a mutation cannot validate that later mutation; verification that finishes after it can.

## Model Experience

### Post-mutation context

#### What the model sees

The first successful mutation that makes previously fresh evidence stale appends the source-attributed notice below to the next request that already follows that tool result. A second mutation while evidence is already stale adds no duplicate notice.

##### Freshness notice

```markdown
Fresh verification evidence is now stale because the artifact changed. <domain-specific hint> Reuse still-fresh evidence for unchanged inputs, choose cheap deterministic checks before a model judge, and batch independent checks in one command or run them in parallel when possible.
```

#### Token effect

Zero tokens before a mutation. One bounded notice is appended only on a fresh-to-dirty transition and is retained in that session history; repeated mutations while dirty add no extra notice.

#### KV Cache effect

Append-only after the already-cached request prefix. It does not change the stable system prompt or tool schemas, so prior prefix cache entries remain reusable.

### Turn-stop correction

#### What the model sees

If a turn attempts to stop while successful mutations are newer than accepted evidence, PHOENIX may steer the bounded notice below. The default budget is one stop correction per direct human task; fresh verification suppresses it completely.

##### Stop notice

```markdown
This task has successful mutations after its latest accepted verification. Before presenting it as complete, <domain-specific hint> Prefer the existing production/user entrypoint and the smallest high-signal check; do not rerun evidence that is still fresh. If no meaningful automated check exists, inspect the final artifact and state the verification limit.
```

#### Token effect

Zero tokens on the compliant path. A premature dirty stop pays at most the configured maxStopNudges notices; the shipped base config is one.

#### KV Cache effect

The correction is appended as new next-step context after the reusable prefix. It does not rewrite earlier prompt or tool-schema tokens.

## Known Limitations and Deferred Work

- Classification is intentionally heuristic and local. Transport/provider namespaces such as `mcp__GitHub__update_file`, `github.update_file`, and `shell:bash` are normalized before classification, but a novel mutating operation whose operation name and arguments match none of the current patterns may still require adapter-declared quality metadata.
- Freshness is generation-based, not content-hash-based. It is conservative and O(1); content-addressed evidence is deferred until the filesystem/tool metadata seam can expose authoritative changed-input hashes without extra I/O.
- The policy tracks one direct-human task per agent, not a cross-session global failure-learning database. Durable tool/session history still preserves failures for the model; a compact cross-task failure index belongs in the learning subsystem rather than this guard.
- Visual quality still needs the browser/rendering capability to produce evidence; this guard only decides whether observed evidence is fresh enough to finish.
