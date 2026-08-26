# dsh-authorization

English | [中文](README.zh.md)

Authorization Service Definition (`ctx.authorization`). Some credentials cannot be configured, only obtained: getting one means a conversation with a human — open this page, paste that code, pick an account. This seam owns that conversation and the lifecycle around it, and never the protocol.

**A flow is a plugin's knowledge of how to get its own credential.** It is registered under the [`CredentialKey`](../credentials/README.md#two-key-spaces-two-questions) it writes, so a flow says which record it produces and, through that key's scope, which plugin answers for the format inside it. A second authorization protocol arrives as another flow, not as another seam.

**The flow owns the write.** `run()` resolving means the record is already committed through `ctx.credentials`; the seam confirms a commit it observed during the attempt — presence alone would let a re-authorization pass a stale record off as fresh — and refuses a flow that resolved without one. Committing inside the flow is what lets a library that persists through its own store adapter stay the single writer instead of being copied back out and written twice.

**The interaction travels with the request, not a registry.** Whoever starts an authorization is the one who can talk to the human about it, so prompts reach exactly the surface that asked and a headless caller supplies an interaction that declines. There is no ambient provider to be absent, and no question about which of two open pages a prompt belongs to.

## Surface

```ts
import type { Context } from '@deepseek-ai/cordis'
import { AuthorizationDeclinedError, type AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'

declare const ctx: Context
declare const exchange: (signal: AbortSignal) => Promise<void>

const key = credentialKey('llm-pi-ai', 'openai-codex')

const dispose = ctx.authorization.registerFlow({
  key,
  label: 'ChatGPT (Codex)',
  methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
  async run(session: AuthorizationSession) {
    session.notify({ message: 'Continue in your browser', url: 'https://auth.example/start' })
    const code = await session.prompt({ kind: 'text', message: 'Paste the code' })
    // Commits the record through ctx.credentials before resolving.
    await exchange(session.signal)
    void code
  },
})

ctx.authorization.list()                    // [{ key, label, methods, inFlight }]
ctx.authorization.describe(key)             // the same entry, or undefined
await ctx.authorization.begin({             // { status: 'authorized' | 'cancelled' }
  key,
  interaction: { notify: () => {}, prompt: () => Promise.reject(new AuthorizationDeclinedError()) },
})
ctx.authorization.cancel(key)               // withdraw whatever is running for the key
dispose()
```

One attempt per key at a time. A second caller is refused with `ALREADY_IN_FLIGHT` rather than joined, because the two would be prompting different humans through one flow and the second would be answering questions the first was asked. `inFlight` is on the entry so a surface renders the button disabled instead of discovering this by error.

`cancel(key)` exists beside the request's own signal because a request/response transport answers a Cancel button on a second call, holding no handle on the first one's signal. A flow whose registration is disposed mid-attempt is withdrawn the same way: its runner belongs to a plugin that is going away.

An attempt whose caller has already withdrawn never claims the key and never starts the flow — relying on each flow to check its signal before the first await would let one that does not hang holding the key. Validation still runs first, so a caller naming a key or method that does not exist hears about it whether or not it also gave up.

A human's "no" is an outcome, not a breakage. An interaction that declines rejects its prompt with `AuthorizationDeclinedError`, and an attempt that fails after a declined prompt settles as `cancelled`, exactly as a withdrawn signal does; any other prompt rejection stays a flow failure that reaches the caller. A notice is fire-and-forget on the same principle, held at the seam: a surface that cannot render one loses the notice, never the attempt.

`authorization/settled (key, settlement)` fires after the key is released, for every terminal outcome. `settlement` adds `failed` to the two statuses `begin()` can return: a failure reaches its own caller as a thrown error, so the event stream is the only place a watcher that did not start the attempt can tell a refusal from a breakage. Listener failures are contained: every listener runs, a throw or rejection is logged without changing the finished attempt's outcome, and only an `INVARIANT`-coded failure rethrows after the rest ran.

## The interaction vocabulary

