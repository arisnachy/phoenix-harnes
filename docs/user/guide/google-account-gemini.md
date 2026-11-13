# Google personal-account Gemini models in PHOENIX

PHOENIX offers two separate Gemini authentication options: Google's account-scoped Antigravity CLI for individual Free, Pro, and Ultra subscriptions, and the Gemini API provider for API-key usage. These quotas are not interchangeable.

Google discontinued individual-account login to the original Gemini CLI on June 18, 2026. The Google-account route uses the official `agy` Antigravity CLI instead of attempting to copy OAuth credentials into PHOENIX.

## Windows installation

From the PHOENIX repository directory, open PowerShell and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\phoenix-google-account-setup.ps1
```

The script downloads and invokes Google's official Antigravity CLI installer only if `agy` is absent. It also installs the original Gemini CLI through npm when npm is available, for API-key or organization workflows. Installing Gemini CLI is optional and does not restore personal-account OAuth in Gemini CLI.

Start the terminal CLI with `agy`, authorize your own Google account using the official browser flow, then exit the CLI. Run `agy models` to inspect the model slugs your account exposes.

In PHOENIX, navigate to **Configuración → Modelos → Google Gemini · Cuenta personal**, choose **Verificar acceso con Google**, and enter `VERIFICAR` after local sign-in. The Host executes one real, sandboxed model query before saving a non-secret connection marker. The provider **Google · Gemini (cuenta)** serves models that `agy models` reports; models and subscription availability depend on the account and Google's changing catalog. It is not a model picker for Gemini API keys.

## Execution and limitations

PHOENIX runs the official `agy` executable with distinct process arguments and sends conversation content over standard input using the documented `stream-json` protocol. Tokens stay in the operating-system keyring managed by the Google application and never enter PHOENIX credentials. PHOENIX retains only a marker of a previously verified local session; a stale marker is not proof of current authorization. Reverify after native-session expiry.

The bridge currently accepts text messages and reports native token usage when available. It represents PHOENIX tool requests as structured JSON mediated by the host; the original CLI is not handed PHOENIX tool execution directly. Native model responses and tool bridging require an end-to-end check on an authenticated Windows host before the integration is considered production-ready.

The host never silently switches to Gemini API-key billing if the account session fails. Use the normal Gemini provider and a separately stored API key when that is your intended billing source.

Official references: https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals and https://antigravity.google/docs/cli/headless/ and https://antigravity.google/docs/install/.
