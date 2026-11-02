# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/arisnachy/phoenix-harnes/security/advisories/new). Do not open a public issue and never include API keys, OAuth grants, session logs, family data, or other personal information in a report.

Include the affected commit, platform, minimal reproduction, expected trust boundary, and observed impact. Maintainers will acknowledge a complete report, reproduce it against the named commit, and coordinate remediation and disclosure.

## Supported code

Security fixes target the current `main` branch. A release or installer is supported only when its exact commit passes the required CI, Windows, identity, and packaging gates. PHOENIX does not treat `danger-full-access` as a sandbox; users must explicitly choose that mode and retain backups for destructive work.
