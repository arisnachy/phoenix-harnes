# PHOENIX operational assurance

These commands exercise existing PHOENIX tools; installing a package alone is
not an assurance result. The command reports actual subprocess outcomes rather
than converting a missing browser, missing API, or failed test into success.

## Commands

Run `pnpm install --frozen-lockfile` first. Browser and performance profiles also
need Chromium installed with
`pnpm --filter @phoenix-ai/dsh-web-frontend exec playwright install chromium`.

| Command | Actual checks | Prerequisite |
| --- | --- | --- |
| `pnpm run quality:doctor` | Detects installed Vitest and Playwright executables | Workspace install |
| `pnpm run quality:quick` | First-pass agent decisions, skill intent and Markdown regression tests | Workspace install |
| `pnpm run quality:agents` | Agent quality, routing intent and real file-delivery regression tests | Workspace install |
| `pnpm run quality:types` | Actual Host and Client TypeScript build and Typert contracts | Workspace install |
| `pnpm run quality:architecture` | Package invariants, dependency boundaries and Knip | Workspace install |
| `pnpm run quality:security` | License validation and production `pnpm audit` | Registry access for audit |
| `pnpm run quality:browser` | Full library + browser build followed by real Playwright artifact e2e | Chromium |
| `pnpm run quality:performance` | Full library + browser build followed by existing performance suites | Chromium |
| `pnpm run quality:full` | All the above, reusing library/browser builds | Chromium and registry access |
| `pnpm run test:assurance` | Unit tests of the quality runner itself | Node.js |

Run `pnpm run quality:plan` to see the exact steps before running. The full
profile is manual and deliberately more expensive than the quick profile.
All browser suites reuse PHOENIX's existing Playwright fixture and do not call
paid models. Agent suites here are **deterministic regressions**, not a claim
of externally evaluated model quality.

## Evidence and failures

Reports are saved to `.cache/phoenix/assurance/<profile>-latest.json` and contain
start and finish times, required versus executed steps, duration, exit status
and failure reason. A failing step stops the profile; unexecuted steps are not
marked as passing. Child output is displayed in the terminal but deliberately
not copied into the JSON report to avoid persisting API tokens or user data.
The report is written even on a failed check and the command exits nonzero.

Run the optional GitHub Actions **PHOENIX assurance (manual)** workflow to
execute the same profiles on a managed runner and download the JSON evidence.
The workflow uses `workflow_dispatch` only: it does not block PRs or merges.

## Scope

This integration reuses the already installed packages: Vitest, Playwright,
TypeScript, Knip and the existing license/architecture tools. It intentionally
**does not add** promptfoo, Langfuse, OpenTelemetry, Stryker, MSW, or any other
unverified dependency to the frozen lockfile. Those require a separately
verified runtime/credential integration and dependency resolution; claiming
they are active merely because they appear in package.json would be misleading.
