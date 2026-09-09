# PHOENIX licensing architecture

PHOENIX is a downstream project with mixed provenance. Licensing follows the
copyright ownership and explicit package/file notices instead of pretending the
entire repository has one origin.

## PHOENIX-specific work

PHOENIX-specific original contributions whose copyright is held or controlled
by the PHOENIX project owner are offered under **AGPL-3.0-or-later** unless a
more specific notice applies. The intent is to keep improvements to the covered
PHOENIX layer available to users, including when modified covered software is
operated as a network service.

A separate commercial license may be negotiated for PHOENIX-specific rights
that the project owner is legally able to grant. Commercial licensing does not
change the licenses of DeepSeek Harness, vendored code, or other third-party
material.

## DeepSeek Harness and MIT compatibility packages

PHOENIX is built on the upstream [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
Upstream-derived code retains its MIT notice. Packages that explicitly declare
`"license": "MIT"` remain MIT-licensed; repository gates intentionally enforce
that boundary for the published DSH compatibility package family.

## Third-party and vendored material

Third-party components keep their own licenses. `THIRD_PARTY_NOTICES.md`, the
workspace lockfiles, vendored license files, and component-specific notices are
the authorities for those materials.

## Historical versions

Open-source grants already made are not revoked. In particular, a recipient who
lawfully received an earlier PHOENIX or DeepSeek Harness snapshot under MIT may
continue to exercise the rights granted for that snapshot under MIT. The
current policy therefore protects PHOENIX prospectively; it cannot erase rights
that were already granted for previously published code.

## Contributions

New contributions are accepted subject to `CLA.md`. That agreement lets the
project preserve the open-source AGPL path while retaining the ability to offer
a separate commercial license for PHOENIX-specific rights.

## Trademarks

Software copyright licenses do not grant permission to use the PHOENIX name,
logo, or distinctive branding as a source identifier. See `TRADEMARKS.md`.

## No legal advice

This repository documents the project's licensing policy. It is not a
substitute for advice from qualified counsel for a particular transaction,
jurisdiction, or enforcement matter.
