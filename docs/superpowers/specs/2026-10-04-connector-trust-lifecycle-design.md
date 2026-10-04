# Connector trust, authorization, repair, and lifecycle design

Date: 2026-10-04
Status: Approved in-chat design; implementation pending written-spec review

## Problem

Phoenix currently mixes three concerns in the Connectors experience:

1. a curated catalog of known integrations,
2. search results from the Official MCP Registry,
3. live authorization/runtime state.

This creates several user-visible failures:

- searching for a known vendor such as Canva can surface a registry-listed server that is not verified as the vendor's official connector;
- known OAuth integrations can appear as generic installable MCPs instead of directly offering their registered authorization flow;
- managed MCP installations expose install/state operations but no generic uninstall action in Settings;
- runtime failures can leave a connector appearing installed even when it is unusable;
- authorization flows and catalog actions can diverge, leaving "Authorize" or "Find / install" actions visually present but operationally dead.

Phoenix already has the correct security foundations in parts of the stack:
- Official MCP Registry search is Host-proxied and labels provenance as registry-listed rather than vendor-verified.
- Managed MCP install re-resolves the selected registry identity Host-side before accepting a Streamable HTTP endpoint.
- Managed MCP persistence already has internal removal/rollback machinery.
- Registered authorization entries already expose OAuth flows through the Host.

The design below unifies those pieces into one explicit connector lifecycle.

## Goals

1. Known Phoenix integrations resolve from a curated trusted connector definition before generic registry search.
2. Vendor identity and registry provenance are never conflated.
3. Known OAuth connectors are ready to authorize without requiring generic MCP search first.
4. Registry-discovered connectors remain available for unknown services, but are labeled as registry-listed and unverified as vendor-official.
5. Every Phoenix-managed MCP can be removed from persistence and unloaded from the live runtime.
6. Broken managed connectors are represented as broken, not merely installed.
7. Broken managed connectors can be repaired by re-resolving their trusted source and replacing the managed runtime entry.
8. Private owner connectors, currently EvolucionRD and KIRA Juancito Secure, remain explicitly private and are not subjected to public-vendor verification rules.
9. Models settings no longer own connector authentication flows; they may link to Connectors for connection management.

## Non-goals

- Phoenix will not infer that any package/server is vendor-official from its display name alone.
- Phoenix will not execute arbitrary package URLs from browser search results.
- Phoenix will not silently install or repair third-party connectors without explicit user action.
- This change does not redesign the entire Settings UI.
- Private connectors are not published to or verified against the Official MCP Registry.

## Connector identity model

Each curated connector definition gains an explicit provenance/lifecycle contract.

### Provenance classes

- `vendor-official`
  - Phoenix has a pinned/known integration identity for the vendor.
  - Examples: Canva, GitHub, Google Workspace family, Coursera, Devpost, Supabase when Phoenix has a known official adapter/endpoint.
- `registry-listed`
  - Result came from `registry.modelcontextprotocol.io`.
  - This proves registry listing only, not that the named vendor published it.
- `private-owner`
  - Owner-local integration explicitly configured by the Phoenix owner.
  - Initial allowlist: EvolucionRD and KIRA Juancito Secure.
- `native`
  - Capability is built into Phoenix and does not depend on external connector installation.

### Known connector resolution order

When the user searches:

1. match curated Phoenix connector definitions first;
2. show the curated result with its real configured auth/install action;
3. only query the Official MCP Registry for:
   - unmatched search terms, or
   - an explicit "search registry" secondary action;
4. never let a registry result impersonate a curated vendor connector with the same friendly name.

For known connectors, generic registry results with a colliding vendor label remain hidden behind an explicit registry-results section and carry the `registry-listed` warning.

## Auth behavior

A curated connector definition may declare one of:

- `oauth`
- `mcp-oauth`
- `mcp-keyless`
- `api-key`
- `native`
- `private`

### OAuth

The card must bind directly to the matching Host authorization entry.

States:
- Not connected -> `Authorize`
- Authorization pending -> `Authorizing…`
- Connected -> `Reconnect` and `Disconnect`
- Authorization failed -> `Retry authorization`
- Grant exists but runtime is unavailable -> `Reconnect required`

