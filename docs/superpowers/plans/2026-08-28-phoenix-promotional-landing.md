# PHOENIX Promotional Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar una landing promocional responsive y dinámica para PHOENIX, accesible desde `website/public/phoenix/`, con demo interactiva, CTA local y QA de navegador.

**Architecture:** La superficie será una página estática independiente servida por VitePress como `/phoenix/`. `index.html` definirá el contenido semántico, `styles.css` contendrá los tokens Local Clarity y layout responsive, y `main.js` manejará únicamente el menú móvil, los tres estados del demo, el copiado del comando y las revelaciones por scroll. No se tocarán `apps/web/src/main.ts`, el runtime, autenticación, rutas operativas ni paquetes del producto.

**Tech Stack:** HTML semántico, CSS moderno, JavaScript de navegador sin framework ni dependencias nuevas, VitePress existente, Playwright CLI para verificación y capturas.

---

### Task 1: Crear la superficie promocional independiente

**Files:**
- Create: `website/public/phoenix/index.html`
- Create: `website/public/phoenix/styles.css`
- Create: `website/public/phoenix/main.js`

- [ ] **Step 1: Escribir la estructura HTML semántica**

  Crear `index.html` con `lang="es"`, metadatos SEO básicos, `header`, `nav`, `main` y `footer`. Incluir un único `h1` con “Tu IA. Tu espacio. Tu ritmo.”, navegación hacia `#como-funciona`, `#capacidades` y `#confianza`, botones CTA “Probar PHOENIX” y “Ver cómo funciona”, hero con panel de sesión y secciones completas de beneficios, pasos, demo, capacidades, confianza, CTA final y footer.

- [ ] **Step 2: Definir el contrato de interacción en HTML**

  Incluir `button[data-demo-state="configurar|conversar|conservar"]` con `aria-pressed`, una región `#demo-output` con `aria-live="polite"`, un botón `#copy-command` con texto “Copiar comando”, un botón `#mobile-menu-toggle` con `aria-expanded="false"`, y un panel `#mobile-menu` inicialmente cerrado. Cada icono decorativo debe tener `aria-hidden="true"` y cada SVG informativo debe tener `<title>`.

- [ ] **Step 3: Implementar el sistema visual responsive**

  Crear `styles.css` con los tokens `--paper:#F7F4EE`, `--surface:#FFFDFC`, `--ink:#16324F`, `--muted:#607487`, `--teal:#1E7181`, `--amber:#D88A2B` y `--trust:#2D8069`. Implementar contenedor máximo de 1180px, hero de dos columnas, grids de beneficios/capacidades, panel de demo, foco visible, breakpoints en 980px y 760px y media query `prefers-reduced-motion: reduce` que elimine transiciones y animaciones no esenciales.

- [ ] **Step 4: Implementar el estado de la demo**

  Crear en `main.js` el mapa inmutable:

  ```js
  const demoStates = {
    configurar: { label: 'Configurando tu espacio', metric: 'Proveedor listo', detail: 'Elige modelo, credencial y políticas desde un solo lugar.' },
    conversar: { label: 'Sesión activa', metric: 'Contexto en curso', detail: 'PHOENIX coordina agente, herramientas y contexto sin perder el hilo.' },
    conservar: { label: 'Continuidad guardada', metric: 'Historial local', detail: 'La sesión queda disponible para revisar, reanudar y auditar.' },
  }
  ```

  Añadir listeners a los botones para actualizar texto, métrica, clase visual y `aria-pressed`, manteniendo un solo estado activo y sin usar `innerHTML` para valores dinámicos.

- [ ] **Step 5: Implementar menú, copiado y scroll reveal**

  En `main.js`, alternar `aria-expanded` y una clase abierta en el menú móvil; cerrar al pulsar Escape o un enlace. Usar `navigator.clipboard.writeText` con fallback visible de error y cambiar el texto del botón a “Copiado” durante 1600 ms. Usar `IntersectionObserver` para añadir `.is-visible` a elementos `.reveal`, desconectarlo después de observar y no iniciar observadores si `prefers-reduced-motion` está activo.

- [ ] **Step 6: Commit de la landing base**

  Ejecutar `git add website/public/phoenix` y `git commit -m "feat: add PHOENIX promotional landing"`. No incluir archivos modificados previamente fuera de esta ruta.

### Task 2: Revisar claims y calidad editorial

**Files:**
- Modify: `website/public/phoenix/index.html`
- Create: `website/public/phoenix/README.md`

- [ ] **Step 1: Contrastar claims del hero y beneficios**

  Usar lenguaje promocional verificable: local-first, proveedor intercambiable, continuidad de sesión local, composición por plugins y credenciales separadas. No usar “cero riesgo”, “IA perfecta”, cifras de rendimiento/adopción, backup cloud disponible ni release firmado.

