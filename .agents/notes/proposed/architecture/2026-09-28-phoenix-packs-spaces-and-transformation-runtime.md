# Agent Note: Phoenix Packs, Spaces, and the transformation runtime

Status: proposed

English | [中文](2026-09-28-phoenix-packs-spaces-and-transformation-runtime.zh.md)

## Problem

PHOENIX can compose different agents per session through agent presets and can assemble different process profiles through bundles, but neither abstraction represents the product behavior we now need: one running PHOENIX should be able to become HealthIA, a pharmacy, a clinic, a supermarket, an accounting system, or another domain environment without restarting the process, rewriting the current agent composition, or mixing the data of those environments.

An agent preset is deliberately session-scoped and model-facing. A profile bundle is deliberately boot-scoped. A Workspace is deliberately a durable filesystem directory plus session membership. Reusing any one of those concepts as the new "application mode" would collapse boundaries that already protect session reconstruction, boot composition, and filesystem ownership.

The missing vocabulary is:

- a distributable domain definition that says what a PHOENIX environment offers;
- a durable local instance of that definition with its own title, configuration, state, and later federation connections;
- a fast activation path that changes the visible operating environment without reinstalling or rebooting PHOENIX;
- an offline local cache so an already installed environment never depends on the Store to open;
- a security boundary that prevents a Store item from silently becoming arbitrary trusted code.

## Proposal

Introduce two first-class concepts and one activation layer.

### Pack

A **Pack** is a versioned, installable domain definition. It contains no user records. It declares domain metadata, navigation, UI contributions, required capabilities, optional modules, data namespaces, default automation/workflow descriptors, and compatibility requirements.

A Pack is not an agent preset and is not a profile bundle. A Pack may declare that new sessions in a Space should prefer an existing agent preset, and an installer may resolve separately trusted plugin/bundle dependencies, but activating a Pack never rewrites the composition of a running non-blank session.

The first manifest version is declarative and fail-closed. Remote Store content does not gain arbitrary executable authority merely by being downloaded. Executable dependencies, when added, require a separate explicit install/trust step and remain ordinary PHOENIX plugins/bundles subject to the existing loader and trust boundaries.

Conceptual manifest:

```yaml
schemaVersion: 1
id: healthia
version: 1.0.0
name: HealthIA
category: healthcare

navigation:
  - dashboard
  - patients
  - consultations
  - laboratories
  - medications

modules:
  - healthia-clinical
  - healthia-devices

requirements:
  capabilities:
    - scheduler
    - vault
    - multimodal

sessionDefaults:
  agentPreset: healthia
```

The exact wire/on-disk schema is owned by the Pack package and versioned independently from Store transport.

### Space

A **Space** is a durable local instance of one base Pack plus zero or more enabled module Packs. It is the thing the user switches between.

A Space owns identity and configuration for one operational environment, but domain packages own their own business data. Federation owns connection records. The Space record therefore stores references and lifecycle metadata, not a giant arbitrary domain-data blob.

Initial conceptual record:

```ts
interface SpaceRecord {
  id: SpaceId
  title: string
  basePack: PackRef
  modules: readonly PackRef[]
  workspaceId?: WorkspaceId
  createdAt: string
  updatedAt: string
}
```

A Space may reference an existing Workspace when that environment has a filesystem project, but neither entity contains or replaces the other. Deleting a Workspace does not delete its Space, and deleting a Space does not remove a filesystem directory.

The built-in default is a system-owned **Phoenix General** Space backed by the General Pack. A clean install always has a valid place to return to even when no Store exists and no optional Pack is installed.

### Activation

Activation selects one Space for one client surface and projects its Pack descriptors into the shell. It does not restart the PHOENIX process, re-run package installation, or globally mutate every connected client.

The host owns the durable Space and Pack registries. The client owns its currently active Space selection and sends `spaceId` explicitly when a domain operation needs it. This avoids making one browser's navigation choice a process-global fact and leaves room for multiple clients to use different Spaces against one host.

Activation resolves only local installed Pack data. Network discovery and Store update checks are never on the activation critical path.

The first product surfaces are:

