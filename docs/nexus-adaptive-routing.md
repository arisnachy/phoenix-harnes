# PHOENIX ORIÓN — adaptive intelligence (Nexus-compatible runtime)

ORIÓN is the public name of PHOENIX's adaptive orchestration engine, evolved from ClickSec. It is an independent model-selection system, not a new foundation model or an automatic premium supervisor. The current initial modules live in `packages/llm/llm-pi-ai/src/nexus.ts` and the team provenance UI. The existing Eclipse runtime remains unchanged.

The ORIÓN/Nexus foundation offers price classification, official OpenRouter catalog normalization, a measured quota forecaster, conservative model selection and quality calibration. Its opt-in `phoenix-nexus/nexus-auto` selector now resolves to a real provider/model before streaming; unverified pricing never qualifies for free routing, and local models remain excluded. Account quota telemetry is used for subscription-first Codex routing. Verified free routes are a last resort for suitable simple tasks. Transport receipts now persist in the private harness home. Provider-specific billing probes, broad semantic quality calibration and full live e2e checks are still incomplete, so the autonomous deployment has not passed acceptance.

The target engine covers all configured provider routes, not just OpenRouter and NVIDIA. Free rates must be confirmed from supported provider pricing sources or an explicit operator-confirmed policy, with an expiration; a model name alone never proves zero cost. A model can be free but quota-limited, and some providers disclose only partial quota data. Local models must stay excluded from automatic selection until the user enables them explicitly.

## Model selector, identity and compatibility

- **Visible provider:** `PHOENIX`; **visible model:** `ORIÓN` (one adaptive engine, not multiple invented models).
- **Internal route kept stable:** `phoenix-nexus/nexus-auto`. This exact pair is submitted to Host; the selector merges `phoenix` and `phoenix-nexus` into one visible PHOENIX group without aliasing their routing IDs. Legacy sessions and settings continue to work.
- **Fénix Eclipse** remains the separate existing `phoenix/phoenix-auto` orchestrator. ORIÓN does not replace Eclipse nor change its policy.
- **Icon:** compact three-star constellation with blue/gold belt, distinct from the main PHOENIX golden emblem; the selected icon uses a subtle glow with `prefers-reduced-motion` support.
- **Kira/team provenance:** a synthetic ORIÓN mark is only displayed for the synthetic route. After routing, the actual provider and concrete model remain visible rather than being relabeled as ORIÓN.
- **Diagnostics:** `phoenix_nexus_inspect`, `nexusFreeRoutes`, `NEXUS_PROVIDER`, `NEXUS_MODEL`, receipt filenames and error codes intentionally keep stable names for API compatibility. The inspect tool exposes verified sources and does not invent remaining tokens.
- **Limitations:** ORIÓN does not activate paid generation without verified authorization and does not automatically run local models. Production rollout still requires green CI, live account validation and compatible promotion to `main` and `stable`.

## Wiring requirements

The current opt-in Host reads the configured provider model registry, public OpenRouter price catalog, explicit additional-provider attestations and Codex account quotas; the Kira team displays actual serving model badges. The runtime revalidates credentials and official OpenRouter pricing before continuing an existing route. The next acceptance gates are broad semantic quality calibration, real readiness checks for each configured provider, account-specific free-tier entitlement detection, proof of in-session failover, and optional UI controls for the local-model gate. Do not promote it as complete until the integrated tests and live provider checks pass.

## Quota and billing safety

Automatic Codex routing requires both native quota percentages and valid reset timestamps, including complex tasks. The pacing allowance is 10 percent plus 85 percent of the elapsed window fraction, capped at 90 percent; neither complexity nor a failed free route bypasses it. The runtime chooses only advertised model IDs and reasoning efforts, preferring economical Luna-family models for simple work and Sol/Astra-family models for complex work, with cross-family fallback if necessary. At 75 percent of the tighter pacing allowance, complex reasoning prefers medium over high when advertised. This is a provisional task/effort heuristic, not a benchmark of semantic quality. Neither policy estimates a provider token balance. Missing quota data fails closed. This is a conservative admission heuristic, not a guarantee of seven days of capacity; provider-side consumption and concurrent use remain external.

Limited free allowances remain visible as a separate price class, but are not automatically consumed without a provable no-overage reservation. Provider names never establish a zero price. No premium supervisor is invoked.

## Durable transport observations

The opt-in Nexus route records terminal transport observations only for its matched session and concrete provider/model. The versioned receipt file lives under the harness home as `nexus-receipts-v1.json`. Writers use the shared atomic-write lock, owner-only file permissions where supported, eight-day retention and a 10,000-receipt bound. Missing token usage is explicitly marked as unreported. No prompts, session IDs or credentials are stored. On restart, observed latency and transport failure rates can inform ranking. Successful transport is not proof of semantic quality, and these local receipts never establish an exact account-wide quota balance.


## Independent acceptance and route recovery

The runtime now extracts an answer key only for a standalone explicit quoted exact-response instruction (English or Spanish). For a completed text response it compares the bounded visible text with that key, never asking the model to grade itself. Only the boolean outcome is persisted; answer keys and output text are not written to the receipt file. After at least five such observations, Bayesian-smoothed acceptance informs ranking only for the same exact-response task class. Unmeasured ordinary, clinical, coding and research quality remains unknown. No paid benchmark requests are sent automatically.

The official OpenRouter catalog also supplies declared context capacities. The current 8,192-token routing floor is not a measurement of the full assembled prompt. The adapter still owns final capacity validation. Automatic free routes must advertise tool support, and short continuation or high-stakes requests are classified conservatively. Provider authorization is checked at dispatch; unknown prices, local models and unreserved allowances remain excluded.

The runtime integration fixture exercises native Codex priority with fresh quota evidence, a transport failure, verified free fallback, bounded retry, and exhaustion. This is a simulated integration test, not a live cross-provider account test. Team headers show the concrete model ID rather than just its family name; unknown providers retain a generic mark rather than a fabricated vendor identity.


## Additional providers and self-inspection

The optional llm-pi-ai setting `nexusFreeRoutes` defaults to an empty array. A record names the exact configured provider, model and explicit HTTPS baseURL; `verifiedAt` and `expiresAt` are Unix milliseconds, with at most seven days of validity. `allChargesZero`, `noOverage` and `supportsTools` must be true, and `contextWindow` must be an integer of at least 8192. These are explicit operator attestations of an independently verified zero-cost arrangement, not provider-supplied billing facts. Never configure an attestation for a trial that can silently overrun into billing. No third-party attestation ships by default. OpenRouter continues to require its official catalog and Codex its native account telemetry; local routes remain excluded. The policy is rechecked immediately before dispatch and on continuing turns.

`phoenix_nexus_inspect` is a read-only tool in compositions exposing the tools registry. It lists configured catalog models in pages of 25 with optional exact-provider filter, authorization status, evidence class, context, available reasoning efforts and the last dispatched Nexus route for the calling session. Readiness is not inferred from a credential or model listing. It exposes native Codex 5h/7d used and remaining percentages, UTC reset times and remaining milliseconds when the samples are fresh; exact token balance remains null unless a provider actually supplies one. It never sends model generations, credentials or prompts.

Independent acceptance additionally grades narrowly scoped integer addition, subtraction and multiplication. Numeric and exact-answer scores are separate; only a bounded response is checked and only a boolean is persisted. These checks cannot validate arbitrary medical, legal, coding or research reasoning. Full live account verification is still an acceptance gate, not an achievement inferred from mocked integration fixtures.

Pricing evidence without expiration, ambiguous or duplicate catalog entries, unknown billing dimensions and unknown required context now fail closed.
