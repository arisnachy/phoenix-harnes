# PHOENIX Intelligent UI Kit — App Studio

The App Studio interface is a declarative, app-scoped extension to PHOENIX's existing React, theme-token and Lucide UI packages. It is **not** a second frontend framework, a remote component loader, or a backend generator.

## Existing, bundled foundations

- `@phoenix-ai/dsh-client-ui-primitives` supplies styled `Input`, `Button`, `Pill`, `Modal`, `PhoenixUiIcon` and status atoms. Reuse these instead of shipping a parallel design system.
- PHOENIX theme tokens (`--dsw-*`) and the existing App Studio palette (`pearl`, `ocean`, `sage`, `iris`, `amber`) supply adaptive light/dark-compatible colors and focus rings.
- App Studio's form editor and new visual builder are rendered *inside* each generic application section, above the normal PHOENIX chat composer. The general shell, model selector and protected clinical entry remain independent.

## Current visual components

| Kind | Purpose | Current readiness |
| --- | --- | --- |
| `metric` | KPI and state panel | Metadata-only empty state |
| `card` | Summary/action layout | Metadata-only preview |
| `avatar` | Profile/identity layout | Placeholder, no user data |
| `table` | Records/reporting layout | No connected data or filters |
| `chart` | Analytic plot layout | Decorative scaffold, no numeric data |
| `calendar` | Date/agenda layout | Placeholder, no events |
| `timeline` | Workflow sequence | Placeholder, no workflow |
| `alert` | Informational notice | Placeholder, no live alerts |

The builder lets the user add, rename, resize to half/full width, reorder and remove components. It saves **only** `id`, `kind`, `title`, `span` and a structural revision in generic-app browser storage. It keeps a validated backup and pre-change rollback. A preview is not a connected service.

## Kira / Sol / Luna workflow

1. The user chooses **Apps / Espacios → Crear nueva aplicación con Kira** and describes the app. Kira coordinates requirements and the existing Sol/Luna execution path.
2. The user installs an inert `adaptive_app` manifest and opens one of its sections.
3. A section's **Personalizar diseño** editor edits its local visual components. The existing form editor adds fields without persisting entered values.
4. **Inspeccionar capacidades con Kira** sends only bounded structural metadata, including real visual widget IDs and revision numbers. It does **not** enumerate clinical records.
5. Kira may propose a strict `adaptive_control` v1 JSON block with `add-widget`, `remove-widget`, `rename-widget`, `move-widget`, or `set-widget-span`; the client independently validates and previews before a second user click applies it. Stale revisions fail.
6. Data binding and automation remain separate from visual configuration. An installed program or registered connector is not a permission grant.

Example model proposal, to be generated from an inspected *real* app and section, never with guessed IDs:

```json
{
  "component": "adaptive_control",
  "version": 1,
  "props": {
    "appId": "app-inventario",
    "sectionId": "inicio",
    "operation": "add-widget",
    "widgetKind": "table",
    "label": "Existencias",
    "span": "full",
    "expectedRevision": 0
  }
}
```

## Next integrations / optional libraries

The **installed PHOENIX primitives are the release baseline**. Do not add all third-party UI packages at once: that would inflate the desktop bundle, duplicate token systems and introduce supply-chain/update risk.

- Radix UI / shadcn/ui: import individual accessible advanced controls only when a specific interaction is missing in the current PHOENIX primitives. Use native PHOENIX theme tokens rather than a global Tailwind reset.
- React Hook Form + Zod: prospective schema-driven validation with per-app isolation, versioned migrations and error summaries. Not installed or enabled by this change.
- TanStack Table: real sorting/filtering/virtualization once there is an authorized data source. Not installed by this change.
- Recharts: sourced numerical dashboards, not unsourced chart previews. Not installed by this change.
- Motion: optional microinteractions respecting `prefers-reduced-motion`, not installed by this change.

## Safety and verification

No patient values, credentials, raw API responses or code are accepted in visual manifests. The clinical Healthia service (/health and /health/patient), role authorization and records are not written by App Studio. A theme and layout action never implies authorization to run an API, OS command or AI tool.

Focused checks: `pnpm run test:adaptive:ui` and `pnpm run test:adaptive:all`; also run the UI build and Windows desktop workflows in CI. Do not promote these PRs to stable or claim clinical production readiness until all required checks pass.