- a compact Space switcher in the sidebar/header, for example `Phoenix General ▾`;
- `Ctrl+K` search over installed Spaces;
- `/space <name>` as a deterministic no-model command;
- restore the last active Space for that client;
- later, natural-language requests such as "Kira, abre HealthIA" may produce an explicit Space-switch action, but PHOENIX does not silently switch domains merely because a classifier guessed one.

### Pack Store and local cache

The Store is a discovery and distribution service, not the runtime source of truth.

```text
Phoenix Store
    |
    | discover / install / update
    v
Local Pack Registry + Versioned Cache
    |
    | resolve locally
    v
Space
    |
    | activate
    v
Phoenix Shell
```

Installed Packs remain usable offline. Pack versions are retained while any Space still references them; an update is staged beside the active version and becomes the Space's selected version only after compatibility and migration checks succeed. Rollback therefore remains possible without redownloading the previous Pack.

The local root is derived from Harness home by the owning package; callers never build an absolute path themselves. The proposal intentionally does not hardcode a Windows path into the contract.

### Package topology

The intended source ownership is:

| Package | Responsibility |
| --- | --- |
| `packages/pack/pack/` | Pack types, manifest validation, compatibility vocabulary, registry service definition |
| `packages/pack/pack-local/` | trusted local installed-Pack provider/cache |
| `packages/space/space/` | durable Space registry over `storage-domain` |
| `packages/client/ui-space-switcher/` | switcher/search/manage entry surfaces |
| `packages/client/ui-space-shell/` | projects the active Pack into navigation/layout slots |
| `packages/pack/pack-store/` | later Store discovery/install/update provider |
| `packages/federation/*` | later node identity, pairing, capabilities, event mesh, audit; keyed by `SpaceId` where the relationship belongs to one Space |

Names may be adjusted during implementation if an existing package clearly owns the responsibility, but the ownership boundaries above remain: Pack definition, Space persistence, client activation, Store transport, and Federation are separate seams.

### Relationship to existing PHOENIX abstractions

- **Agent preset:** chooses model-facing composition for a session. A Space may suggest one for a new/blank session; it does not replace the preset system.
- **Profile/bundle:** chooses process boot composition and installed plugin code. Pack activation does not replace boot composition.
- **Workspace:** owns a filesystem directory and session grouping. Space may reference it.
- **Settings:** stores user preferences; it may store switcher preferences but is not the Space database.
- **Client module loader:** remains the browser code-loading mechanism. Space UI must compose through the existing slot system rather than adding a parallel component framework.
- **Living/HARDNESS:** Packs may declare required capabilities, but those existing registries remain the authorities for whether a capability actually exists and works.

### Storage and isolation

`dsh-space` uses a dedicated `storage-domain` domain with a versioned schema. Space deletion removes only the Space record and Space-owned presentation/configuration state. Domain business records are deleted only through the owning domain's explicit lifecycle.

A Pack has no direct path to another Space's domain records. Every domain operation that is Space-scoped accepts a branded `SpaceId` at the owning boundary rather than relying on a process-global "current Space."

This becomes the foundation for Federation: a clinic's connection to a laboratory or a patient's connection to a doctor can be owned by a Space and revoked without granting access to unrelated Spaces.

## Delivery phases

### Phase 0 — Contract and guards

- land this Agent Note;
- define the `PackId`, `PackRef`, and `SpaceId` branded vocabulary;
- define v1 Pack manifest validation;
- define the Space durable schema and lifecycle semantics;
- add tests that reject malformed ids, unknown Pack versions, and cross-Space references.

### Phase 1 — Local Spaces

- implement `ctx.spaces` / Space registry over `storage-domain`;
- ship `Phoenix General` as the immutable fallback Space;
- implement create/list/rename/delete and last-active-client selection;
- expose read-only Space roster RPC before authoring/install RPCs.

At the end of this phase PHOENIX can switch between locally defined Spaces, although every Space may still look like General.

### Phase 2 — Transformation shell

- add the Space switcher and `Ctrl+K` selection;
- add `/space` command dispatch;
- add Pack-driven navigation and layout contributions through existing client slots;
- preserve independent UI state per Space;
- restore the prior Space without reloading the page.