No OAuth connector should display "API key missing" unless its configured auth mode is actually API-key based.

### MCP OAuth

If the official integration requires a managed MCP plus OAuth:

1. install/activate the pinned trusted MCP definition;
2. refresh Host state;
3. expose `Authorize` immediately if runtime reports `auth-required`;
4. after authorization, refresh state and show `Connected`.

The user should never need to search for the same connector again after installation.

## Managed MCP lifecycle

The browser-facing MCP client gains generic methods:

- `install(request)`
- `remove({ entryId })`
- `repair({ entryId })`
- `state()`

### Remove

The Host exposes a generic managed-MCP removal operation that:

1. validates the requested `entryId` belongs to the Phoenix-managed MCP overlay;
2. removes it from persistent managed config first;
3. attempts to unload the live Loader entry;
4. reports whether persistence removal succeeded and whether live unload succeeded;
5. never removes unmanaged/user-authored plugin entries.

The existing internal `removeManagedRows` behavior remains the persistence primitive.

### Repair

Repair is allowed only for connectors whose managed source can be reconstructed safely.

For registry-managed entries Phoenix persists source metadata sufficient to re-resolve the original registry identity. For curated vendor-official entries Phoenix uses the pinned curated definition.

Repair flow:

1. identify the managed source;
2. re-resolve the expected endpoint/definition;
3. remove the broken managed entry from persistence;
4. unload the live entry if present;
5. recreate the managed connector from the re-resolved trusted source;
6. refresh runtime state;
7. if the repaired connector requires OAuth, transition to `auth-required` and offer `Authorize`.

Repair must never reuse an arbitrary stale URL merely because it was previously installed.

## Persisted metadata

Managed MCP rows need enough source metadata to support trusted repair and UI provenance without exposing secrets.

Add a source record with fields equivalent to:

- `kind: 'registry' | 'curated'`
- `registryName?`
- `registryVersion?`
- `connectorId?`

Migration behavior:
- legacy managed rows without source metadata remain removable;
- they are repairable only if Phoenix can map them unambiguously to a curated definition or a current registry candidate by exact endpoint and identity;
- otherwise UI offers `Uninstall`, not `Repair`.

## Runtime health model

Settings derives one lifecycle state per connector:

- `available`
- `installing`
- `installed`
- `auth-required`
- `authorizing`
- `connected`
- `reconnect-required`
- `failed`
- `repairing`
- `removing`

A managed entry with runtime status `failed` must render as `Broken` / `Failed`, never merely `Installed`.

A managed entry present in persistence but absent from runtime is treated as `Broken` unless the Host explicitly reports it as intentionally stopped.

## UI behavior

Each connector card exposes only actions valid for its current lifecycle.

Examples:

- Gmail known OAuth:
  - `Authorize`
- Canva known official OAuth/MCP:
  - `Install` if required
  - then `Authorize`
- Connected connector:
  - `Reconnect`
  - `Disconnect`
- Managed healthy MCP without account auth:
  - `Installed`
  - `Uninstall`
- Failed managed MCP:
  - `Broken`
  - `Repair`
  - `Uninstall`
- Registry-only search result:
  - `Registry-listed · vendor not verified`
  - `View source`
  - `Install`

Buttons must not render enabled unless their backing Host capability is present. Unsupported actions render an explanatory unavailable state instead of a dead button.

## Private owner connectors

EvolucionRD and KIRA Juancito Secure are explicitly classified as `private-owner`.

Rules:

- do not require public vendor provenance;
- do not replace them with public registry search results;
- preserve their configured connector implementation;
- allow normal connected/disconnected health display;
- only show uninstall if they are Phoenix-managed removable entries;
- do not expose their private implementation details to public registry search.

The private connector allowlist should be represented as explicit metadata rather than inferred from display names where possible.

## Official-source policy

For curated public integrations, Phoenix stores an expected provider identity and supported auth/install mode.

A registry result may supplement a curated integration only when the curated definition explicitly says that the Official MCP Registry identity is its accepted source.

