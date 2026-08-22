# Evidence

- Source and destination main SHA: b150a551b8d465e31e418e1b2eaf5e79bbb7d28e.
- Source and destination tree: 53915efe4e2126cc7779b73dfc8a3bcec5318c44.
- OrcaRouter documents an OpenAI-compatible endpoint at https://api.orcarouter.ai/v1.
- OrcaRouter documents `orcarouter/free` as a quota-backed route that does not spend wallet balance.
- Focused PHOENIX/profile tests: 24/24 passed after the self-bundle correction, including free-route failure with zero local requests; earlier expanded constraints/release/PHOENIX set: 54/54 passed.
- Router coverage: 7/7 passed with 100% statements, branches, functions, and lines.
- Real Loader snapshot passed 1/1 in source mode and 1/1 against built `lib` artifacts for local and free lanes, including prompt persona, adapter request, and durable request header alignment.
- Targeted TypeScript build and definitive full host build passed with the CLI-owned PHOENIX bundle.
- Full `pnpm run build` passed, including host, client, and production web assets.
- Built CLI from a fresh DSH home resolves itself as the final bundle; `--profile phoenix --dump-default-config` contains both lanes, `orcarouter/free`, and `phoenix-model-router`.
- Workspace constraints, release-family isolation, Knip, package invariants, publint, Cordis config, runtime closure, client packages, optional imports, doc graphs, config catalog, README contracts, Agent Note format, and 1,006 translation pairs passed.
- Final hygiene rerun: 11/13 gates passed; only the two recorded baseline/host limitations failed (vendor rescope exact-edit state and Windows NodeNext symlink creation).
- Final doc-sync rerun: 27/28 gates passed, including the documentation build; only the Windows symlink escape-test fixture failed with `EPERM`.
- Full upstream test result: 803 files passed, 31 failed, 4 skipped; 13,918 tests passed, 69 failed, 61 skipped. No PHOENIX package/profile test failed.
- Runtime prerequisites observed locally: Ollama 0.32.14 is available, but only `gemma4:e2b` is installed; `qwen3:8b` and `ORCAROUTER_API_KEY` are absent.
- Independent second JUDGE verdict: `CONDITIONAL_PASS`, with no CRITICAL/HIGH blocker; remaining conditions are LIVE, complete Linux/CI gates, Windows limitations, and exact-SHA publication.
