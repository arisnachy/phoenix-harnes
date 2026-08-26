# Fallback gratuito de búsqueda web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que PHOENIX continúe la investigación con Chrome/Bing/DuckDuckGo cuando el proveedor web primario falle por créditos, cuota o disponibilidad.

**Architecture:** Mantener `ctx.web` como dueño de selección y añadir una política de fallback explícita, con proveedores separados para navegador y HTTP gratuito. Clasificar errores recuperables en la capa web, preservar el vocabulario normalizado y evitar cualquier secreto en errores o trazas.

**Tech Stack:** TypeScript ESM, Cordis, Vitest, Playwright/Chrome dedicado, fetch y HTML fixture.

---

### Task 1: Capturar la regresión en selección de fallback

**Files:**
- Modify: `packages/web/web/tests/web.spec.ts`
- Modify: `packages/web/web/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Añadir pruebas para que un proveedor primario que rechaza con error recuperable permita que el proveedor fallback responda, mientras que cancelación y errores de configuración no se oculten.

- [ ] **Step 2: Run focused tests**

Run: `pnpm exec vitest run packages/web/web/tests/web.spec.ts`
Expected: FAIL porque `ctx.web.search()` actualmente solo ejecuta el proveedor seleccionado.

- [ ] **Step 3: Implement minimal policy seam**

Añadir registro/configuración de fallback y clasificación de errores recuperables sin cambiar aún los proveedores concretos. La selección debe conservar la prioridad del proveedor configurado y deduplicar intentos.

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run packages/web/web/tests/web.spec.ts`
Expected: PASS.

### Task 2: Crear el proveedor de navegador dedicado

**Files:**
- Create: `packages/web/web-search-browser/package.json`
- Create: `packages/web/web-search-browser/src/types.ts`
- Create: `packages/web/web-search-browser/src/provider.ts`
- Create: `packages/web/web-search-browser/src/index.ts`
- Create: `packages/web/web-search-browser/tests/browser.spec.ts`
- Create: `packages/web/web-search-browser/tests/browser.e2e.ts`

- [ ] **Step 1: Write fixture-based failing tests**

Cubrir extracción de resultados, deduplicación, límite, timeout, cierre del contexto y ausencia de Chrome usando un driver inyectable.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run packages/web/web-search-browser/tests/browser.spec.ts`
Expected: FAIL because the package and provider do not exist.

- [ ] **Step 3: Implement the provider**

Usar una interfaz pequeña de driver para aislar Playwright, abrir un contexto persistente con perfil dedicado configurable, navegar Bing y DuckDuckGo en orden, extraer solo URL/título/snippet, aplicar `maxResults`, cerrar recursos en `finally` y devolver `available() === false` cuando el runtime no pueda iniciarse.

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run packages/web/web-search-browser/tests/browser.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run browser smoke when available**

Run: `pnpm exec vitest run packages/web/web-search-browser/tests/browser.e2e.ts`
Expected: PASS with Chrome instalado; otherwise explicit skip with reason.

### Task 3: Añadir ruta HTTP gratuita de respaldo

**Files:**
- Create: `packages/web/web-search-free/src/provider.ts`
- Create: `packages/web/web-search-free/src/index.ts`
- Create: `packages/web/web-search-free/tests/free-search.spec.ts`
- Modify: `packages/web/web/README.md`

- [ ] **Step 1: Write failing parser/provider tests**

Probar Bing fixture, DuckDuckGo fixture, redirección segura, HTML sin resultados, anti-bot y deduplicación.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run packages/web/web-search-free/tests/free-search.spec.ts`
Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement HTTP fallback**

Usar `fetch` con timeout y `AbortSignal`, allowlist de motores, parseo limitado de HTML, URLs absolutas, no seguir credenciales embebidas y clasificación como `WebError` recuperable cuando el motor bloquee o no produzca resultados.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run packages/web/web-search-free/tests/free-search.spec.ts`
Expected: PASS.

### Task 4: Montar la cadena en la composición oficial

**Files:**
- Modify: `packages/bundle/base/cordis.patch.yml`
- Modify: `packages/web/tool-web/src/search.ts`
- Modify: relevant generated catalogs
- Modify: `packages/web/web-search-free/tests/free-search.spec.ts`

- [ ] **Step 1: Add loader regression test**

Boot the real base composition with a failing paid provider and deterministic browser/free providers; assert the final result and the non-sensitive attempted-provider metadata.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run packages/web/web-search-free/tests/free-search.spec.ts packages/web/web/tests/web.spec.ts`
Expected: PASS after the fallback chain is wired.

- [ ] **Step 3: Wire providers and bounded prompt guidance**

Enable the fallback only when configured or when the primary fails with a recoverable code. Keep provider selection explicit and avoid adding large prompt text; the tool should report the route used in its result metadata.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run packages/web/web-search-free/tests/free-search.spec.ts packages/web/web/tests/web.spec.ts`
Expected: PASS.

### Task 5: Validate full quality and promotion boundary

**Files:**
- Modify: `docs/architecture.md` if the provider-selection contract changes
- Create: `.agents/notes/implemented/architecture/YYYY-MM-DD-web-search-free-fallback.md`

- [ ] **Step 1: Run focused web suites**

Run: `pnpm exec vitest run packages/web packages/bundle/base`
Expected: PASS with explicit skips only for missing Chrome/real network.

- [ ] **Step 2: Run static and artifact checks**

Run: `pnpm run typecheck`, `pnpm run build`, `pnpm run verify-cordis-config`, `pnpm run verify-tool-catalog`, `pnpm run verify-config-catalog`
Expected: PASS; generated catalogs updated rather than excluded.

- [ ] **Step 3: Run browser/live verification**

Run the dedicated Chrome smoke against Bing and DuckDuckGo, capture normalized source output, confirm no secrets, and record the exact provider route.

- [ ] **Step 4: Commit on `main`**

```sh
git add packages/web packages/bundle/base docs .agents/notes
git commit -m "feat(web): fall back to free browser search"
```

- [ ] **Step 5: Promote to `stable` only after all gates pass**

Create/update `stable` from the verified `main` commit, push both only after readback confirms the expected commit, then refresh PHOENIX using the existing update path. Never force-push or promote a failing commit.