A display-name match alone is never sufficient.

This prevents:
- a third party publishing a server titled "Canva" from being treated as Canva;
- a similarly named GitHub, Google, Slack, or other connector from inheriting vendor trust;
- search ranking from changing the connector Phoenix installs for known vendors.

## Error handling

### Installation failure

If managed creation or persistence fails:
- roll back live activation when possible;
- return an error;
- do not report installed.

If persistence succeeds but later runtime health becomes `failed`:
- state becomes `Broken`;
- UI offers repair/uninstall.

### Uninstall partial failure

Persistence removal is authoritative. If live unload fails:
- report "removed from persistent config; live unload failed";
- do not re-add the connector automatically;
- the entry must not return on next Phoenix start.

### Repair failure

If source re-resolution fails:
- leave the connector uninstalled if removal already occurred only when the operation can guarantee no silent privilege retention;
- return a detailed repair error;
- do not fall back to arbitrary previous URLs.

## Security invariants

1. Browser requests never supply executable commands, arbitrary environment variables, or arbitrary install URLs.
2. Registry installs continue to be re-resolved Host-side.
3. Vendor-official status comes only from Phoenix curated metadata, never display names.
4. Private-owner status is explicit.
5. Generic remove accepts only IDs present in the Phoenix-managed overlay.
6. OAuth secrets remain Host-side.
7. Uninstall removes persistence before live unload so failed unload cannot resurrect access after restart.

## Main implementation areas

Expected files/components include:

- `packages/client/ui-settings-models/src/client/connector-catalog.ts`
  - provenance and source/auth metadata.
- `packages/client/ui-settings-models/src/client/AuthorizationPanel.tsx`
  - trusted search precedence, lifecycle rendering, repair/remove actions.
- `packages/host/plugin-inventory/src/mcp-registry.ts`
  - continue registry provenance behavior; no vendor-verification inference.
- `packages/host/plugin-inventory/src/mcp-managed.ts`
  - source metadata, generic remove, generic repair.
- `packages/host/plugin-inventory/src/index.ts`
  - browser-safe remove/repair Remote endpoints.
- Host/client API contract types for new lifecycle operations.
- Existing connector/settings tests.

## Test plan

### Trust and search

- searching `Canva` returns the curated Canva card before generic registry results;
- a registry server titled `Canva` is labeled registry-listed and not vendor-official;
- known connectors do not require generic registry search to expose their configured Auth action;
- private EvolucionRD and KIRA Juancito Secure remain private-owner connectors.

### Authorization

- curated OAuth card calls the matching registered authorization entry;
- OAuth completion refreshes catalog/runtime state;
- failed/cancelled authorization restores actions;
- no OAuth card displays API-key messaging unless configured for API-key auth.

### Install

- registry install still re-resolves the exact registry identity Host-side;
- curated MCP install uses only its pinned/accepted source;
- install failure does not leave UI in installed state.

### Runtime health

- persisted + ready runtime -> installed/connected as appropriate;
- persisted + auth-required -> authorize;
- persisted + failed runtime -> broken;
- persisted + missing runtime -> broken.

### Remove

- generic remove deletes only the requested Phoenix-managed row;
- persistence is removed before live Loader unload;
- partial live-unload failure does not restore persistence;
- UI refreshes and returns to available state.

### Repair

- repair of registry-managed connector re-resolves registry identity;
- repair of curated connector uses pinned curated definition;
- legacy ambiguous entries are not repairable and expose uninstall only;
- repaired OAuth MCP transitions to authorization when required.

### Regression

- existing Binance/X special lifecycle tests remain green;
- Official MCP Registry provenance tests remain green;
- connector authorization popup tests remain green;
- Settings snapshots reflect the new actions and labels.

## Rollout

1. Implement and verify on a feature branch from current `main`.
2. Run focused connector/registry/authorization tests.
3. Run the repository test/build gates required by Phoenix.
4. Merge to `main`.
5. Promote the same verified tree to `stable`.
6. Confirm `main` and `stable` reference equivalent content before reporting completion.
