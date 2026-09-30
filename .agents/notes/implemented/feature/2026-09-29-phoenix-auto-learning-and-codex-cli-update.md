# Agent Note: Phoenix Auto value learning and Codex CLI freshness

Status: implemented

English | [中文](2026-09-29-phoenix-auto-learning-and-codex-cli-update.zh.md)

## Problem

Phoenix Auto can choose Sol 6.1 for planning/rescue and Luna Max for execution, but a fixed delegation policy cannot know whether serial execution, one Luna worker, or two Luna workers is best for a repeated kind of task. Optimizing only for speed can waste tokens or reduce quality; optimizing only for token use can make the user wait longer.

The local Codex CLI is also an independent moving dependency. PHOENIX stable updates and Codex plugin updates do not guarantee that the installed Codex executable itself is current, so new account-visible models or app-server fixes can be delayed by an old CLI.

## Decision

Phoenix Auto learns execution strategy only from verified completed tasks. Existing session-learning telemetry records end-to-end wall time, model tokens, tool calls, tool failures, retries, and human interventions. Phoenix additionally records secret-free routing facts: whether the verified run used the Sol 6.1 planner plus GPT-6 Luna, how many Sol/Luna route phases occurred, how many rescue phases occurred, and whether zero, one, or two workflow workers were started.

The retained execution strategies are:

- `serial`: Luna Max root only;
- `parallel-1`: Luna Max root plus one bounded Luna Max worker;
- `parallel-2`: Luna Max root plus up to two bounded Luna Max workers.

No strategy is promoted from one successful example. At least two verified runs per strategy and at least two comparable strategies are required. Phoenix reuses the existing Pareto optimizer and promotes a routing preference only when exactly one verified strategy dominates the alternatives without lowering the quality floor. A time-versus-token tradeoff with no unique winner stays unresolved rather than inventing an arbitrary weighted score. Learned guidance remains conditional on the current task still having the independent branches that justified parallelism.

PHOENIX also runs a separate Codex stable-update watcher. It resolves the stable `@openai/codex` package version and maintains a Phoenix-owned runtime under `$DSH_HOME/codex-runtime`. New app-server/account processes and live model discovery prefer that verified managed runtime; the published package-local Codex dependency and the ambient PATH command remain fail-safe fallbacks. If the active global `codex` command is unambiguously owned by npm or pnpm, the watcher updates that installation too; ambiguous or unsupported global installations are left untouched while Phoenix can still advance through its managed runtime. The watcher never downgrades an ahead/prerelease installation, never follows prerelease versions as the stable target, defers while a Codex process is visibly active, and verifies the managed/global result after installation.

The Codex/upstream watchers are independent from PHOENIX stable activation. They continue to run when the Windows supervisor owns PHOENIX's own updater, so supervisor mode no longer suppresses ecosystem freshness checks.

## Privacy and safety

Learning stores aggregate strategy/resource facts and the already-sanitized task fingerprint/summary. Worker prompts, worker outputs, credentials, raw tool arguments, and identities are not added to the routing-learning aggregate. Unverified or failed tasks cannot teach a preferred route.

The Codex updater is best effort. Failure writes diagnostic state and leaves PHOENIX running. An invalid or incomplete managed runtime is ignored automatically in favor of the bundled fallback, and the updater never guesses how to mutate an unsupported or ambiguous global installation.

## Consequences

Repeated work can gradually converge on the fastest, lowest-resource execution shape that has actually preserved verified quality for that kind of task. Novel work remains exploratory, drift returns the task to deliberate review, and parallelism never becomes an unconditional default.

Codex freshness is no longer coupled to PHOENIX releases: execution, native account metadata, and live model discovery can all converge on the same verified managed runtime, while package ownership and stable-version boundaries prevent automatic global updates from becoming an unsafe guess.
