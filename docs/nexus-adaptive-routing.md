# PHOENIX Nexus — cross-provider adaptive intelligence

Nexus is an independent model-selection system, not a new foundation model or an automatic premium supervisor. The current initial modules live in `packages/llm/llm-pi-ai/src/nexus.ts` and the team provenance UI. The existing Eclipse runtime remains unchanged.

The Nexus foundation offers price classification, official OpenRouter catalog normalization, a measured quota forecaster, conservative model selection and quality calibration. Its opt-in `phoenix-nexus/nexus-auto` selector now resolves to a real provider/model before streaming; unverified pricing never qualifies for free routing, and local models remain excluded. Account quota telemetry is used for guarded Codex subscription fallback. Persistent metrics, all-provider-specific billing probes, and full e2e checks are still not complete, so the autonomous deployment has not passed acceptance.

The target engine covers all configured provider routes, not just OpenRouter and NVIDIA. Free rates must be confirmed from supported provider pricing sources or an explicit operator-confirmed policy, with an expiration; a model name alone never proves zero cost. A model can be free but quota-limited, and some providers disclose only partial quota data. Local models must stay excluded from automatic selection until the user enables them explicitly.

## Wiring requirements

The current opt-in Host reads the configured provider model registry, public OpenRouter price catalog and Codex account quotas; the Kira team displays actual serving model badges. The next acceptance gates are persistence of usage and calibration across restarts, real readiness checks for each configured provider, account-specific free-tier entitlement detection, proof of in-session failover, and optional UI controls for the local-model gate. Do not promote it as complete until the integrated tests and live provider checks pass.