A notice is one-way and never carries a secret: a message, optionally the page the human must open and the code they must enter there. A prompt is a question the flow cannot answer — `text`, `secret`, or `select` — and `secret` differs from `text` only in presentation. A prompt carries its own `signal` so a flow that races a typed code against a browser callback can withdraw the losing question while the attempt continues; the request's signal withdraws the whole attempt instead.

The vocabulary is deliberately smaller than any one provider's: it describes what a surface must render, so a surface that renders one flow renders all of them.

## Google Workspace host broker

`@deepseek-ai/dsh-authorization/google` is a protocol-owning Host Service layered beside the neutral seam. It registers one `Google Workspace` flow and uses Google's Desktop-app authorization-code flow with a random loopback listener, PKCE S256, and `state`. The configured `clientId` identifies the OAuth application; it is not a user password or OAuth token. The shipped composition reads it from `PHOENIX_GOOGLE_OAUTH_CLIENT_ID`.

The provider owns the opaque `authorization-google/account` record. Successful authorization stores a versioned `grant` payload containing the access token, optional refresh token, expiry, and the exact scopes Google reported as granted. Browser-facing `list()`, `describe()`, `inspect()`, and credential metadata never read or project that payload. A restart reuses the durable grant; when the access token approaches expiry, refresh happens inside the credential provider's serialized `modifyRecord()` transaction so two Host processes cannot race refresh-token rotation.

Callers use `ctx.googleApi.request({ service, path, ... })`, not an arbitrary URL plus a caller-declared scope. `service` is one of `gmail`, `calendar`, `drive`, `docs`, `sheets`, `slides`, or `contacts`; the broker owns each service's API root and required OAuth scope. Paths must remain relative to that root, credential/cookie headers are rejected, credential-bearing requests use `redirect: 'error'`, and the Bearer token is injected only at the final Google `fetch` boundary. Results contain status, media type, and body, never the access or refresh token. `disconnect()` removes the durable grant even when Google's best-effort revocation request fails.

Google installed applications do not support incremental authorization. The mounted provider therefore asks for the configured suite scope set in one browser ceremony, but it persists the **actual** scopes returned by Google instead of pretending the user granted all of them. A capability whose scope was not granted fails closed with `GOOGLE_SCOPE_DENIED`; the user can reconnect explicitly if they want to change consent. Deployments using sensitive or restricted scopes must satisfy Google's OAuth verification requirements.

The durable grant inherits the security boundary of `dsh-credentials-local`: the file-backed provider keeps values out of model prompts, authorization surfaces, process environment, and normal configuration, but a deliberately malicious same-UID process can still read `$DSH_HOME/.credentials.yaml`. That is an existing platform limitation, not an OAuth transport leak; deployments that require secrecy even from arbitrary same-user processes still need the deferred OS-isolated credential backend described by `credentials-local`.

## Model Experience

None directly: authorization is a configuration-time conversation with a human, and no flow, notice, prompt, OAuth token, credential payload, or broker authentication header enters a model request. Model-visible Google tools receive only the Google API data their owning integration chooses to return.

#### KV Cache effect

No invalidation; no authorization state enters a request prefix.

## Known Limitations and Deferred Work

- **No flow is resumable** — an attempt lives in the process that started it, so a browser reload during a login abandons it and the human starts over. Durable attempts need a store this seam does not have.
- **The local credential file is not a same-UID isolation boundary** — durable Google grants share the documented `credentials-local` limitation: a process already running as the user can deliberately read the file. An OS-isolated credential provider remains the stronger follow-up.
- **There is no generic revoke operation on the authorization seam** — providers may own protocol-specific revocation, as the Google broker does, but `ctx.authorization` itself exposes no cross-provider sign-out method.
- **A key with no flow is inert** — the seam reports what is registered, so a record left by an uninstalled plugin can be deleted but not re-authorized. Recognizing that orphan is the caller's join, as it is for [`listRecords()`](../credentials/README.md#surface).
