# Agent Note: Declared workspace dependency impact

Status: implemented

## Problem

Package injection metadata describes only some relationships in the source tree. The adaptive source inspector needs to distinguish explicit workspace dependencies from registered services when estimating the potential impact of a source change.

## Decision

The source inspector exposes a separate `workspaceGraph` for explicit `workspace:` declarations in dependencies, peer dependencies, optional dependencies and development dependencies. Unique package names resolve to inventoried paths; missing and ambiguous targets remain unresolved. The graph records dependency kinds, transitive potential dependents and a fingerprint of normalized declarations. The existing injection graph remains independent.

## Alternatives considered

**Replace the injection graph with package dependencies.** Rejected because a package relationship is not evidence that a service is registered or running.

**Infer targets for unresolved declarations.** Rejected because inventory coverage and package identity are not guaranteed.

## Consequences

The graph supports source-level impact estimates without claiming causal proof, runtime health or authorization to change anything. Development dependencies are included, and the existing inventory limits still apply. Version specifications, external dependency URLs and command bodies are not exposed by the new graph. The focused source inspector tests cover dependency kinds, transitive impact, ambiguous targets, unresolved targets and deterministic fingerprints.
