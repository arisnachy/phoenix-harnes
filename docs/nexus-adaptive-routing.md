# PHOENIX Nexus — cross-provider adaptive intelligence

Nexus is an independent model-selection system, not a new foundation model or an automatic premium supervisor. The current initial modules live in `packages/llm/llm-pi-ai/src/nexus.ts` and the team provenance UI. The existing Eclipse runtime remains unchanged.

The new pure engine offers price classification, OpenRouter price normalization, a measured rolling or anchored quota forecaster, conservative model selection and quality calibration. It requires externally verified provider authorization, current price information, and actual runtime receipts. It makes no model requests, and is not yet connected to the session model selector or a persistent metrics database. The current work is not a completed autonomous runtime.

The target engine covers all configured provider routes, not just OpenRouter and NVIDIA. Free rates must be confirmed from supported provider pricing sources or an explicit operator-confirmed policy, with an expiration; a model name alone never proves zero cost. A model can be free but quota-limited, and some providers disclose only partial quota data. Local models must stay excluded from automatic selection until the user enables them explicitly.

## Wiring requirements

The Host must supply authenticated model inventory, readiness probes, pricing cache and meter receipts to the Nexus routing service. The service must be installed as an optional separately selectable route, use quality and tool-capability gates, preserve durable task checkpoints and reject unapproved paid calls. The client must display provider/model identity and estimated vs verified balances, with a user-facing local enable control. Do not promote it as ready until the integrated tests and live provider checks pass.
