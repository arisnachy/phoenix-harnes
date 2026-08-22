# Failures

- Initial routing on `agent/pre-step` was too late because system-prompt assembly had already captured the model. The router now listens on `agent/inbox/claimed`; lifecycle coverage proves the selection precedes assembly.
- The first package layout made the public CLI depend on a private downstream bundle. The corrected layout makes the CLI itself the final bundle layer and adds explicit self-package resolution coverage.
- `pnpm test` completed with 13,918 passed, 69 failed, and 61 skipped. Failures were outside changed PHOENIX packages and were dominated by Windows `EPERM` symlink creation plus concurrency timeouts; the one change-related release-family failure was corrected and its isolated suite passes 25/25.
- `pnpm run hygiene` initially found Knip composition dependencies loaded from YAML. Explicit workspace ignores now model those non-TypeScript imports and isolated Knip passes.
- Two baseline/environment gates remain: vendor rescope reports two pre-existing exact-edit mismatches, and NodeNext cannot create its temporary package symlinks on this Windows host.
- The full snapshot gate was stopped after broad Windows concurrency timeouts, including a 60-second Phoenix timeout under contention; the identical Phoenix snapshot passed alone in 19.37 seconds.
