# @phoenix-ai/dsh-secret-vault

English | [中文](README.zh.md)

The secret vault adds the human-only `/secret` command over `ctx.credentials`. Use `/secret set NAME VALUE`, `/secret status NAME`, or `/secret delete NAME` for provider secrets. Website credentials are entered and managed in the protected Secure Ask card below the browser; `login-set` rejects credential messages. Website records use Windows DPAPI CurrentUser encryption and explicit per-origin automatic-use consent. Command values go directly to the provider, while `command/run` omits raw input and acknowledgements contain only safe status.

Consumers such as LLM adapters still resolve the named `CredentialRef` internally for a provider operation. The Windows browser broker derives login refs from the canonical page origin, verifies the live origin again immediately before DOM injection, and receives login values only inside the trusted execution path. The vault does not expose a secret-reading tool or put secret values in model context.

The vault also registers host-only `credentials/web-login-status` and `credentials/web-login-resolve` listeners for the Windows browser consumer. The consumer calls these events with the canonical live origin; status returns only presence and consent metadata, while account, secret, and bounded `extra:0` through `extra:3` values remain inside the trusted host process. An existing DPAPI record without automatic consent is an explicit denial, while an absent DPAPI record remains eligible for a consumer's separately owned legacy migration path.

The default local provider stores the value in its owner-only credentials document. On Windows, filesystem ACL protection remains the responsibility of the account and deployment; this package's guarantee is that the command value is not included in the model request or durable command input.

## Model Experience

### Provider-backed credential use

#### What the model sees

The model sees only the consuming capability's safe configured or unavailable status. It cannot read the vault value or the raw `/secret` command; a provider resolves the named credential internally for an authorized operation.

#### Token effect

The secret value adds no model tokens. Safe status text, when a consumer exposes it, uses only a bounded descriptive message.

#### KV Cache effect

Rotating a credential does not change the model request prefix. A consuming provider may use the new value on its next request without exposing it to the context.

## Known Limitations and Deferred Work

- **The vault does not replace host storage protection** — on Windows, deployments must keep the credentials document under an account with appropriate filesystem ACLs.
- **The command is the supported secret intake** — arbitrary secrets should be entered through `/secret` instead of a normal prompt.
