# Agent Note: Reserve Google refresh and reject registry URL templates

Status: implemented

English | [中文](2026-10-05-host-release-refresh-and-registry-validation.zh.md)

## Problem

Concurrent Google API callers can enter token refresh before credential lookup finishes. Assigning the shared refresh promise after those awaits admits multiple refreshes and can consume one provider response twice. Registry URL normalization percent-encodes template braces, so checking only a literal opening brace after normalization accepts an unresolved template as an installation endpoint.

## Decision

The Google broker reserves its shared refresh promise before resolving client credentials. Each caller checks its required scope against the resulting grant, including callers that share the refresh. Registry candidate projection rejects literal and percent-encoded braces in normalized remote endpoints. These repairs retain the fixed destination and granted-scope boundaries.

Google fixtures select the Google authorization flow independently of the additional GitHub flow and provide writable reference storage for the client-secret test. Scope-denial and secret-redaction assertions remain active.

## Alternatives considered

**Accept multiple refreshes or relax scope assertions.** This would conceal the admission race and weaken evidence that each caller receives only consented capabilities.

**Expect an encoded template endpoint.** An unresolved template is not the concrete endpoint the installation contract requires; adapting the assertion would hide the normalization bug.

## Consequences

The owning Google and registry suites pass all 19 tests. Concurrent scope coverage asserts exactly one token refresh, a successful Gmail request, and denial of the ungranted Drive capability. Registry projection retains the concrete HTTPS endpoint despite preceding literal and encoded template candidates. No release thresholds or test exclusions change.
