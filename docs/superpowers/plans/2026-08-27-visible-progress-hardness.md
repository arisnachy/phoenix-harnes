# Visible Tool Progress Hardness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que PHOENIX explique sus próximas acciones antes de usar herramientas y muestre progreso humano, agrupado y seguro durante el turno.

**Architecture:** El contrato conversacional vivirá en las personas de los presets con instrucciones para narrar antes de herramientas, resumir avances y cerrar con evidencia. La GUI tendrá un estado de progreso derivado de la línea temporal existente, sin inventar nuevos eventos persistidos: mostrará preparación, ejecución de herramientas y verificación antes de cada fila de herramientas. El texto se localizará mediante el diccionario de conversación y seguirá ocultando razonamiento interno y payloads sensibles.

**Tech Stack:** TypeScript, React, Cordis session timeline, Vitest, Playwright/Vitest web E2E, YAML agent presets, pnpm.

---

## Mapa de archivos

- Modify: `apps/cli/config/agent-presets/standard/agent.cordis.yml` — contrato de comunicación del preset principal en español.
- Modify: `apps/cli/config/agent-presets/cordis/agent.cordis.yml` — mismo contrato para el preset autorable/self-evolution.
- Modify: `apps/cli/config/agent-presets/code/agent.cordis.yml` — mismo contrato para Code Mode.
- Create: `packages/client/ui-conversation/src/client/chat/turn-progress.ts` — cálculo puro y sanitizado del estado visible del turno.
- Modify: `packages/client/ui-conversation/src/client/chat/ChatView.tsx` — alimentar `TurnStatus` con el estado de progreso.
- Modify: `packages/client/ui-conversation/src/client/locales.ts` — textos en inglés y español para los estados.
- Create: `packages/client/ui-conversation/tests/turn-progress.client.spec.ts` — pruebas unitarias del cálculo de fases.
- Modify: `apps/web/tests/turn-tail-actions.e2e.ts` — prueba E2E de la etiqueta de herramientas y de la verificación.

## Task 1: Fijar el contrato conversacional de los presets

**Files:**
- Modify: `apps/cli/config/agent-presets/standard/agent.cordis.yml:27-32`
- Modify: `apps/cli/config/agent-presets/cordis/agent.cordis.yml:20-27`
- Modify: `apps/cli/config/agent-presets/code/agent.cordis.yml:34-36`

- [ ] **Step 1: Añadir la regla al preset `standard`**

Extender el texto existente, sin quitar identidad ni la regla de no exponer razonamiento, con estas instrucciones exactas:

```yaml
      Antes de invocar una o más herramientas, escribe una introducción breve y clara en el idioma
      del usuario explicando qué vas a revisar, cambiar o comprobar. Durante una tarea de varios pasos,
      después de cada resultado importante comunica el siguiente estado en una frase corta; agrupa pasos
      pequeños y no describas razonamiento interno, credenciales ni payloads. Termina separando
      IMPLEMENTADO, PROBADO, VERIFICADO y PENDIENTE cuando corresponda.
```

- [ ] **Step 2: Añadir el contrato equivalente a `cordis` y `code`**

Mantener sus personas en inglés donde ya lo están, pero añadir el mismo comportamiento funcional y la regla de responder en el idioma del usuario:

```yaml
      Before invoking one or more tools, write one concise user-facing sentence in the user's language
      describing what you will inspect, change, or verify. During multi-step work, report the next phase
      after each meaningful result, grouping small calls and never exposing private reasoning, credentials,
      or raw payloads. Finish with IMPLEMENTADO, PROBADO, VERIFICADO, and PENDIENTE when applicable.
```

- [ ] **Step 3: Validar la composición de presets**

Run:

```powershell
pnpm exec vitest run packages/boot/app-boot/tests/app-boot.spec.ts packages/acp/acp/tests/bridge.spec.ts
```

Expected: PASS; the preset YAML parses and the persona remains the selected `deployment:persona`.

- [ ] **Step 4: Commit**

```powershell
git add apps/cli/config/agent-presets/standard/agent.cordis.yml apps/cli/config/agent-presets/cordis/agent.cordis.yml apps/cli/config/agent-presets/code/agent.cordis.yml
git commit -m "feat: require visible tool narration"
```