The installed-Pack activation target is p95 below 250 ms for the shell/navigation projection on the reference local desktop, excluding optional lazy domain data fetches.

### Phase 3 — Local Pack registry

- add versioned local Pack installation/cache;
- support `system`, `verified`, `community`, and `user` trust metadata without equating metadata with execution authority;
- stage Pack upgrades and retain referenced old versions;
- add HealthIA as the first substantial Pack and a small non-health Pack as the genericity proof.

### Phase 4 — Store

- remote catalog/search;
- download and signature/integrity verification;
- dependency/compatibility resolution;
- explicit installation;
- staged updates and rollback;
- no network requirement for activation.

The Store starts free and may support multiple catalogs later; the runtime contract does not depend on one commercial backend.

### Phase 5 — Space-aware automation and agents

- new sessions may inherit a Space's preferred agent preset;
- tools and workflows receive explicit Space context where needed;
- a non-blank running session never silently changes model-facing composition when the shell switches Space;
- add explicit "move/new session in this Space" UX instead of mutating historical semantics.

### Phase 6 — Phoenix Federation

- node identity;
- one-time pairing code / QR;
- capability grants;
- pause, disconnect, revoke;
- event mesh;
- signed audit receipts;
- offline queue/reconciliation.

HealthIA ONE, doctors, clinics, laboratories, pharmacies, retail, inventory, accounting, and other verticals all consume this same Federation seam rather than inventing domain-specific connection systems.

## Alternatives considered

**Reuse agent presets as application presets.** Rejected because agent presets deliberately control model-facing per-session composition. Turning them into durable business environments would couple UI navigation, domain data, and connection state to a session mechanism whose reconstruction rules prohibit casual mid-history switching.

**Reuse profile bundles and restart PHOENIX on every transformation.** Rejected because a profile is boot composition. Restarting makes switching slow, interrupts work, and makes two clients unable to inhabit different environments concurrently.

**Extend Workspace until it means Space.** Rejected because Workspace has a precise filesystem ownership contract. Many valid Spaces have no project directory, and a single directory may participate in several operational Spaces.

**Make the Store the source of truth and stream Packs on demand.** Rejected because transformation must remain fast and offline-capable. The Store distributes; the local registry executes the already installed definition.

**Allow downloaded Packs to execute arbitrary code immediately.** Rejected because a discovery catalog must not become a remote-code-execution channel. Declarative manifests and executable plugin installation have different trust consequences and therefore separate approval paths.

**Create one Pack for every combination of modules.** Rejected because `Clinic + Accounting + Inventory` would explode into combinatorial package variants. A Space composes one base Pack and optional module Packs instead.

## Acceptance criteria

- A clean installation always exposes and can activate `Phoenix General`.
- Switching an already installed Space performs no network request and no process restart.
- Two Spaces using the same Pack keep independent configuration and UI state.
- A Space can reference but never subsume a Workspace.
- Switching the shell does not recompose a non-blank session.
- Pack manifests are versioned and validated at the durable/download boundary.
- Store installation cannot grant arbitrary executable authority without a distinct explicit trust/install path.
- Removing or updating a Pack cannot strand an existing Space without a reported migration/compatibility decision.
- The implementation adds focused unit coverage plus a keyless assembled-web snapshot for the Space switcher/transformation path.
- HealthIA and at least one non-health Pack use the same core APIs without core-domain conditionals such as `if (healthia)`.

## Risks

**Scope explosion.** Packs, Spaces, Store, and Federation are large enough to become a rewrite. Delivery stays phased; Federation does not enter the first Space/Pack implementation slice.

**Dynamic plugin lifecycle collisions.** Existing Cordis and client module lifecycles remain authoritative. The first Pack contract favors declarative contributions over inventing a second plugin loader.

**Supply-chain risk.** A community Store can distribute malicious metadata or dependencies. Integrity, provenance, permissions, and executable installation remain explicit and fail closed.

**Data migration.** A Pack update may change domain schemas. Version activation must be staged; a new Pack version is not automatically a domain-data migration license.

**Current-Space leakage.** A process-global current Space would eventually leak data between clients or businesses. The contract therefore uses explicit branded `SpaceId` at domain boundaries and keeps activation client-scoped.
