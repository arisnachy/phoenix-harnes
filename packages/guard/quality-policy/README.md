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

After the first mutation that makes previously fresh evidence stale, the model receives a short notice saying that evidence is stale, selecting a domain-specific high-signal check, asking it to reuse still-fresh evidence, prefer cheap deterministic checks before a judge, and batch independent checks.

No new request is created for this notice; it rides the existing tool result additionalContexts.

### Turn-stop correction

If the turn tries to close while mutations remain newer than accepted evidence, the agent receives one bounded steer by default asking for the smallest meaningful proof at the real consumer boundary. If no automated proof exists, it may inspect the final artifact and report the verification limit rather than looping.

## Known Limitations and Deferred Work

- Classification is intentionally heuristic and local. A novel mutating MCP tool whose name and arguments match none of the current patterns may not invalidate evidence until its adapter declares quality metadata.
- Freshness is generation-based, not content-hash-based. It is conservative and O(1); content-addressed evidence is deferred until the filesystem/tool metadata seam can expose authoritative changed-input hashes without extra I/O.
- The policy tracks one direct-human task per agent, not a cross-session global failure-learning database. Durable tool/session history still preserves failures for the model; a compact cross-task failure index belongs in the learning subsystem rather than this guard.
- Visual quality still needs the browser/rendering capability to produce evidence; this guard only decides whether observed evidence is fresh enough to finish.
