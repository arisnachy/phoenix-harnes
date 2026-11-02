# PHOENIX Technical Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear un informe PDF técnico de cinco páginas sobre el uso, la arquitectura, los controles operativos y el estado documentado de PHOENIX, listo para revisión y envío por Gmail.

**Architecture:** El informe vivirá fuera del runtime de PHOENIX en `reports/phoenix-technical-report/`. `report.html` contendrá el contenido semántico y SVG inline; `render-report.mjs` lo abrirá con Playwright y lo imprimirá a PDF; `verify-report.mjs` comprobará páginas, texto, fuentes, enlaces y metadatos básicos. La salida PDF será un artefacto regenerable y no se modificarán paquetes del producto.

**Tech Stack:** HTML semántico, CSS de impresión, SVG, Node.js 22+, Playwright ya disponible en el workspace, utilidades nativas de Node y `pdftotext`/`pdfinfo` si están instalados.

---

### Task 1: Preparar la superficie aislada del informe

**Files:**
- Create: `reports/phoenix-technical-report/report.html`
- Create: `reports/phoenix-technical-report/render-report.mjs`
- Create: `reports/phoenix-technical-report/verify-report.mjs`
- Create: `reports/phoenix-technical-report/README.md`

- [ ] **Step 1: Crear el documento HTML base**

  Crear `report.html` con `lang="es"`, metadatos de título y autor, cinco elementos `<section class="page">`, reglas `@page` de tamaño A4, estilos blanco institucional y una clase `source-note`. Mantener todos los estilos en el archivo para que la fuente sea transportable.

- [ ] **Step 2: Definir el contrato del renderizador**

  Crear `render-report.mjs` con una función `main()` que resuelva `report.html`, lance Chromium mediante `import { chromium } from 'playwright'`, espere `document.fonts.ready`, genere `phoenix-technical-report.pdf` con `format: 'A4'`, `printBackground: true`, `preferCSSPageSize: true`, márgenes nulos y metadatos de impresión desde el HTML. Cerrar el navegador en un bloque `finally` y salir con código distinto de cero si la fuente no existe o el PDF no se crea.

- [ ] **Step 3: Definir el contrato del verificador**

  Crear `verify-report.mjs` con comprobaciones deterministas: existencia de HTML y PDF, conteo de cinco marcadores de página en la fuente, presencia de los encabezados de las cinco secciones, ausencia de `TODO`, `TBD` y `Lorem`, presencia de las siete fuentes primarias y tamaño PDF mayor que cero. Emitir una línea `REPORT_VERIFY_PASS` solo después de completar todas las aserciones.

- [ ] **Step 4: Documentar regeneración y alcance**

  Crear `README.md` con los comandos exactos `node render-report.mjs` y `node verify-report.mjs`, el origen de las afirmaciones, la fecha del informe y la advertencia de que el documento describe el checkout inspeccionado y no sustituye la documentación de producto.

- [ ] **Step 5: Ejecutar la verificación inicial**

  Ejecutar `node reports/phoenix-technical-report/verify-report.mjs` desde la raíz.

  Esperado: fallo explícito por ausencia del PDF o del contenido final, nunca un éxito silencioso. Este paso confirma que el verificador detecta una superficie incompleta antes de rellenarla.

- [ ] **Step 6: Commit aislado de la superficie**

  Ejecutar `git add reports/phoenix-technical-report docs/superpowers/plans/2026-08-28-phoenix-technical-report.md` y `git commit -m "docs: scaffold PHOENIX technical report"`. No incluir archivos ya modificados en el árbol.

### Task 2: Redactar las cinco páginas con evidencia del repositorio

**Files:**
- Modify: `reports/phoenix-technical-report/report.html`
- Modify: `reports/phoenix-technical-report/README.md`

- [ ] **Step 1: Escribir la portada y la tesis**

  Incluir PHOENIX, el subtítulo “Uso, arquitectura y controles operativos”, fecha `2026-08-28`, audiencia técnica y tres afirmaciones comprobables: harness agnóstico de proveedor, composición por plugins y continuidad local durable.

- [ ] **Step 2: Escribir la página de uso real**

  Explicar el flujo de configuración OpenRouter, la conexión ChatGPT/Codex separada de API keys, el selector de modelos, la sesión local y el papel de herramientas, perfiles y bundles. Añadir un flujo SVG con fallback textual y fuentes a `README.md` y `docs/architecture.md`.

- [ ] **Step 3: Escribir la página de arquitectura**

  Añadir un diagrama SVG de capas para perfil → bundles → parches → runtime y un flujo SVG de sesión que use literalmente `turn/start`, `agent/pre-step`, `agent/request`, `llm/stream`, `tool/call`, `step/end` y `turn/end`. Añadir una nota que distinga eventos durables de puntos de extensión vivos.

- [ ] **Step 4: Escribir la página de confianza técnica**

  Añadir la matriz de controles con credenciales separadas, sesión local, runner Windows, actualización fast-forward, recuperación y telemetría. Declarar que `danger-full-access` no es un sandbox, que el backend Windows tiene límites de aislamiento y que el backup cloud futuro no se anuncia sin recibo y restauración verificables.

