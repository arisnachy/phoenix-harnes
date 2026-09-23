# PHOENIX Zero-Cost Harness Benchmark

This benchmark is designed to measure Phoenix itself without spending model tokens or API money.

## What it runs

1. Local mock-LLM contract and fault-injection tests.
2. Agent-loop request reconstruction tests.
3. Adversarial judge/completion-gate tests.
4. Snapshot/replay regression tests.
5. Host + client library build.

All provider API keys are explicitly blanked for the benchmark process.

## Outputs

Every run generates:

- `artifacts/phoenix-zero-cost-benchmark/benchmark-report.md`
- `artifacts/phoenix-zero-cost-benchmark/benchmark-report.json`
- one raw log per benchmark lane

GitHub Actions also publishes the Markdown report in the job summary and uploads the complete benchmark directory as an artifact.

## Interpretation

Treat failing correctness lanes as higher priority than speed. Once all deterministic lanes are green, compare run-to-run duration changes and add targeted probes for interactive UI latency and serialized request size.

The benchmark is initially observational. It reports failures but does not block development until the baselines are stable.
