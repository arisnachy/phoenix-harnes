# Agent Note: Web fetch SSRF guard

Status: implemented

English | [中文](2026-08-24-web-fetch-ssrf-guard.zh.md)

## Problem

The anonymous HTTP fetch provider accepted arbitrary HTTP(S) destinations and resolved hostnames only as part of the underlying fetch. A model-facing web request could therefore reach loopback, private, link-local, multicast, or reserved networks, including through a same-origin redirect.

## Decision

`web-fetch-http` validates private and reserved destinations immediately before every request. Literal addresses are checked first; hostnames are resolved with all returned addresses and the request is rejected when resolution is empty or any result is private or reserved. The same check runs again after every accepted same-origin redirect.

The production configuration always sets `allowPrivateNetworks` to `false`. The explicit escape hatch exists only for isolated local fixture servers in tests and is documented as unsafe for untrusted requests. Deployments facing a hostile resolver still use an egress proxy or network allowlist because validation and socket connection are separate operations.

## Alternatives considered

**Allow private destinations and rely on deployment firewalls.** Rejected: the provider is reusable and its callers do not all have the same network boundary.

**Resolve only literal IP addresses.** Rejected: hostnames can resolve to internal addresses and can change between redirects.

**Claim complete DNS-rebinding protection from a preflight lookup.** Rejected: the Node fetch socket may resolve again after the check; the residual risk is explicit and an egress proxy remains the stronger control.

## Consequences

Public web fetching now fails closed for private and reserved targets with `WEB_BLOCKED_URL`, including DNS results and redirect hops. Local provider tests opt into the fixture-only escape hatch. The focused provider suite covers the guard and all existing transport behavior; no credentials or remote MCP activation are involved.