## Task 2: Crear el cálculo puro de progreso visible

**Files:**
- Create: `packages/client/ui-conversation/src/client/chat/turn-progress.ts`
- Test: `packages/client/ui-conversation/tests/turn-progress.client.spec.ts`

- [ ] **Step 1: Escribir las pruebas fallidas**

Crear una función pura `turnProgress` con estos casos:

```ts
it('returns preparing when the open turn has no tool node', () => {
  expect(turnProgress(openTimeline(4), [])).toBe('preparing')
})

it('returns running-tools while any tool root is still running', () => {
  expect(turnProgress(openTimeline(4), [toolNode(4, { running: true })])).toBe('running-tools')
})

it('returns verifying after tool roots settle but before turn/end', () => {
  expect(turnProgress(openTimeline(4), [toolNode(4, { running: false })])).toBe('verifying')
})

it('ignores tools belonging to older turns', () => {
  expect(turnProgress(openTimeline(4), [toolNode(3, { running: true })])).toBe('preparing')
})

it('returns null when there is no open turn', () => {
  expect(turnProgress(closedTimeline(4), [])).toBeNull()
})
```

Use the existing `ConversationTimelineSnapshot` and `ChatConversationViewNode` fixture style from `conversation-node-definitions.client.spec.ts`; do not inspect or render tool arguments.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
pnpm exec vitest run packages/client/ui-conversation/tests/turn-progress.client.spec.ts
```

Expected: FAIL because `turn-progress.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure calculation**

Export the exact union and function:

```ts
export type TurnProgress = 'preparing' | 'running-tools' | 'verifying'

export function turnProgress(
  timeline: ConversationTimelineSnapshot,
  nodes: readonly ChatConversationViewNode[],
): TurnProgress | null {
  const turn = [...timeline.turns.values()].find(candidate => candidate.status === 'open')
  if (turn === undefined) return null
  const tools = nodes.filter(node => node.kind === 'tool-call'
    && node.location.kind === 'step'
    && node.location.turn.turn === turn.turn)
  if (tools.length === 0) return 'preparing'
  const hasRunning = tools.some(node => {
    const root = (node.data as { root?: unknown }).root
    return root !== undefined && typeof root === 'object' && root !== null && !('kind' in root)
  })
  return hasRunning ? 'running-tools' : 'verifying'
}
```

Keep the function defensive: malformed or incomplete historical nodes must not throw; they count as settled only when their root has a `kind` field.

- [ ] **Step 4: Run the focused test and verify it passes**

Run the same Vitest command. Expected: PASS for all progress cases.

- [ ] **Step 5: Commit**

```powershell
git add packages/client/ui-conversation/src/client/chat/turn-progress.ts packages/client/ui-conversation/tests/turn-progress.client.spec.ts
git commit -m "feat: derive visible turn progress"
```

## Task 3: Render localized progress in the chat

**Files:**
- Modify: `packages/client/ui-conversation/src/client/chat/ChatView.tsx:118-155,165-223,468-470`
- Modify: `packages/client/ui-conversation/src/client/locales.ts:196-205,378-415`

- [ ] **Step 1: Add localization keys**

Add to the English dictionary:

```ts
  'status.preparing': 'PHOENIX preparing the task…',
  'status.runningTools': 'PHOENIX running tools…',
  'status.verifying': 'PHOENIX verifying the results…',
```

Add Spanish overrides:

```ts
  'status.preparing': 'PHOENIX está preparando la tarea…',
  'status.runningTools': 'PHOENIX está ejecutando herramientas…',
  'status.verifying': 'PHOENIX está verificando los resultados…',
```

- [ ] **Step 2: Extend `TurnStatus` with a phase prop**

Import `turnProgress` and render the translated label selected by this exact mapping:

```ts
const statusKey = progress === 'running-tools'
  ? 'status.runningTools'
  : progress === 'verifying'
    ? 'status.verifying'
    : 'status.preparing'
```

Retain the existing logo, `role="status"`, `aria-live="polite"`, elapsed clock, and fallback clock behavior.

