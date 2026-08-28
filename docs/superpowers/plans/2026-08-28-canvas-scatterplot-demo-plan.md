# Demo Canvas2D de 100.000 puntos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar una demo estática visible de Canvas2D con 100.000 puntos, zoom, paneo, tooltip accesible y fallback textual.

**Architecture:** Una página HTML autónoma en `apps/web/public/demos/canvas-scatterplot.html` mantiene un modelo determinista de puntos y dibuja una capa Canvas2D en píxeles CSS escalados por `devicePixelRatio`. La interacción usa Pointer Events y rueda sobre el canvas; la semántica accesible vive en controles HTML, un resumen textual y una región `aria-live`, sin depender del Canvas para lectores de pantalla.

**Tech Stack:** HTML/CSS/JavaScript nativo, Canvas2D, Playwright CLI, Vite static public assets.

---

### Task 1: Deterministic data contract

**Files:**
- Create: `apps/web/public/demos/canvas-scatterplot-data.js`
- Create: `apps/web/tests/canvas-scatterplot-data.spec.ts`

- [ ] **Step 1: Write the failing test**

Test that the generator returns exactly 100,000 finite points, stable first/last values for a fixed seed, and group labels in the documented domain.

- [ ] **Step 2: Run the focused test and verify RED**

Run `pnpm exec vitest run apps/web/tests/canvas-scatterplot-data.spec.ts`; expect failure because the data module does not exist.

- [ ] **Step 3: Implement the minimal generator**

Export `POINT_COUNT = 100_000` and `createPoints(seed)` using a small deterministic integer PRNG. Store `{ x, y, group, index }` with normalized coordinates in `[0, 1]`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same Vitest command and expect all assertions to pass.

### Task 2: Visible Canvas2D demo

**Files:**
- Create: `apps/web/public/demos/canvas-scatterplot.html`
- Modify: `apps/web/public/demos/canvas-scatterplot-data.js` only if browser-compatible exports need adjustment.

- [ ] **Step 1: Add the failing browser assertions**

Create a Playwright scenario that opens the demo and expects `data-testid="point-count"` to equal `100000`, a visible canvas, reset button, keyboard help, textual fallback, and an `aria-live` status.

- [ ] **Step 2: Run the scenario before implementation**

Run `pnpm exec playwright test apps/web/tests/canvas-scatterplot.e2e.ts`; expect failure because the demo route does not exist.

- [ ] **Step 3: Implement the page**

Use a retained `points` array, explicit `view = { scale, offsetX, offsetY }`, `resizeCanvas()` with `devicePixelRatio`, and `draw()` with `ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)`. Render points in world-to-screen coordinates, clamp zoom and pan, prevent wheel page scrolling only while the pointer is over the canvas, and expose reset/zoom metrics.

- [ ] **Step 4: Add accessible interaction**

Use a focusable canvas with an accessible label, a hidden-but-readable summary, a keyboard cursor that moves with arrow keys, tooltip text in a live region, and an HTML status panel containing the selected index/group/coordinates. Pointer hover updates the same status without making hover the only path.

- [ ] **Step 5: Run the scenario and verify GREEN**

The browser test must pass load, point count, zoom-in/zoom-out, pan, reset, pointer tooltip, keyboard selection, and no console errors.

### Task 3: Build and live host verification

**Files:**
- Modify: `apps/web/tests/canvas-scatterplot.e2e.ts` for the existing scaffold/base URL if needed.

- [ ] **Step 1: Build the web artifact**

Run `pnpm run build:web`; expect Vite to copy `public/demos/canvas-scatterplot.html` into `apps/web/dist/demos/`.

- [ ] **Step 2: Verify the PHOENIX host route**

Open `http://127.0.0.1:3080/demos/canvas-scatterplot.html` with Playwright after the existing host is refreshed or restarted as required. Check HTTP 200, the canvas, and the interaction assertions.

- [ ] **Step 3: Capture visual evidence**

Save a temporary screenshot outside the repository, inspect it, and report the exact URL and evidence hash/path.

- [ ] **Step 4: Final checks**

Run `pnpm exec vitest run apps/web/tests/canvas-scatterplot-data.spec.ts`, `pnpm exec playwright test apps/web/tests/canvas-scatterplot.e2e.ts`, `pnpm run build:web`, and `git diff --check`.
