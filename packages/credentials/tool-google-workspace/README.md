# @phoenix-ai/dsh-tool-google-workspace

English | [中文](README.zh.md)

Model-facing Gmail, Google Calendar, Google Drive, and bounded advanced Google Workspace tools over the Host-owned `ctx.googleApi` broker. This package never receives an OAuth access token, refresh token, authorization code, PKCE verifier, or arbitrary destination URL: the Host broker fixes each Google API root and required scope and injects the Bearer token only at the final network boundary.

The dedicated tools cover Gmail search/read/send, Calendar event listing/creation, and Drive search. `google_workspace_request` is the escape hatch for Docs, Sheets, Slides, Contacts, and Workspace operations not yet represented by a dedicated tool; it still accepts only one enumerated Google service and a relative path under that service.

## Model Experience

### Connected Google Workspace tools

#### What the model sees

When the package and `googleApi` service are mounted, the model receives stable JSON tool schemas for practical Gmail, Calendar, and Drive actions plus the bounded advanced request tool. The model sees only operation arguments and secret-free API results. Authorization is performed by the human through Phoenix Settings and remains outside the model request.

##### Tool schemas

```markdown
See the generated Google Workspace entries in [the tool catalog](../../../docs/tool-catalog.md#phoenix-aidsh-tool-google-workspace).
```

#### Token effect

Loaded tool schemas add a fixed prompt cost. Google account data enters the conversation only after an explicit tool call and large response bodies are bounded before rendering.

#### KV Cache effect

Tool definitions remain prefix-stable while the package is mounted. OAuth state never enters the reusable prefix; API results append after the tool call.

## Known Limitations and Deferred Work

- Google OAuth survives normal Phoenix restarts through the Host-owned durable grant and silent token refresh. The default local credential provider is owner-only but not isolated from deliberately malicious same-UID processes; deployments needing that stronger boundary should use an OS-isolated provider.
- Google installed applications request the configured Workspace scope set in one consent ceremony; a capability whose scope was not granted fails closed and requires an explicit reconnect to change consent.
- The dedicated high-level surface currently focuses on Gmail, Calendar, and Drive. Docs, Sheets, Slides, Contacts, and less common operations use `google_workspace_request` until dedicated tools are added.
- The advanced request tool deliberately does not accept arbitrary URLs, caller authentication headers, cookies, or caller-selected OAuth scopes.
