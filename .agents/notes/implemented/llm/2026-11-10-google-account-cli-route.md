# Google account CLI routing in PHOENIX

## Decision

Personal Google subscriptions use the official Antigravity CLI process rather than Gemini CLI consumer OAuth or an extracted Google refresh token. The LLM route name is `google-account` and it is deliberately independent of the Gemini API-key provider. Google changed consumer Gemini CLI authentication on 2026-06-18.

## Security and lifecycle

The CLI owns the browser sign-in and keyring; PHOENIX streams prompts to the subprocess through stdin rather than process arguments. A native model probe must succeed before the Host stores a credential record. That record is only a non-secret local verification marker and cannot independently authenticate another process or account. Model discovery reads `agy models`, so no unavailable model is invented. A model request does not silently switch to API-key billing when the Google session fails.

The subprocess runs without shell command interpolation, in a temporary working directory, using the CLI sandbox and bounded output/time. Requests and tool arguments remain within the standard PHOENIX LLM message and stream protocol. Tool calls are accepted only for tool names included in the current request and only with JSON object arguments. Text-only input is explicit; image/file input is rejected until proven compatible.

## Trade-offs and verification

A CLI process per PHOENIX turn adds startup overhead but avoids handling OAuth secrets and undocumented authenticated network endpoints. The bridge currently accumulates the native result event before emitting PHOENIX stream chunks; stream-json transport does not yet imply incremental UI token streaming. Structured tool calls are prompted rather than guaranteed by a native function-call API. A Windows login, model-list probe, model response, tool round trip, cancellation, and fresh-session reauthentication must be validated before production deployment. Changes to Google account quotas are controlled by Google.
