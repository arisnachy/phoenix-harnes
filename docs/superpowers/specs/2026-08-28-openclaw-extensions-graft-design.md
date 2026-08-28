# OpenClaw Extensions Graft Design

## Goal

Integrate the OpenClaw `extensions/` ecosystem into Phoenix as a compatibility layer that preserves Phoenix canonical runtime, security, credentials, session, jobs, HARDNESS, and Cordis contracts while allowing OpenClaw extensions to be discovered, validated, loaded, activated, and operated through Phoenix.

## Scope

This graft targets the OpenClaw `extensions/` boundary, not OpenClaw core internals. OpenClaw explicitly treats bundled extensions like third-party plugins: extensions consume public plugin SDK seams, own their runtime dependencies, expose metadata through manifests, and must not deep-import core internals. Phoenix already has `packages/extensions` with live Cordis inspection, dynamic package definition, host/browser runners, and `node:vm` isolation. The graft therefore adds a compatibility adapter rather than replacing Phoenix's runtime.

The first integration must support the complete OpenClaw extension catalog as discoverable metadata, while runtime activation is lazy and capability-gated. Extensions that cannot run because their native dependency or platform prerequisite is absent remain installed/discoverable but unavailable with an explicit diagnostic; they must never crash Phoenix startup.

## Architecture

```text
OpenClaw extension source/catalog
          |
          v
OpenClaw manifest reader
          |
          v
Phoenix manifest translator
          |
          +--------------------+
          |                    |
          v                    v
Phoenix capability catalog   compatibility diagnostics
          |
          v
OpenClaw compatibility runtime
          |
          +--> ctx.credentials / authorization
          +--> ctx.tools / HARDNESS / ATLAS
          +--> ctx.guard / approval
          +--> ctx.sandbox / dynamicCordisRunner
          +--> ctx.jobs / schedule
          +--> host/browser/node surfaces
```

Phoenix remains the only canonical control plane. No OpenClaw Gateway, session store, secret store, scheduler, approval system, or sandbox becomes a second authority.

## New Phoenix Components

### 1. `packages/extensions/openclaw-compat`

Owns the compatibility boundary. It must not import OpenClaw core internals. Its public surface is intentionally small:

- `discoverOpenClawExtensions(source): OpenClawExtensionDescriptor[]`
- `translateOpenClawManifest(manifest): PhoenixExtensionDescriptor`
- `validateOpenClawExtension(descriptor): CompatibilityReport`
- `activateOpenClawExtension(id, context): ActivationResult`
- `deactivateOpenClawExtension(id): void`

The package owns manifest parsing, compatibility checks, activation state, diagnostics, and translation from OpenClaw plugin semantics into Phoenix Cordis/capability semantics.

### 2. Catalog snapshot

A generated catalog records every directory under the pinned OpenClaw `extensions/` tree and the immutable OpenClaw commit SHA used to build it. Each entry records at minimum:

- extension id
- source path
- package name when present
- manifest path
- capability categories
- activation hints
- required secrets
- required platform/runtime dependencies
- compatibility status
- source commit SHA

The catalog is metadata-only and safe to load at Phoenix startup. Runtime code is never eagerly executed during catalog discovery.

### 3. Capability mapping

OpenClaw extension declarations map into Phoenix capabilities rather than registering a parallel plugin universe. Initial families include:

- agent protocols: `a2a`, `acpx`, `llm-task`
- memory: `active-memory`, `memory-core`, `memory-lancedb`, `memory-wiki`, `logbook`
- devices/computer use: `device-pair`, `linux-node`, `geolocation`, `browser`, `cua-computer`
- secrets: `vault`, `onepassword`
- autonomous work: `workboard`
- integration: `webhooks`, `admin-http-rpc`, `file-transfer`
- web/search: `brave`, `duckduckgo`, `exa`, `tavily`, `firecrawl`, `searxng`, `perplexity`
- documents: `document-extract`, `web-readability`
- voice/audio: `deepgram`, `elevenlabs`, `azure-speech`, `fish-audio-speech`, `talk-voice`, `voice-call`
- media generation: `image-generation-core`, `comfy`, `fal`, `runway`, `pixverse`
- observability: `diagnostics-otel`, `diagnostics-prometheus`
- coding: `codex`, `github-copilot`, `copilot`, `opencode`, `kimi-coding`, `kilocode`
- channels: WhatsApp, Telegram, Signal, Discord, Slack, iMessage, SMS, Google Chat, Teams, Matrix, Mattermost and others present in the source catalog
- model providers: OpenAI, Anthropic, Google, OpenRouter, DeepSeek, Qwen, Groq, Mistral, xAI and other present providers
- local inference: `ollama`, `lmstudio`, `llama-cpp`, `vllm`, `sglang`

ATLAS consumes the translated catalog so HARDNESS can resolve capabilities without knowing whether a provider is Phoenix-native, OpenClaw-compatible, MCP-backed, or dynamically forged.

## Source Strategy

The graft must be reproducible and must not execute mutable remote code implicitly.

1. Pin an exact OpenClaw commit SHA.
2. Generate the metadata catalog from that SHA.
3. Runtime activation may use either an explicitly installed compatible package or a repository-owned vendored snapshot produced by the importer.
4. Production runtime must never `curl | sh`, download arbitrary source on activation, or silently update extensions.
5. Updating the donor snapshot is an explicit maintenance operation that regenerates the catalog and reruns compatibility gates.

This design intentionally separates catalog completeness from activation availability. Phoenix can know about every extension in one pass while enabling only extensions whose code and dependencies are present and validated.

