# PHOENIX Cognitive Memory v2 Implementation Plan

## Goal

Give PHOENIX durable episodic recall, intent-aware temporal retrieval, verified learning-by-doing, and human conversational continuity without replacing the existing cognitive ledger or procedural learner.

## Architecture rule

Keep `@phoenix-ai/dsh-session-learning` as the durable canonical cognitive store. Keep `RecentTaskLedger` as a fast same-runtime helper only. Add durable mission episodes and retrieval policy in the existing plugin/service extension points; do not modify `agent-loop`.

## Task 1 — Prove the missing behavior with failing tests

**Files**
- Modify `packages/session-learning/tool-session-learning/tests/restart-recall.spec.ts`
- Add `packages/session-learning/tool-session-learning/tests/episodic-recall.spec.ts`
- Add `packages/session-learning/tool-session-learning/tests/memory-intent.spec.ts`

**RED tests**
1. A substantive task followed by verified goal completion creates one durable `kind: mission` cognitive record with `episodic`, `autobiographical`, and `temporal` layers.
2. A fresh runtime using the same ledger can recover that mission after restart.
3. A Spanish query equivalent to “¿qué hicimos ayer?” resolves a bounded previous-day window and searches episodic mission records across projects.
4. “¿qué aprendiste?” routes to learning/procedural/semantic memory and does not select user-profile facts merely to prove recall.
5. Secret-bearing tool arguments/results are absent from the durable mission summary.
6. Directed recall remains bounded and does not inject an entire session transcript.

Expected first run: new tests fail because no mission recorder or memory-intent resolver exists.

## Task 2 — Add a durable episodic mission recorder

**Files**
- Add `packages/session-learning/tool-session-learning/src/episodic.ts`
- Modify `packages/session-learning/tool-session-learning/src/index.ts`
- Modify `packages/session-learning/tool-session-learning/src/task-reference.ts` only if a small read-only task snapshot API is needed.

**Behavior**
- Observe `user/message`, public tool names, relevant tool outcomes, goal changes, and turn completion.
- Keep raw arguments out of the trace.
- On verified `goal/change` completion, persist a bounded `kind: mission` record through `ctx.learningMemory.rememberCognitive()`.
- Record user intent, project, time, high-level tool names, outcome, verification state, and provenance in a versioned JSON value.
- Use a stable subject such as `phoenix.episode.mission.<id>`.
- Mark mission records with `autobiographical`, `episodic`, `temporal`, and associative/procedural layers when supported by evidence.
- Do not mark ordinary tool success as mission completion.
- On failure/cancel, retain an episode as evidence but never promote it as a verified reusable procedure.

## Task 3 — Make cross-project temporal recall explicit in the memory service

**Files**
- Modify `packages/session/session-learning/src/index.ts`
- Modify `packages/session/session-learning/tests/service.spec.ts`
- Modify `packages/session/session-learning/README.md`

**Behavior**
- Extend cognitive search/recall options with an explicit cross-project switch rather than relying on an omitted project id.
- Default behavior remains current-project scoped for automatic continuity.
- Directed autobiographical queries may request cross-project recall.
- Preserve time/layer filters and lifecycle rules.

**Tests**
- default search remains project scoped;
- explicit cross-project search sees relevant active records from multiple projects;
- time windows still filter correctly;
- superseded/forgotten rules are unchanged.

## Task 4 — Add intent-aware temporal retrieval

**Files**
- Add `packages/session-learning/tool-session-learning/src/memory-intent.ts`
- Add `packages/session-learning/tool-session-learning/src/episodic-presentation.ts`
- Modify `packages/session-learning/tool-session-learning/src/index.ts`

**Intent classes**
- `work-history`: “qué hicimos”, “ayer”, “último proyecto”, “la semana pasada”;
- `learning-history`: “qué aprendiste”, “qué aprendimos”, corrections/lessons/skills;
- `backward-task`: “como antes”, “el problema anterior”;
- `diagnostic-history`: “cómo arreglaste”, symptoms/errors;
- `profile-memory`: only when the user explicitly asks about themselves/preferences.

