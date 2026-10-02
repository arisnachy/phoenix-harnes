# Agent Note: Phoenix personal-repository CI compatibility

Status: implemented

English | [中文](2026-10-02-phoenix-personal-repository-ci.zh.md)

## Problem

Referencing a local Issue makes the PR policy request native issue fields. GitHub returns 404 for this endpoint on the personal Phoenix repository, although the Issue exists and a missing Priority is legal. The vendor-rescope check also expects inline comments and indentation that the current client-purity predicate no longer contains.

## Decision

The policy treats a 404 from the optional issue-field-values endpoint as an empty field list only after the repository API confirms a personal User owner. Organization repositories fail when these fields are unavailable. The preceding Issue lookup remains mandatory; 401, 403 and other provider failures still fail. PR kinds, areas, references and any available priorities keep their validation rules. Lifecycle Project requirements are unchanged.

The rescope codemod's exact-edit target matches the current two-line predicate. This repairs the assertion without changing client bundling behavior. Duplicate or partially applied insertions remain invalid. Existing name-specific exceptions also cover the current Cordis preset tests and visual-workspace occupant owners: their bare `cordis` values are product identities, not import specifiers, and must not be renamed.

## Alternatives considered

Removing Issue references would hide the provider incompatibility. Ignoring all field errors would hide permission failures. Disabling rescope verification would lose its duplicate-edit protection. Reintroducing obsolete comments solely for a text match would couple runtime formatting to stale tooling.

## Consequences

Personal repositories can validate referenced Issues without optional native Priority fields. Organization repositories with fields retain priority checks. The real policy CLI is tested against a local API fixture returning 404 and 403. Existing rescope classification tests and the whole-worktree rescope check cover the predicate repair. No product runtime behavior changes.
