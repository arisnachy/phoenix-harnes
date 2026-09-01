# @phoenix-ai/dsh-secret-vault

English | [中文](README.zh.md)

The secret vault adds the human-only `/secret` command over `ctx.credentials`. Use `/secret set NAME VALUE`, `/secret status NAME`, or `/secret delete NAME` from the composer. The value is passed directly to the credential provider, while `command/run` omits its raw input and the acknowledgement contains only redacted status. The command is never sent to the model.

Consumers such as LLM adapters still resolve the named `CredentialRef` internally for a provider operation. The vault does not expose a secret-reading tool or put secret values in model context.

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
