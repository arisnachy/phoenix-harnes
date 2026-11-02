# Agent Note: Origin-bound browser vault autonomy

Status: implemented

English | [中文](2026-09-20-origin-bound-browser-vault-autonomy.zh.md)

## Problem

PHOENIX could already store human-entered secrets outside model context and could already control the Windows desktop and embedded browser, but those capabilities were disconnected. A recurring authorized task that reached a login or form either needed another human interaction or risked moving a credential through model-visible text. Repeated approval prompts also made scheduled form/report work fail to behave like a durable digital worker.

## Decision

The credential seam now provides `normalizeCredentialOrigin()` and `originCredentialRef()`. Remote unattended credentials are bound to a canonical HTTPS origin; loopback HTTP is allowed for local development. `/secret login-set <origin> <account> <secret>` stores three origin-derived references: account, secret, and an `autonomous` marker. The command remains human-only with `recordInput: false`, so neither account nor secret enters the durable command event or model request.

Windows `computer` remains the single model-facing browser/desktop capability. It gains structured `browser_inspect`, `browser_fill_form`, `browser_click_text`, and `browser_login` actions instead of introducing a second automation stack. The model supplies only the expected origin and ordinary non-secret form values. `browser_login` resolves the account and secret internally from `ctx.credentials` immediately before use and sends them only through Phoenix Desktop's current-user-only named pipe to WebView2. The model never receives either value.

The native desktop parser rejects automation commands from the Phoenix page bridge; only the trusted named-pipe path may admit them. Both the runtime broker and the WebView script verify the live origin before mutation, closing the navigation race between host-side checking and DOM injection. `browser_inspect` never returns current input values. Generic form filling rejects password and file fields so secrets and local file paths stay behind dedicated brokers.

The origin-bound `autonomous` marker is also the one-time approval for unattended browser open/login/form/click work on that exact origin. Under workspace-write, those high-level actions do not repeatedly interrupt an already authorized recurring task. Other Computer Use actions keep the existing sandbox and approval rules; danger-full-access remains the explicit global no-prompt mode.

## Verification

Credential unit tests pin HTTPS/loopback normalization, collision-resistant origin references, command-log redaction, autonomous login enrollment/status/deletion, and rejection of insecure remote origins. Computer Use tests pin the new action schemas, browser command mapping, post-action screenshot policy, and the read-only nature of inspection. Native Desktop contract tests pin default rejection of automation through the page bridge, named-pipe admission when explicitly enabled, canonical origins, form parsing, login parsing, and rejection of insecure origins. The PR CI remains the integration gate for TypeScript and .NET compilation plus repository-wide checks.

## Alternatives considered

**Expose a password-reading tool to the model.** Rejected because a prompt injection, transcript, telemetry path, or provider could then receive the secret.

**Send vault values through the standalone Chrome MCP connector.** Rejected because that creates another process/RPC secret boundary and duplicates the existing native `computer` browser capability.

**Disable approvals globally for scheduled work.** Rejected because one site's recurring login should not silently widen desktop authority for unrelated applications or origins.

**Use coordinate typing for every form.** Retained only as a fallback. Structured DOM actions are faster, less brittle, cheaper in screenshots/model turns, and can enforce origin and protected-field rules deterministically.

## Consequences

After one explicit login enrollment, an authorized recurring Phoenix task can reopen the site, inspect the current form, authenticate, fill non-secret fields, click/submit, and verify the visible result without repeatedly asking the user for the stored credential or the same per-step approval. MFA, CAPTCHA, expired credentials, materially changed pages, or decisions outside the prior task authorization can still require recovery or human intervention. The underlying local credential provider is unchanged by this feature; its existing host-storage protection requirements still apply.
