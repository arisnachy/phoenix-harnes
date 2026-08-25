# Agent Note: Google OAuth tokens stay in the Host broker

Status: implemented

English | [中文](2026-08-25-google-oauth-host-broker.zh.md)

## Problem

PHOENIX needs one human Google sign-in that can authorize its Google Workspace capabilities without putting the user's OAuth access or refresh token in model context, logs, configuration, or a file that model tool processes can read. The existing `credentials-local` store cannot satisfy that security property: its owner-only filesystem permissions protect against other OS users, but the same-UID bash and filesystem processes available to the agent can deliberately read the document. Persisting a Google `grant` record there would therefore turn an implementation convenience into a credential-exfiltration path.

The generic `ctx.authorization` service must also remain protocol-neutral. Moving Google endpoint, PKCE, refresh, or scope behavior into the seam would make every authorization surface depend on one provider's protocol and repeat the coupling that the flow registry was introduced to avoid.

## Decision

`@deepseek-ai/dsh-authorization/google` is a Host Service layered beside the neutral authorization service. It owns Google's installed-application Authorization Code flow and registers one `Google Workspace` authorization flow. The provider uses a random `127.0.0.1` loopback port, a high-entropy `state`, PKCE S256, and Google's HTTPS authorization/token endpoints. The configured Desktop OAuth client id is application identity, not a user credential.

Google OAuth access and refresh tokens are private fields of the Host Service. A successful flow writes only the secret-free `authorization-google/account` marker through `ctx.credentials`, satisfying the authorization seam's commit requirement without copying the provider credential into the local credential document. The tokens disappear when the process exits; PHOENIX requires another Google authorization after restart until a secret backend exists that same-UID tool processes cannot read.

Consumers do not resolve a token. They call `ctx.googleApi.request()` with an HTTPS Google API URL and the scopes the operation requires. The broker rejects non-Google and OAuth-token destinations, caller-provided authorization/cookie headers, duplicate or empty required scopes, and scopes absent from the actual grant. Only after those checks does it inject `Authorization: Bearer ...` immediately before `fetch`. Its return value contains the API status, media type, and body, never the token or the complete response headers.

Refresh is serialized inside the broker, so concurrent expiry does not fan out refresh-token use. `disconnect()` clears the in-memory grant before best-effort Google revocation and always removes the marker, so a revocation outage cannot leave PHOENIX locally authenticated.

## Scope composition

Google documents that installed applications do not support incremental authorization. The shipped row therefore names the Workspace scopes its mounted capabilities require and requests them in one explicit human consent. The list is configuration, not an implicit universal grant: a deployment that removes capabilities should narrow the complete row, and any deployment using sensitive or restricted scopes remains responsible for Google's OAuth consent and verification requirements.

The initial suite covers account identity plus Gmail modify, Calendar, Drive, Docs, Sheets, Slides, and Contacts. `gmail.modify` already covers reading, composing, and sending mail, so a redundant Gmail send scope is not added.

## Alternatives considered

**Persist a normal `grant` record in `.credentials.yaml`.** Rejected because repository documentation explicitly states that file permissions are not a boundary against model tools under the same OS user. Encryption with a key available to the same process tree would only move the readable secret.

**Put Google OAuth inside `ctx.authorization`.** Rejected because the authorization seam owns human interaction and lifecycle, while the provider owns protocol. Google-specific endpoints and refresh behavior would make the generic service a protocol implementation.

**Return short-lived access tokens to connector plugins.** Rejected because every returned token creates another memory/log/tool boundary to defend. The broker can perform the API request itself and return only the requested Google result.

**Persist refresh tokens for restart convenience.** Deferred until PHOENIX has an OS keychain, external vault, or equivalent provider that agent tool processes cannot read. Reauthentication is an explicit security/usability tradeoff rather than a hidden weakening.

## Consequences

- Models and generic PHOENIX authorization surfaces receive account state and Google API results, not OAuth tokens.
- The local credential document contains only a marker for Google authorization.
- A PHOENIX restart requires Google sign-in again.
- Google API consumers must declare required scopes on every broker request; missing authority fails before network I/O to the target API.
- Browser authorization uses the system Google page and loopback callback; no password or authorization code is pasted into a PHOENIX prompt.
- The provider can later move token persistence behind a stronger credential backend without changing `ctx.googleApi` consumers.

### Accepted risks

The Host process itself necessarily holds the live token and can use it for the granted Google APIs. This design protects the credential from the model/tool plane, not from a compromised PHOENIX Host process. Broad Google Workspace scopes may also require provider verification; PHOENIX cannot bypass Google's consent or verification policy.
