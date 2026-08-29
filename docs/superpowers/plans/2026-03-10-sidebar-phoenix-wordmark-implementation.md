# Sidebar PHOENIX Wordmark Implementation Plan

English | [中文](2026-03-10-sidebar-phoenix-wordmark-implementation.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajustar únicamente el wordmark `PHOENIX` del panel lateral para que se vea como una marca sans-serif horizontal, compacta y seminegrita al estilo de la referencia de ChatGPT.

**Architecture:** Se conserva `PhoenixBrandName` sin cambios para no afectar el hero. El sidebar seguirá controlando la presentación mediante `.brandName` en su módulo CSS; la corrección será local, sin cambiar slots, emblema, accesibilidad ni comportamiento.

**Tech Stack:** React, TypeScript, CSS Modules, Vitest, Vite, pnpm.

---

### Task 1: Añadir una prueba focal del estilo lateral

**Files:**
- Modify: `packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx`

- [ ] **Step 1: Añadir una aserción de estilo al caso de wordmark expandido**

En el caso que ya verifica el logo lateral expandido, localizar el elemento del nombre de marca y añadir aserciones para que el contrato visual sea explícito:

```ts
const brandName = screen.getByText('PHOENIX', { exact: true })
expect(brandName).toHaveClass(styles.brandName)
expect(brandName).toHaveStyle({
  fontFamily: expect.stringContaining('ui-sans-serif'),
  fontWeight: '650',
  letterSpacing: '-0.03em',
})
```

Si el test actual no expone `styles` o el elemento no usa ese selector directamente, conservar la estructura existente del test y verificar el nodo mediante `container.querySelector('[class*="brandName"]')`, sin cambiar el comportamiento del componente.

- [ ] **Step 2: Ejecutar solo la prueba focal y confirmar que falla por el estilo aún no implementado**

Run: `pnpm exec vitest run packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx`

Expected: el test puede fallar en las propiedades visuales nuevas; no modificar el test para ocultar ese fallo.

### Task 2: Implementar el wordmark compacto en el sidebar

**Files:**
- Modify: `packages/client/ui-sidebar/src/client/SidebarRoot.module.css:144-154`

- [ ] **Step 1: Aplicar el estilo sans-serif localizado**

Actualizar solo `.brandName` para que quede así, preservando el layout existente:

```css
.brandName {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 34px;
  color: var(--dsw-alias-label-primary);
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 19px;
  font-weight: 650;
  line-height: 24px;
  letter-spacing: -0.03em;
  white-space: nowrap;
}
```

No modificar `.fallbackBrandName`, `.brandIdentity`, el hero ni `packages/client/ui-brand-official/src/client/Brand.tsx`.

- [ ] **Step 2: Ejecutar la prueba focal y confirmar que pasa**

Run: `pnpm exec vitest run packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx`

Expected: PASS, incluyendo la aserción del estilo del wordmark.

- [ ] **Step 3: Ejecutar el verificador de branding existente**

Run: `pnpm run verify-phoenix-branding`

Expected: PASS, sin cambios de identidad o recursos de marca.

### Task 3: Construir y verificar la interfaz renderizada

**Files:**
- Verify: `packages/client/ui-sidebar/src/client/SidebarRoot.module.css`
- Verify: `packages/client/ui-brand-official/src/client/Brand.tsx`

- [ ] **Step 1: Construir los artefactos web**

Run: `pnpm run build:web`

Expected: salida exitosa del build de `@phoenix-ai/dsh-web-frontend`.

- [ ] **Step 2: Confirmar que el watcher web existente está activo antes de prometer HMR**

Run: `Get-Process node -ErrorAction SilentlyContinue | Select-Object -First 20 Id,ProcessName`

Expected: identificar el proceso del watcher si está activo; si no lo está, recargar la URL después del build sin afirmar actualización automática.

- [ ] **Step 3: Verificar en el navegador la URL exacta**

Flujo bajo prueba: `http://127.0.0.1:3080` -> recargar -> sidebar expandido visible -> `PHOENIX` aparece junto al emblema con tipografía compacta.

Comprobar identidad de página, contenido no vacío, ausencia de overlay de error, consola sin errores relevantes, captura visual y que el botón del logo siga iniciando una sesión nueva o conservando su acción existente.

- [ ] **Step 4: Revisar responsive en escritorio y móvil**

Confirmar que el wordmark no se corta ni se desborda en el viewport principal y en un viewport móvil; el hero debe conservar su presentación anterior.

- [ ] **Step 5: Registrar un commit aislado**

```bash
git add packages/client/ui-sidebar/src/client/SidebarRoot.module.css packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx
git commit -m "fix: refine sidebar Phoenix wordmark"
```