- [ ] **Step 2: Añadir nota editorial y fuentes**

  Crear `website/public/phoenix/README.md` con el propósito de la landing, URL local `/phoenix/`, fuentes `README.md`, `docs/architecture.md`, `docs/phoenix-windows.md` y `SECURITY.md`, y la advertencia de que PHOENIX está en desarrollo activo.

- [ ] **Step 3: Revisar accesibilidad estática**

  Confirmar un único `h1`, orden de encabezados, labels de navegación, botones nativos, `aria-pressed`, `aria-live`, `aria-expanded`, foco visible, texto alternativo de SVG informativos y ningún color como única señal.

- [ ] **Step 4: Commit editorial**

  Ejecutar `git add website/public/phoenix/index.html website/public/phoenix/README.md` y `git commit -m "docs: document PHOENIX promotional landing"`.

### Task 3: Build y smoke test local

**Files:**
- Read: `website/package.json`
- Verify: `website/public/phoenix/index.html`, `website/public/phoenix/styles.css`, `website/public/phoenix/main.js`

- [ ] **Step 1: Ejecutar build VitePress**

  Ejecutar `pnpm --dir website run build`.

  Esperado: código 0 y artefacto `website/.vitepress/dist/` generado sin errores.

- [ ] **Step 2: Servir la documentación local**

  Ejecutar `pnpm --dir website run dev` en un job gestionado, registrar el job id y usar la URL exacta `http://127.0.0.1:5173/phoenix/`. No iniciar ni reemplazar el servidor operativo de PHOENIX.

- [ ] **Step 3: Smoke test de navegación**

  Abrir `http://127.0.0.1:5173/phoenix/` en el navegador de QA y comprobar que el título contiene `PHOENIX`, el hero contiene el `h1`, los enlaces de navegación llegan a `#como-funciona`, `#capacidades` y `#confianza`, y el CTA local apunta al comando/documentación definida.

### Task 4: QA de interacción, responsive y visual

**Files:**
- Create: `website/public/phoenix/qa/desktop.png`
- Create: `website/public/phoenix/qa/mobile.png`
- Create: `website/public/phoenix/qa/qa-report.md`

- [ ] **Step 1: Verificar demo de estados**

  En el navegador, activar Configurar, Conversar y Conservar. Comprobar que solo un botón tiene `aria-pressed="true"`, `#demo-output` cambia label/métrica/detalle y no hay recarga ni errores de consola.

- [ ] **Step 2: Verificar copiado del comando**

  Pulsar `#copy-command`, comprobar el cambio temporal a “Copiado” y restauración posterior. Si el navegador bloquea clipboard, comprobar el mensaje de fallback sin marcar la prueba como fallo de layout.

- [ ] **Step 3: Verificar menú móvil y teclado**

  Usar viewport de 390px, abrir/cerrar menú con teclado, comprobar `aria-expanded`, Escape, foco visible y navegación de los enlaces. Confirmar que no existe overflow horizontal.

- [ ] **Step 4: Verificar desktop, tablet y reduced motion**

  Revisar a 1440px, 1024px y 390px. Activar `prefers-reduced-motion: reduce` y confirmar que la página conserva contenido y funcionalidad sin animaciones esenciales.

- [ ] **Step 5: Capturar evidencia visual**

  Capturar `desktop.png` a 1440×1000 y `mobile.png` a 390×844. Revisar hero, ritmo vertical, contraste, alineación, CTA, panel de demo, capacidades, confianza, footer y ausencia de texto cortado.

- [ ] **Step 6: Registrar QA y commit**

  Crear `qa-report.md` con URLs, viewports, checks, resultado de consola, reduced motion, interacción y capturas. Ejecutar `git add website/public/phoenix/qa` y `git commit -m "test: record PHOENIX landing QA"`.

### Task 5: Verificación final y presentación

**Files:**
- Verify: `website/.vitepress/dist/phoenix/index.html`
- Verify: `website/public/phoenix/qa/qa-report.md`

- [ ] **Step 1: Repetir build y smoke checks**

  Ejecutar `pnpm --dir website run build` y repetir el smoke test tras el build para demostrar que la superficie publicada conserva la ruta `/phoenix/`.

- [ ] **Step 2: Revisar diff y cambios preexistentes**

  Ejecutar `git status --short` y `git show --stat --oneline --summary` para confirmar que solo los commits de la landing contienen sus archivos; no modificar ni incluir cambios preexistentes.

- [ ] **Step 3: Presentar la landing**

  Entregar la URL local, rutas de archivos principales, evidencia desktop/mobile, checks de interacción y cualquier desviación intencional. Indicar explícitamente que la implementación fue verificada contra el diseño aprobado.
