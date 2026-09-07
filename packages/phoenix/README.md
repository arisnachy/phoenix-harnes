# phoenix/ — PHOENIX evolution layer

PHOENIX is the downstream evolution of DeepSeek Harness in this repository. Packages in this group add provider-neutral intelligence, safety, efficiency, continuity, and self-improvement while reusing DSH's mature capability seams.

| Package | Role | ctx key |
|---|---|---|
| [`runtime/`](runtime/README.md) | capability ranking, adaptive routing, failover, token flight recording, Agent ROI, local evolution, Mother Guard | `phoenix` |

## Design rule

Prefer an existing DSH service/hook over a parallel implementation. PHOENIX replaces a DSH component only when the replacement is evidence-backed and remains compatible with upstream synchronization.