**Temporal behavior**
- Resolve today/yesterday/day-before-yesterday/last-week and equivalent Spanish/English phrases against a supplied `now` and timezone offset/configured runtime time source.
- Emit absolute inclusive `[from,to]` millisecond windows.
- No hard-coded Dominican timezone in product code.

**Retrieval behavior**
- `work-history` => cross-project, `mission`, episodic/temporal records, bounded results;
- `learning-history` => lesson/skill/adaptive/procedural/semantic records, excluding unrelated profile subjects;
- `backward-task` => same-runtime resolved task first, durable episodic fallback second;
- ordinary turns => existing light automatic high-confidence recall only.

## Task 5 — Keep the response human

**Files**
- Modify `packages/session-learning/tool-session-learning/src/presentation.ts`
- Add/modify tests in `packages/session-learning/tool-session-learning/tests/presentation.spec.ts` or nearest existing presentation test
- Modify `packages/session-learning/tool-session-learning/README.md`

**Rules**
- Render selected memory as evidence, not system narration.
- Never prepend phrases such as “I consulted the memory ledger” in ordinary replies.
- Do not expose ids, internal event names, storage paths, source URIs, confidence labels, or memory-layer names unless technically requested.
- Work-history context should naturally support responses such as “Ayer trabajamos en…” when evidence exists.
- If evidence is partial, expose that uncertainty naturally instead of inventing continuity.
- “¿qué aprendiste?” must not answer with a dump of personal/profile data.

## Task 6 — Connect episodic outcomes to existing procedural learning

**Files**
- Modify `packages/session-learning/tool-session-learning/src/procedural.ts` only where needed
- Add/modify `packages/session-learning/tool-session-learning/tests/procedural.spec.ts` and restart coverage

**Behavior**
- Reuse `ProceduralLearningEngine`; do not add a second skill store.
- Verified mission episodes may reinforce an existing procedure or produce a candidate/active experience-derived procedure under the existing promotion rules.
- Failed/corrected experiences increment negative evidence or quarantine rather than silently replacing a good procedure.
- Procedures remain task-relevance gated and project-aware.

## Task 7 — Documentation, decision record, and model-visible regression

**Files**
- Add `.agents/notes/implemented/architecture/2026-09-15-cognitive-memory-v2.md`
- Update `packages/session/session-learning/README.md`
- Update `packages/session-learning/tool-session-learning/README.md`
- Add/update the nearest keyless runnable snapshot fixture/example required by the repository testing policy.

**Snapshot acceptance**
A two-session/restart scenario must show that a new conversation can answer a work-history question from durable mission evidence without leaking internal memory plumbing or personal profile data.

## Task 8 — Verification and integration

Run the narrowest applicable checks first:

```sh
pnpm exec vitest run packages/session/session-learning/tests/service.spec.ts packages/session/session-learning/tests/cognitive.spec.ts
pnpm exec vitest run packages/session-learning/tool-session-learning/tests/restart-recall.spec.ts packages/session-learning/tool-session-learning/tests/episodic-recall.spec.ts packages/session-learning/tool-session-learning/tests/memory-intent.spec.ts
pnpm exec tsc -p packages/session/session-learning/tsconfig.json --noEmit
pnpm exec tsc -p packages/session-learning/tool-session-learning/tsconfig.json --noEmit
pnpm run lint
```

Then run the affected keyless snapshot command documented by the existing fixture/example. Do not merge until focused tests, affected typechecks, lint, docs gates for changed docs, and snapshot behavior pass.

After verification:
1. open a PR from `feat/cognitive-memory-v2-20260915` to `main`;
2. review the diff and CI;
3. merge to `main` only after passing checks;
4. fast-forward `stable` to the verified `main` SHA when `stable` has not independently diverged; otherwise reconcile rather than force;
5. verify `main` and `stable` resolve to the intended release commit.
