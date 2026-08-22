# PHOENIX Efficiency Runtime v2

PHOENIX Efficiency Runtime v2 is designed around one constraint: **a long-running harness should not repeatedly pay to rediscover what it already knows**.

The runtime therefore treats tokens, context, provider sessions, successful procedures and mission state as managed resources rather than disposable prompt text.

## Efficiency loop

```text
mission
  |
  v
classify complexity
  |
  v
Token Governor -----> local / free / subscription / metered lane
  |
  v
Context Compiler ----> relevant + changed artifacts only
  |
  v
model / external agent
  |
  +----> provider cache accounting
  +----> session id
  +----> result / tool intent
  |
  v
bounded history + durable checkpoint
  |
  v
verification
  |
  +---- failure ----> fallback / escalation
  |
 success
  |
  v
Experience Compiler ----> reusable verified skill
  |
  v
future mission needs less fresh context
```

## Token Governor

`TokenGovernor` classifies a request as `tiny`, `routine`, `complex` or `critical` using deterministic request features. Each class receives an input/output budget and a set of eligible lanes.

A lane can be:

- `local` — local inference such as Ollama;
- `free` — a provider's explicit free route;
- `subscription` — an authenticated vendor CLI whose usage belongs to the user's existing plan/quota;
- `metered` — an API billed by usage.

The default strategy is to avoid expensive escalation for easy work while allowing complex/critical work to reach stronger lanes. Routing remains configurable and benchmark evidence should override folklore about model names.

## Context Compiler

`ContextCompiler` ranks artifacts by relevance, priority, change state and type. It then constructs context inside a hard planning budget.

Every artifact receives a SHA-256 fingerprint. A Rebirth checkpoint can preserve those fingerprints. On a resumed provider session, unchanged artifacts with known fingerprints can be omitted and represented as reused context rather than sent again.

This is intentionally different from blindly truncating the beginning of a prompt: instructions and changed diffs receive higher priority, duplicates are removed, and excluded artifacts are reported.

The token estimator is provider-neutral and approximate. Provider-reported usage is authoritative whenever available.

## Bounded agent history

Agent loops commonly become expensive because turn N resends turns 1..N-1. `compactAgentHistory()` enforces a bounded history budget by dividing the prompt into:

1. primary instructions;
2. auxiliary context digest;
3. earlier-interaction digest;
4. recent transaction tail.

Recent assistant tool-call structures and matching tool results are preserved preferentially so token reduction does not corrupt the tool protocol.

## Exact result cache

`ExactResultCache` is opt-in. A request must set:

```json
{"metadata":{"cacheable":"true"}}
```

PHOENIX does not automatically cache arbitrary agentic or side-effecting work. Cache hits are recorded as avoided input tokens in `TokenUsageBook`.

## Experience Compiler

`ExperienceCompiler` observes receipts from completed work. When the same pattern succeeds repeatedly above an evidence threshold, PHOENIX can crystallize it into a `CompiledSkill` containing:

- trigger terms;
- a compact execution recipe;
- verification steps;
- sample count and success rate;
- observed input/output token averages;
- receipt provenance.

Skills are stored append-only in `.phoenix/skills.jsonl`. Future agents retrieve only relevant compact skills instead of rebuilding the procedure from scratch.

This is the central economic goal: **successful work should reduce the cost of similar future work**.

## Rebirth

`RebirthStore` persists durable mission checkpoints under `.phoenix/missions`.

A checkpoint can contain:

- next action;
- workspace path / branch / git head;
- provider session IDs;
- context fingerprints;
- token counters;
- arbitrary mission state.

`rebirth()` restores the latest checkpoint and builds maps for provider-session resume and known context fingerprints. `fork()` creates an alternate mission path without destroying the parent mission.

Rebirth does not pretend a provider session is immortal. If a vendor session is unavailable, PHOENIX can still recover from its own durable state and route elsewhere.

## Codex subscription bridge

PHOENIX can register `codex-cli` as a subscription lane.

This bridge **does not extract ChatGPT authentication data, OAuth tokens, cookies or API keys**. It launches the user's locally installed Codex CLI. Authentication remains owned by Codex.

The bridge uses non-interactive JSONL execution and forces Codex into `read-only` sandbox mode. PHOENIX captures:

- final agent response;
- Codex thread/session id;
- input tokens;
- cached input tokens;
- prompt-cache writes when reported;
- output tokens;
- reasoning output tokens.

The session id can later be stored in a Rebirth checkpoint and resumed.

### Important billing boundary

A ChatGPT subscription is not an arbitrary OpenAI API balance. PHOENIX does not convert subscription quota into API credits. The bridge delegates work through the authenticated Codex product, so usage remains subject to the user's Codex plan, limits and current OpenAI terms.

## Claude Code subscription bridge

`claude-code-cli` follows the same principle: use the installed/authenticated vendor CLI, never copy authentication material into PHOENIX.

The bridge runs Claude Code non-interactively with `--permission-mode plan` and captures the returned session id, usage fields and reported cost when available.

PHOENIX keeps execution authority outside the bridge. Subscription lanes are declared as reasoning lanes, not as unrestricted PHOENIX tools.

## Provider manifest

A local manifest can contain subscription and normal providers together:

```json
{
  "providers": [
    { "id": "codex-cli", "kind": "codex-cli", "models": ["default"] },
    { "id": "claude-code-cli", "kind": "claude-code-cli", "models": ["default"] },
    {
      "id": "ollama",
      "kind": "openai-compatible",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "local": true,
      "discover": true
    }
  ]
}
```

The actual `phoenix.providers.json` file is ignored by Git so local configuration is not accidentally committed.

## Benchmarking Codex, Claude and PHOENIX

The Benchmark Arena records quality, success, latency and token/cost telemetry. Input usage is separated into:

```text
input tokens
- cached input tokens
= fresh input tokens
```

`compareEfficiency()` marks a challenger as `dominates=true` only when:

1. quality and success are not materially worse; and
2. comparable usage data exists; and
3. the challenger consumes fewer fresh input tokens.

Therefore the repository should not claim that PHOENIX globally beats Codex or Claude Code merely because the architecture intends to. A real claim requires a reproducible live benchmark on the target workload.

## Security invariants

1. Subscription credentials remain inside vendor-owned authentication flows.
2. No subscription bridge is allowed to convert plan quota into an API key.
3. Codex bridge defaults to read-only sandboxing.
4. Claude Code bridge defaults to plan permission mode.
5. PHOENIX tool authority remains governed by deterministic tool policy.
6. Cache is opt-in.
7. Unknown discovered capabilities fail closed.
8. Token estimates never replace provider-reported usage when provider usage exists.
9. Rebirth state and local skills remain under `.phoenix/` and are ignored by Git by default.
10. Benchmark evidence, not branding, determines promotion.
