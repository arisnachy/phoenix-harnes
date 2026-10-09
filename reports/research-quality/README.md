# Phoenix research-quality benchmark

**This suite is a reproducible audit, not proof that an LLM is already accurate or fast.**
The checked-in cases are deliberately **synthetic** so that automated tests
are deterministic, keyless and don't pretend to be real-world current news.
A score of 100/100 on a synthetic fixture tests the **evaluator**, not Kira.

## What was missing

The shipped Phoenix base mounted `web_search` but disabled `web_fetch`.
Search snippets cannot establish the full text, methodology, date, or caveats
of a consequential source. This change mounts the existing anonymous HTTP
reader in the base profile, with private/reserved network targets blocked,
credentials never sent, same-origin redirects, byte/time caps and no cookies.
Do not enable `allowPrivateNetworks` for model-chosen URLs.

**Security caveat:** a workstation facing hostile DNS rebinding still needs a
restrictive egress proxy or pinned-DNS transport. The current preflight
public-IP check alone is not a complete defense against that threat.

## Three-stage validation

1. **Offline source-access test:** production Cordis mounts a public
   `web_fetch` reader and blocks private network targets; existing web
   provider tests exercise safe redirects, HTTP parsing, timeout and limits.
2. **Offline benchmark-contract test:** a fixed independent corpus verifies
   claims, direct-source citation, actual fetch receipts, independent domains,
   freshness, wall time and tokens. Fake URLs, uninspected snippets and
   unsupported conclusions fail automatically.
3. **Live Phoenix Desktop/headless challenge (REQUIRED for real claims):**
   run the same prompts against Phoenix and a comparator, use the same
   time window/model budget, record actual session tool results and token
   usage, then have a separate reviewer inspect every consequential fact.
   Until stage 3, do not say Phoenix scores 90/100 or beats ChatGPT.

## Run the offline gate

```sh
node --test scripts/phoenix-research-benchmark.test.mjs
node scripts/phoenix-research-benchmark.mjs \
  --cases reports/research-quality/cases.synthetic.json \
  --run reports/research-quality/fixtures/reference-run.synthetic.json \
  --output research-score.json
```

`cases.synthetic.json` is an **external, trusted gold reference**; a model
must not write or modify gold documents when it is evaluated. A run contains:

```json
{
  "cases": [{
    "id": "mcp-diagnosis",
    "answer": "A grounded user-facing answer with direct markdown URL citations",
    "observedWebFetchUrls": ["https://primary.example.com/mcp/endpoint"],
    "elapsedMs": 24000,
    "promptTokens": 2400,
    "completionTokens": 1050
  }]
}
```

Take `observedWebFetchUrls` from **real successful web_fetch tool receipts** in
the durable session event log, **not from Kira's claim that she read them**.
The script has no access to the model or web network and cannot verify that
this submitted JSON was collected honestly. A separate trace validator or
reviewer must protect that evidence boundary during live tests.

## Recommended live trials: same tasks for Phoenix and comparator

- **A. Fast current fact (90s target):** find the current value of a specified
  official indicator and its publication date. Cite the primary agency's
  *actual* publication, not only a search snippet.
- **B. Master's-level cognitive neuroscience (180s target):** compare the
  two latest eligible empirical papers about a defined intervention. Include
  design, sample sizes, effects, limitations, DOI and evidence strength.
- **C. GitHub MCP diagnosis (90s target):** distinguish observed HTTP
  response/endpoint from inferred OAuth state; validate a real server
  URL and source code before blaming credentials. Never expose secrets.
- **D. Conflicting current documents (120s target):** verify a changed policy
  or product specification against newer and older original documents,
  explain which is valid *as of the run date*.
- **E. Research continuity (90s target):** repeat a related request after
  the first task. Verify useful memory reuse without stale facts, reused
  hallucinations, or duplicate paid searches.

For each live trial, capture independently: model/route, actual date,
start-to-final wall time, tool-call timeline, distinct original URLs searched
and **opened**, tokens, citations, missing required facts, contradictions,
unsupported statements and user-visible messages. Perform two independent
runs to avoid cherry-picking.

## Acceptance targets before a measured 10/10 claim

An independently verified report must have no invented citations or material
unsupported claims; cover **all requested subquestions**, distinguish strong
from preliminary findings, cite direct sources, and describe uncertainty.
Targets: at least 90/100 audited score on every selected live case; user-visible
first useful finding promptly; no repeated same-query loops; realistic elapsed
time and token budgets. Score-based assertions cannot replace human judgment
of study quality, source reliability, causal interpretation or clinical risk.

If a provider is disabled, blocked or returns zero sources, mark access as
**unavailable** rather than claiming an empty result means no information
exists. Public HTML search may be rate-limited; authenticated sources still
require existing user authorization. Do not scrape personal user data or
bypass permissions to improve an evaluation score.