- [ ] **Step 3: Derive progress from the existing node store**

Inside `ChatView`, derive the current visible nodes from `order` and `nodeStore`, then pass the result:

```ts
const chatNodes = useMemo(
  () => order.flatMap(key => {
    const node = nodeStore.get(key)
    return node === undefined ? [] : [node]
  }),
  [nodeStore, order],
)
const progress = useMemo(() => turnProgress(timeline, chatNodes), [chatNodes, timeline])
```

Render status only while `running`, and use the existing `status.thinking` only as a fallback if the progress calculation unexpectedly returns `null` during an open turn. Do not add a new persisted event or expose tool names/arguments in the status.

- [ ] **Step 4: Run GUI unit tests**

Run:

```powershell
pnpm exec vitest run packages/client/ui-conversation/tests
```

Expected: PASS with no locale key or renderer regressions.

- [ ] **Step 5: Commit**

```powershell
git add packages/client/ui-conversation/src/client/chat/ChatView.tsx packages/client/ui-conversation/src/client/locales.ts
git commit -m "feat: show localized execution phases"
```

## Task 4: Probar la experiencia completa en la web

**Files:**
- Modify: `apps/web/tests/turn-tail-actions.e2e.ts`

- [ ] **Step 1: Add the verifying-results assertion**

In the parked mid-turn scenario, the first tool result is already durable and the second model call is parked, so wait for:

```ts
await expect.poll(
  () => page.getByRole('status').filter({ hasText: 'PHOENIX verifying the results…' }).isVisible(),
  { timeout: 10_000 },
).toBe(true)
```

Keep the existing `PHOENIX thinking…` assertion only where the scenario intentionally has no tool node yet.

- [ ] **Step 2: Assert visible narration is separate from raw tools**

Use the existing `NARRATION` fixture and add an assertion that its exact text appears before the tool row in DOM order. Do not assert provider payloads or exact tool arguments.

- [ ] **Step 3: Run the built web tests**

Run:

```powershell
pnpm test:web:built -- apps/web/tests/turn-tail-actions.e2e.ts
```

Expected: PASS; if the built bundle is stale, run `pnpm build` first and rerun the same command.

- [ ] **Step 4: Verify the existing GUI manually**

Refresh the already running PHOENIX URL `http://127.0.0.1:3080`, submit a harmless tool-using request, and verify in the browser that:

1. a concise Spanish introduction appears before the tool row;
2. the status changes to executing tools and then verifying results;
3. the final answer contains evidence/status labels;
4. no credentials, raw payloads, or private reasoning appear.

Do not start a replacement server. If the current watcher is not running, rebuild the affected web artifact and refresh the existing URL before claiming live verification.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/tests/turn-tail-actions.e2e.ts
git commit -m "test: verify visible tool progress in web"
```

## Task 5: Final gates and GitHub publication

**Files:**
- No new source files; inspect all changes and generated artifacts.

- [ ] **Step 1: Run typecheck and focused gates**

Run:

```powershell
pnpm typecheck
pnpm exec vitest run packages/core/agent-loop/tests packages/client/ui-conversation/tests
pnpm test:web:built -- apps/web/tests/turn-tail-actions.e2e.ts
```

Expected: all commands exit 0; no snapshots include secrets or raw tool payloads.

- [ ] **Step 2: Inspect the final diff and secret safety**

Run:

```powershell
git diff origin/main...HEAD --stat
git diff origin/main...HEAD --check
git status --short
```

Expected: only the visible-progress implementation, tests, spec/plan docs, and intentional generated changes are present; no OAuth JSON, token, or environment value is staged.

- [ ] **Step 3: Create an integration commit if needed**

If the previous commits already cover all changes, do not create an empty commit. Otherwise:

```powershell
git add <only-reviewed-files>
git commit -m "feat: harden visible PHOENIX feedback"
```

- [ ] **Step 4: Publish safely to GitHub**

Use the GitHub publishing workflow to push `kira/visible-progress-hardness` and open a draft PR targeting the repository's default branch. Include the test commands and live GUI evidence in the PR body. Never push directly to `main`, and never include OAuth credentials.
