# Sidebar Update and Codex Quota Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ocultar el estado de updater no accionable y mostrar de forma segura la cuota restante de cuenta junto a `Settings` solo para rutas OpenAI/Codex.

**Architecture:** El updater seguirá siendo una proyección Host sanitizada; la UI decidirá visibilidad en `updateLabelKey` y devolverá `null` sin cambios de contrato. La cuota seguirá viviendo en `CodexQuotaRemaining`, usando el selector de modelo por sesión y `authorization.list({})`; no se copiarán módulos de `openai/codex` ni se mezclará cuota de cuenta con ocupación del contexto.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, pnpm.

---

### Task 1: Ocultar el estado de actualización pausada cuando no hay actualización accionable

**Files:**
- Modify: `packages/client/ui-settings-plugin-inventory/src/client/UpdateFooterAction.tsx:63-93`
- Test: `packages/client/ui-settings-plugin-inventory/tests/components.client.spec.tsx:160-205`

- [ ] **Step 1: Cambiar primero la expectativa del test**

En el caso parametrizado `maps localized user-facing updater copy`, cambiar el caso `{ status: 'paused' }` para esperar `undefined` y añadir una aserción de que un snapshot pausado no pinta la fila.

- [ ] **Step 2: Ejecutar el test y confirmar RED**

Run:
```powershell
pnpm exec vitest run packages/client/ui-settings-plugin-inventory/tests/components.client.spec.tsx
```
Expected: FAIL porque el código actual devuelve `updatePaused` para `paused`.

- [ ] **Step 3: Aplicar el cambio mínimo**

En `updateLabelKey`, incluir `case 'paused':` en el grupo que devuelve `undefined`. No eliminar `paused` de `PhoenixUpdateStatus` ni del Host.

- [ ] **Step 4: Ejecutar GREEN**

Run:
```powershell
pnpm exec vitest run packages/client/ui-settings-plugin-inventory/tests/components.client.spec.tsx
```
Expected: PASS, incluidos los casos de `available`, `ready`, progreso, errores y reinicio.

- [ ] **Step 5: Commit aislado**

```powershell
git add packages/client/ui-settings-plugin-inventory/src/client/UpdateFooterAction.tsx packages/client/ui-settings-plugin-inventory/tests/components.client.spec.tsx
git commit -m "fix: hide non-actionable paused update status"
```

### Task 2: Blindar y probar la cuota restante OpenAI/Codex

**Files:**
- Modify: `packages/client/ui-model-selection/src/client/CodexQuotaRemaining.tsx:45-57,97-105`
- Test: `packages/client/ui-model-selection/tests/codex-quota-remaining.client.spec.tsx:48-114`

- [ ] **Step 1: Añadir tests RED para telemetría inválida y prioridad de ventana**

Añadir al test una autorización con `usedPercent: Number.NaN` y otra con `usedPercent: 140`; ambas no deben renderizar un porcentaje inventado fuera de `0–100`. Añadir un caso donde `primaryLimit` sea inválido pero `secondaryLimit.usedPercent` sea `25`; debe mostrar `75%`.

- [ ] **Step 2: Ejecutar el test y confirmar RED**

Run:
```powershell
pnpm exec vitest run packages/client/ui-model-selection/tests/codex-quota-remaining.client.spec.tsx
```
Expected: FAIL en la validación de telemetría inválida y/o selección de fallback.

- [ ] **Step 3: Implementar validación mínima y selección segura**

Crear un predicado local `isValidRateLimit` que acepte solo objetos con `usedPercent` finito, y seleccionar el primer límite válido entre `primaryLimit` y `secondaryLimit`. Mantener `remaining` acotado a `0–100`. Si ninguno es válido, dejar `quota` como `undefined` para que el componente devuelva `null`.

- [ ] **Step 4: Ejecutar GREEN**

Run:
```powershell
pnpm exec vitest run packages/client/ui-model-selection/tests/codex-quota-remaining.client.spec.tsx
```
Expected: PASS con OpenAI/Codex, proveedor no OpenAI, cambio de proveedor, ausencia de telemetría y valores inválidos.

- [ ] **Step 5: Commit aislado**

```powershell
git add packages/client/ui-model-selection/src/client/CodexQuotaRemaining.tsx packages/client/ui-model-selection/tests/codex-quota-remaining.client.spec.tsx
git commit -m "fix: validate Codex quota telemetry"
```

### Task 3: Verificación de composición y GUI

**Files:**
- Reference: `packages/client/ui-settings/src/client/contract/slots.ts:23-30`
- Reference: `packages/client/ui-settings-general/src/client/SettingsRoot.tsx:142-153`
- Verify: `packages/client/ui-model-selection/src/client/index.ts:150-167`

- [ ] **Step 1: Ejecutar tests focales de ambos componentes**

```powershell
pnpm exec vitest run packages/client/ui-settings-plugin-inventory/tests/components.client.spec.tsx packages/client/ui-model-selection/tests/codex-quota-remaining.client.spec.tsx packages/client/ui-settings-general/tests/settings-root.client.spec.tsx
```
Expected: todos los archivos verdes.

- [ ] **Step 2: Ejecutar build y typecheck**

```powershell
pnpm build
pnpm typecheck
```
Expected: ambos comandos terminan con código 0.

- [ ] **Step 3: Refrescar la GUI existente**

Usar el perfil dedicado de Chrome en `http://127.0.0.1:3080`, confirmar que la página no está en blanco y que, sin una actualización accionable, no existe texto `Actualizaciones en pausa`. No cambiar modelo ni credenciales durante esta prueba; la cuota OpenAI/Codex quedará cubierta por el test de composición si la sesión viva no tiene esa ruta disponible.

### Task 4: Publicar, marcar lista y fusionar

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-sidebar-update-codex-quota-design.md` only if review evidence requires a correction.
- Modify: `docs/superpowers/plans/2026-08-27-sidebar-update-codex-quota.md` by checking completed steps.

- [ ] **Step 1: Revisar diff y secretos**

```powershell
git diff --check
git status --short
git diff main...HEAD --name-only
```
Confirmar que solo hay archivos del objetivo y ninguna credencial.

- [ ] **Step 2: Publicar la rama**

```powershell
git push -u origin kira/visible-progress-hardness
```

- [ ] **Step 3: Actualizar la PR #60**

Marcar la PR como lista para revisión, no draft, y verificar que el head coincide con el commit probado.

- [ ] **Step 4: Fusionar solo con checks verdes**

Usar la PR de GitHub para fusionar a `main`; si GitHub mantiene checks globales fallando por el entorno Windows, no forzar el merge y reportar el bloqueo exacto.