## Manifest Translation

OpenClaw `openclaw.plugin.json` and package metadata are translated to Phoenix descriptors. Translation covers:

- id/name/description
- activation rules
- config schema and UI hints
- commands and aliases
- tools/contracts
- channels
- providers
- secret provider integrations
- dashboard bindings/actions
- skills
- feature/capability tags

Unknown OpenClaw manifest fields are preserved as namespaced metadata and reported, not silently discarded.

## Security Model

Phoenix security remains authoritative.

### Credentials

OpenClaw sensitive fields and SecretRef integrations map to Phoenix credential references. Secret values never enter catalog metadata and never become model-visible. `vault` and `onepassword` become providers behind Phoenix credential resolution rather than separate secret authorities.

### Approvals and guards

Any extension action with external side effects routes through Phoenix guard/approval seams. OpenClaw extension code cannot bypass canonical Phoenix approval by registering a raw side-effect path.

### Sandbox

Extension runtime execution uses the existing Phoenix extension runner and sandbox policy. Platform-specific extensions may request additional capabilities, but missing capabilities fail closed with a compatibility diagnostic.

### Network

Network-using extensions declare destinations/capabilities where possible. Existing Phoenix policy remains authoritative; compatibility code does not create a general unrestricted network escape hatch.

### Startup isolation

Catalog discovery parses metadata only. No extension runtime is executed merely because Phoenix starts. Activation is explicit or targeted by capability resolution.

## Runtime Semantics

### Discovery

Phoenix loads the catalog, validates schema versions, resolves local availability, and publishes capability descriptors to ATLAS.

### Activation

When HARDNESS or a user requests a capability, ATLAS selects an implementation. If an OpenClaw extension wins selection, `openclaw-compat` validates dependencies and policy, then activates it through the Cordis extension runtime.

### Failure

Failure is extension-local. One incompatible provider/channel must not prevent Phoenix from loading. Diagnostic states are:

- `READY`
- `MISSING_DEPENDENCY`
- `MISSING_SECRET`
- `UNSUPPORTED_PLATFORM`
- `POLICY_BLOCKED`
- `INCOMPATIBLE_CONTRACT`
- `ACTIVATION_FAILED`

Failures include actionable remediation while redacting secrets.

### Deactivation

Extensions must be retractable without restarting Phoenix whenever the underlying Cordis runner supports it. Resources, listeners, jobs, and tool registrations owned by the extension must be released.

## High-Priority Compatibility Proofs

The first implementation proves different extension families rather than only providers:

1. `a2a` — channel/protocol, peer auth, task delivery.
2. `device-pair` — startup extension, command alias, QR/pairing metadata.
3. `active-memory` — hooks/tool restrictions/model selection/timeouts.
4. `vault` — SecretRef provider translated to Phoenix credentials.
5. `browser` — tool contract and skill exposure.
6. `linux-node` — platform capability gating.
7. `workboard` — large tool surface plus dashboard bindings/actions.
8. `openai` or `openrouter` — model provider family.
9. `ollama` — local provider family.
10. `telegram` or `slack` — messaging channel family.

Passing these proofs demonstrates that the compatibility layer spans the major extension contract shapes.

## Testing Strategy

### Contract tests

- parse real OpenClaw manifests from the pinned donor SHA
- translate known manifest shapes deterministically
- reject malformed manifests
- preserve unknown fields as namespaced metadata
- never expose fields marked sensitive
- ensure activation metadata does not execute plugin runtime

### Runtime tests

- activate/deactivate a minimal fixture extension
- register/retract tools without leaks
- route secret references through Phoenix credentials
- route side effects through guard/approval
- fail closed when sandbox/platform requirements are unmet
- isolate activation failures

### Donor compatibility matrix

Every catalog entry receives a machine-generated status. CI fails if an extension silently disappears from the donor snapshot, if a previously supported contract regresses, or if catalog generation is nondeterministic.

### Phoenix regression gates

At minimum run repository typecheck, unit tests for touched packages, extension subsystem tests, credentials tests, guard/sandbox tests, and the existing main CI gates. No promotion to `main` occurs with failing gates.

## Main Promotion Rules

The work is developed on `graft/openclaw-extensions`. Promotion to `main` is allowed only when:

1. the compatibility adapter is covered by tests;
2. the complete donor extension catalog is represented;
3. high-priority compatibility proofs pass;
4. no Phoenix canonical runtime is replaced;
5. secrets remain non-model-visible;
6. side-effect paths remain guard/approval controlled;
7. CI for the exact promotion head is green;
8. `main` has not advanced incompatibly; otherwise rebase/merge and rerun gates.

The final promotion may consist of multiple atomic commits but is one orchestrated graft mission. `main` must end in a coherent, buildable state; no intentionally broken intermediate commit is pushed to `main`.

## Non-Goals

- Running a second OpenClaw Gateway beside Phoenix.
- Replacing Phoenix Session, credentials, jobs, sandbox, guard, or HARDNESS.
- Eagerly activating every extension at startup.
- Granting every extension unrestricted network/filesystem/process access.
- Automatically updating donor code from OpenClaw `main`.
- Forking every extension into a Phoenix-specific copy unless compatibility requires a narrowly documented patch.

## Success Criteria

Phoenix can enumerate the complete pinned OpenClaw extension catalog, expose compatible entries to ATLAS, activate representative extensions from every major contract family through Phoenix's own runtime/security seams, isolate incompatible extensions, and keep the rest of Phoenix green. The extension ecosystem becomes an optional capability source, not a second control plane.