CURRENT OBJECTIVE
Implement and verify the first PHOENIX foundation on a feature branch.

DONE
- DeepSeek Harness upstream is pinned at b150a551b8d465e31e418e1b2eaf5e79bbb7d28e.
- The previous PHOENIX main is recoverable at legacy/pre-deepseek-import-20260822.
- OrcaRouter and DeepSeek Harness current public compatibility facts were rechecked.
- PHOENIX composes as a CLI-owned bundle, deterministic router, and agent preset without private package dependencies.
- A real Loader snapshot proves local/free request, persona, and durable header alignment.
- The local lane is `phoenix-local/qwen3:8b`; the external lane is only `phoenix-free/orcarouter/free`.
- Constraints, release isolation, focused tests, typecheck, documentation, translation, Knip, host build, and CLI composition pass.

IN PROGRESS
- Feature-branch publication and exact-SHA CI inspection.

BLOCKED
- Live OrcaRouter requests require a user-owned ORCAROUTER_API_KEY.
- Live Ollama requests require the configured qwen3:8b model; this host currently has only gemma4:e2b.
- Full upstream tests are not green on this Windows host: 13,918 passed, 69 failed, and 61 skipped; failures are dominated by unavailable symlink privilege and concurrent timeouts.
- NodeNext verification also requires symlink privilege on this host.

NEXT
- Commit, push the feature branch, create a PR, and inspect exact-SHA CI.

CRITICAL FACTS
- Do not modify vendor or HealthIA.
- OrcaRouter free requests must use orcarouter/free and fail closed when free quota is unavailable.
- Keep main stable; publish through a feature branch and pull request.