- [ ] **Step 5: Escribir la página de operación y estado**

  Incluir instalación Windows, Node/pnpm, comandos `pnpm run typecheck`, `pnpm run build`, `pnpm run doc-sync`, `pnpm run website:build`, rutas de soporte y estado “en desarrollo activo”. Separar capacidades documentadas, límites conocidos y verificaciones necesarias para releases.

- [ ] **Step 6: Revisar las fuentes antes de renderizar**

  Comparar cada afirmación crítica con `README.md`, `docs/architecture.md`, `docs/development.md`, `docs/phoenix-windows.md`, `SECURITY.md`, `AGENTS.md` y `package.json`. Mantener las notas de fuente al pie de cada página y actualizar `README.md` si cambia un comando o ruta.

### Task 3: Generar el PDF y la evidencia de contenido

**Files:**
- Modify: `reports/phoenix-technical-report/render-report.mjs`
- Create: `reports/phoenix-technical-report/phoenix-technical-report.pdf`
- Create: `reports/phoenix-technical-report/text-extract.txt`

- [ ] **Step 1: Renderizar desde HTML**

  Ejecutar `node reports/phoenix-technical-report/render-report.mjs`.

  Esperado: salida con la ruta absoluta del PDF y código 0; el PDF debe generarse sin depender de una pestaña de Gmail ni de credenciales.

- [ ] **Step 2: Extraer texto del PDF**

  Si `pdftotext` está instalado, ejecutar `pdftotext reports/phoenix-technical-report/phoenix-technical-report.pdf reports/phoenix-technical-report/text-extract.txt`. Si no está instalado, usar un lector PDF disponible en Node o registrar la ausencia y validar el texto desde el HTML más el conteo de páginas del navegador.

- [ ] **Step 3: Verificar el contrato de contenido**

  Ejecutar `node reports/phoenix-technical-report/verify-report.mjs`.

  Esperado: `REPORT_VERIFY_PASS`, cinco páginas, cinco encabezados, fuentes presentes y cero marcadores incompletos.

- [ ] **Step 4: Commit del PDF y su fuente**

  Ejecutar `git add reports/phoenix-technical-report` y `git commit -m "docs: add PHOENIX technical report"`, manteniendo fuera cualquier modificación preexistente no relacionada.

### Task 4: Realizar QA visual y de accesibilidad

**Files:**
- Create: `reports/phoenix-technical-report/qa/`
- Create: `reports/phoenix-technical-report/qa/page-1.png`
- Create: `reports/phoenix-technical-report/qa/page-2.png`
- Create: `reports/phoenix-technical-report/qa/page-3.png`
- Create: `reports/phoenix-technical-report/qa/page-4.png`
- Create: `reports/phoenix-technical-report/qa/page-5.png`
- Create: `reports/phoenix-technical-report/qa/qa-report.md`

- [ ] **Step 1: Renderizar cada página a PNG**

  Usar Playwright con `pdf.js` o el visor PDF disponible para producir cinco imágenes a escala de revisión. No usar capturas de Gmail como evidencia del documento.

- [ ] **Step 2: Revisar composición**

  Inspeccionar las cinco imágenes y comprobar que no haya texto cortado, desbordamiento, diagramas ilegibles, contraste insuficiente, saltos inesperados, encabezados huérfanos ni notas de fuente superpuestas.

- [ ] **Step 3: Revisar accesibilidad semántica**

  Comprobar que exista un `h1`, que los encabezados sigan orden, que cada SVG tenga `role="img"` y `<title>`, que cada diagrama tenga fallback textual visible y que los colores no sean la única codificación.

- [ ] **Step 4: Registrar QA**

  Escribir `qa-report.md` con la fecha, navegador, tamaño de página, resultado por página y cualquier desviación corregida. No marcar aprobado hasta que la corrección haya sido rerenderizada.

- [ ] **Step 5: Commit de evidencia visual**

  Ejecutar `git add reports/phoenix-technical-report/qa` y `git commit -m "test: record PHOENIX report visual QA"`.

### Task 5: Presentar, confirmar y enviar por Gmail

**Files:**
- Read: `reports/phoenix-technical-report/phoenix-technical-report.pdf`
- No modificar PHOENIX ni configuraciones de Gmail.

- [ ] **Step 1: Presentar el archivo validado**

  Informar la ruta exacta del PDF, las cinco comprobaciones realizadas, las fuentes usadas y cualquier limitación. Adjuntar o enlazar el archivo en la conversación para revisión humana.

- [ ] **Step 2: Pedir confirmación de envío**

  Mostrar el destinatario `arisnachy@gmail.com`, asunto `Informe técnico de PHOENIX — uso, arquitectura y controles operativos`, cuerpo breve y nombre exacto del adjunto. Esperar confirmación explícita antes de pulsar Enviar.

- [ ] **Step 3: Enviar con Gmail**

  Abrir la cuenta conectada, redactar el mensaje, adjuntar `phoenix-technical-report.pdf`, verificar destinatario, asunto y adjunto, y pulsar Enviar solo después de la confirmación del paso anterior.

- [ ] **Step 4: Verificar entrega**

  Abrir Enviados, localizar el mensaje por destinatario y asunto, comprobar que contiene el adjunto PDF y registrar la hora de envío. Si Gmail muestra error, reportar el error concreto sin reintentar automáticamente.
