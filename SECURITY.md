# PHOENIX Security Policy

PHOENIX treats models, external nodes, generated tools, MCP servers, retrieved content, and collective-evolution contributions as **untrusted by default**.

## Core security invariant

No model, node, MCP server, generated tool, or evolution cell may obtain enough authority by itself to modify or release PHOENIX Mother.

Capability and trust are separate systems. A model may rank first in the Model Capability Ladder and still be quarantined or denied authority.

## Authority model

PHOENIX uses short-lived, mission-bound capability leases. Dangerous scopes (`write`, `exec`, `forge`) require an independently approved lease and are one-use by default. Sovereign scopes (`promote`, `release`, `secrets`) require a human approval gate.

The authority signing secret belongs to the trusted host process. It must never be exposed to model prompts, model sandboxes, generated tools, MCP servers, logs, or Collective Evolution capsules.

## Collective Evolution

Contributors and judges must be independent. A contributor node or contributing model cannot later judge its own candidate. Quarantined nodes/models are excluded from orchestration, contribution, and judging regardless of ranking.

Mother candidates must pass build, tests, security checks, zero-regression gates, reproducibility thresholds, and independent judges. Direct writes and force updates are forbidden by the runtime guard.

Changes to security-critical paths require a human gate:

- `.github/`
- `packages/security/`
- `SECURITY.md`
- `LICENSE`
- root `package.json`
- `pnpm-lock.yaml`

## MCP and generated tools

Imported MCP environment variables are stripped by default. Enable `allowImportedServerEnv` only for MCP configuration that the local user explicitly trusts. Tool execution can be configured to require signed capability leases at the ToolRegistry boundary.

Generated Toolsmith artifacts remain local and untrusted until verified. Generated tools must not receive the authority-kernel secret or ambient credentials.

## GitHub Mother protection

The runtime requires a protected-branch gate, but repository settings are external to the runtime. The repository owner should enable a GitHub ruleset/branch protection for `main` that:

- blocks direct pushes and force pushes;
- requires pull requests;
- requires PHOENIX CI and security checks;
- requires review for security/control-plane paths;
- prevents bypass where possible;
- requires signed commits/releases where practical.

Until GitHub branch protection/rulesets are enabled, PHOENIX can fail closed internally but cannot physically prevent a repository administrator or credential with direct write permission from changing `main` outside PHOENIX.

## Reporting vulnerabilities

Do not post secrets, exploit credentials, or private user data in public issues. Report security vulnerabilities privately to the repository owner through GitHub's private vulnerability reporting/security advisory flow when enabled.
