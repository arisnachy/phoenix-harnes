# KIRA Model Activity Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar en `KIRA · Equipos` miniavatares de Sol, Luna, Terra o modelo genérico, animados según la fase durable real del subagente.

**Architecture:** El paquete `@deepseek-ai/dsh-subagent` registrará una proyección `subagentActivity` que pliega el último `request/header` propio del hijo y su turno/herramientas abiertos. `KiraTeamsDock` consumirá esa proyección ya disponible en `SessionSummary.projectionValues` y delegará la representación en un componente pequeño y puro. No se modifican RPC, frames del host ni enrutamiento de modelos.

**Tech Stack:** TypeScript, React 18, CSS Modules, Zod, SessionProjectionRegistry, Vitest, Chrome/CDP.

---

## Estructura de archivos

- Crear `packages/subagent/subagent/tests/activity-projection.spec.ts`: pruebas TDD del fold durable y registro.
- Modificar `packages/subagent/subagent/src/projection-types.ts`: vocabulario cliente-seguro `SubagentActivityProjection` y extensión de `SessionProjectionMap`.
- Modificar `packages/subagent/subagent/src/projection.ts`: estado, esquema Zod y definición de `subagentActivity`.
- Modificar `packages/subagent/subagent/src/index.ts`: exportar tipos/definición y registrar la proyección.
- Crear `packages/client/ui-kira-teams/src/client/ModelActivityAvatar.tsx`: resolver familia del modelo y renderizar avatar/insignia.
- Crear `packages/client/ui-kira-teams/src/client/ModelActivityAvatar.module.css`: geometría, colores, fases y movimiento reducido.
- Crear `packages/client/ui-kira-teams/tests/model-activity-avatar.client.spec.tsx`: pruebas puras de identidad, fase y fallback.
- Modificar `packages/client/ui-kira-teams/src/client/KiraTeamsDock.tsx`: sustituir `StateDot` de fila por el nuevo avatar.
- Modificar `packages/client/ui-kira-teams/src/client/KiraTeamsDock.module.css`: ajustar espacio de fila para 24 px sin rediseñar el dock.
- Modificar `packages/client/ui-kira-teams/tests/browser-plugin.client.spec.ts`: fixture con proyección y comprobación de conservación del linaje.

### Task 1: Proyección durable de actividad

**Files:**
- Create: `packages/subagent/subagent/tests/activity-projection.spec.ts`
- Modify: `packages/subagent/subagent/src/projection-types.ts`
- Modify: `packages/subagent/subagent/src/projection.ts`
- Modify: `packages/subagent/subagent/src/index.ts`

- [ ] **Step 1: Escribir la prueba roja del ciclo completo**

Crear un helper que fabrique eventos tipados y pliegue la definición:

```ts
import { describe, expect, it } from 'vitest'
import type { CallId } from '@deepseek-ai/dsh-brand'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  subagentActivityProjectionDefinition,
  type ActivityState,
} from '../src/projection.ts'

function fold(events: SessionEvent[]) {
  let state: ActivityState = subagentActivityProjectionDefinition.init()
  for (const event of events) state = subagentActivityProjectionDefinition.apply(state, event)
  return subagentActivityProjectionDefinition.wire.view(state)
}

const event = (type: SessionEvent['type'], seq: number, data: unknown): SessionEvent => ({
  type, seq, time: seq * 10, data,
}) as SessionEvent

it('projects the effective model and durable activity phases', () => {
  const c1 = 'call-1' as CallId
  expect(fold([
    event('subagent/descriptor', 0, { version: 1, mode: 'one-shot', provider: 'subagent' }),
    event('turn/start', 1, { turn: 1 }),
    event('request/header', 2, {
      header: { config: { provider: 'openai-codex', model: 'gpt-5.6-luna' } },
      reason: 'initial',
    }),
  ])).toEqual({ provider: 'openai-codex', model: 'gpt-5.6-luna', phase: 'preparing' })

  expect(fold([
    event('subagent/descriptor', 0, { version: 1, mode: 'one-shot', provider: 'subagent' }),
    event('turn/start', 1, { turn: 1 }),
    event('request/header', 2, {
      header: { config: { provider: 'openai-codex', model: 'gpt-5.6-luna' } },
      reason: 'initial',
    }),
    event('tool/call', 3, { turn: 1, step: 1, callId: c1, name: 'read', arguments: '{}' }),
  ])).toMatchObject({ phase: 'running-tools' })
})
```

Añadir el helper de resultado y los casos separados:

```ts
function result(seq: number, turn: number, callId: CallId): SessionEvent {
  return event('tool/result', seq, {
    turn,
    step: 1,
    message: {
      role: 'tool',
      content: [],
      source: { kind: 'tool', callId },
    },
  })
}

it('waits for every pending tool before verifying', () => {
  const c1 = 'call-1' as CallId
  const c2 = 'call-2' as CallId
  const prefix = [
    event('subagent/descriptor', 0, { version: 1, mode: 'one-shot', provider: 'subagent' }),
    event('turn/start', 1, { turn: 1 }),
    event('tool/call', 2, { turn: 1, step: 1, callId: c1, name: 'read', arguments: '{}' }),
    event('tool/call', 3, { turn: 1, step: 1, callId: c2, name: 'grep', arguments: '{}' }),
  ]
  expect(fold([...prefix, result(4, 1, c1)])).toMatchObject({ phase: 'running-tools' })
  expect(fold([...prefix, result(4, 1, c1), result(5, 1, c2)]))
    .toMatchObject({ phase: 'verifying' })
})

it('ignores unknown results and events from another turn', () => {
  const c1 = 'call-1' as CallId
  const unknown = 'unknown' as CallId
  expect(fold([
    event('subagent/descriptor', 0, { version: 1, mode: 'one-shot', provider: 'subagent' }),
    event('turn/start', 1, { turn: 1 }),
    event('tool/call', 2, { turn: 1, step: 1, callId: c1, name: 'read', arguments: '{}' }),
    result(3, 1, unknown),
    result(4, 2, c1),
  ])).toMatchObject({ phase: 'running-tools' })
})

it('resets inherited model and phase at the child descriptor', () => {
  expect(fold([
    event('request/header', 0, {
      header: { config: { provider: 'ancestor', model: 'ancestor-model' } },
      reason: 'initial',
    }),
    event('turn/start', 1, { turn: 1 }),
    event('subagent/descriptor', 2, { version: 1, mode: 'one-shot', provider: 'subagent' }),
  ])).toEqual({ phase: 'idle' })
})

it('returns idle safely before a descriptor or valid header', () => {
  expect(fold([])).toEqual({ phase: 'idle' })
  expect(fold([
    event('turn/start', 0, { turn: 1 }),
    event('request/header', 1, { header: { config: {} }, reason: 'initial' }),
  ])).toEqual({ phase: 'idle' })
})
```

- [ ] **Step 2: Ejecutar la prueba y confirmar RED**

Run:

```bash
pnpm exec vitest run packages/subagent/subagent/tests/activity-projection.spec.ts
```

Expected: FAIL porque `subagentActivityProjectionDefinition` y `ActivityState` todavía no existen.

- [ ] **Step 3: Definir el contrato cliente-seguro**

En `projection-types.ts` añadir:

```ts
export type SubagentActivityPhase = 'preparing' | 'running-tools' | 'verifying' | 'idle'

export interface SubagentActivityProjection {
  provider?: string
  model?: string
  phase: SubagentActivityPhase
}
```

Extender el mapa:

```ts
interface SessionProjectionMap {
  subagentTiming: SubagentTimingProjection
  subagent: SubagentIdentityProjection | null
  subagentActivity: SubagentActivityProjection
}
```

- [ ] **Step 4: Implementar estado y fold mínimos**

En `projection.ts` añadir un estado serializable:

```ts
export interface ActivityState {
  descriptorSeen: boolean
  route?: { provider: string; model: string }
  openTurn?: {
    turn: number
    sawTool: boolean
    pendingCalls: string[]
  }
}
```

Aplicar estas reglas exactas:

```ts
if (event.type === 'subagent/descriptor') return { descriptorSeen: true }
if (!state.descriptorSeen) return state
if (event.type === 'request/header') {
  const { provider, model } = event.data.header.config
  return typeof provider === 'string' && typeof model === 'string'
    ? { ...state, route: { provider, model } }
    : state
}
if (event.type === 'turn/start') {
  return { ...state, openTurn: { turn: event.data.turn, sawTool: false, pendingCalls: [] } }
}
if (event.type === 'tool/call' && state.openTurn?.turn === event.data.turn) {
  return {
    ...state,
    openTurn: {
      ...state.openTurn,
      sawTool: true,
      pendingCalls: [...new Set([...state.openTurn.pendingCalls, String(event.data.callId)])],
    },
  }
}
if (event.type === 'tool/result' && state.openTurn?.turn === event.data.turn) {
  const source = event.data.message.source
  if (source.kind !== 'tool') return state
  const callId = String(source.callId)
  if (!state.openTurn.pendingCalls.includes(callId)) return state
  return {
    ...state,
    openTurn: {
      ...state.openTurn,
      pendingCalls: state.openTurn.pendingCalls.filter(id => id !== callId),
    },
  }
}
if (event.type === 'turn/end' && state.openTurn?.turn === event.data.turn) {
  const { openTurn: _closed, ...rest } = state
  return rest
}
return state
```

La vista calcula:

```ts
const phase = state.openTurn === undefined
  ? 'idle'
  : state.openTurn.pendingCalls.length > 0
    ? 'running-tools'
    : state.openTurn.sawTool
      ? 'verifying'
      : 'preparing'
return { ...state.route, phase }
```

Crear esquemas Zod estrictos para estado y vista, declarar `subagentActivity` en `SessionProjectionStateMap` y usar `stateVersion: 1`.

- [ ] **Step 5: Registrar y exportar la proyección**

En `index.ts`:

```ts
import {
  subagentActivityProjectionDefinition,
  subagentIdentityProjectionDefinition,
  subagentTimingProjectionDefinition,
} from './projection.ts'
```

Registrar junto a las existentes:

```ts
projectionCtx.sessionProjections.register(subagentActivityProjectionDefinition)
```

Exportar:

```ts
export type {
  SubagentActivityPhase,
  SubagentActivityProjection,
  SubagentIdentityProjection,
  SubagentTimingProjection,
} from './projection-types.ts'
```

- [ ] **Step 6: Ejecutar pruebas verdes del paquete**

Run:

```bash
pnpm exec vitest run packages/subagent/subagent/tests/activity-projection.spec.ts packages/subagent/subagent/tests/timing-projection.spec.ts
```

Expected: todos los tests PASS; el test de registro espera también `subagentActivity: { phase: 'idle' }` antes de disponer el plugin y `undefined` después.

- [ ] **Step 7: Commit focal**

```bash
git add packages/subagent/subagent/src/projection-types.ts packages/subagent/subagent/src/projection.ts packages/subagent/subagent/src/index.ts packages/subagent/subagent/tests/activity-projection.spec.ts packages/subagent/subagent/tests/timing-projection.spec.ts
git commit -m "feat: project subagent model activity"
```

### Task 2: Componente visual puro de avatar

**Files:**
- Create: `packages/client/ui-kira-teams/src/client/ModelActivityAvatar.tsx`
- Create: `packages/client/ui-kira-teams/src/client/ModelActivityAvatar.module.css`
- Create: `packages/client/ui-kira-teams/tests/model-activity-avatar.client.spec.tsx`

- [ ] **Step 1: Escribir pruebas rojas de identidad y fase**

```tsx
import { describe, expect, it } from 'vitest'
import { ModelActivityAvatar, modelAvatarKind } from '../src/client/ModelActivityAvatar.tsx'

it.each([
  ['gpt-5.6-sol', 'sol'],
  ['GPT-5.6-LUNA', 'luna'],
  ['gpt-5.6-terra', 'terra'],
  ['another-model', 'generic'],
  [undefined, 'generic'],
] as const)('maps %s to %s', (model, expected) => {
  expect(modelAvatarKind(model)).toBe(expected)
})

it('exposes model family, phase and state as decorative data', () => {
  const element = ModelActivityAvatar({
    activity: { provider: 'openai-codex', model: 'gpt-5.6-luna', phase: 'running-tools' },
    running: true,
    pending: false,
  })
  expect(element.props['data-avatar']).toBe('luna')
  expect(element.props['data-phase']).toBe('running-tools')
  expect(element.props['data-state']).toBe('running')
  expect(element.props['aria-hidden']).toBe('true')
})
```

Añadir casos `idle`, `pending` y actividad ausente.

- [ ] **Step 2: Ejecutar la prueba y confirmar RED**

```bash
pnpm exec vitest run packages/client/ui-kira-teams/tests/model-activity-avatar.client.spec.tsx
```

Expected: FAIL porque el módulo no existe.

- [ ] **Step 3: Implementar componente y resolver familia**

```tsx
import type { SubagentActivityProjection } from '@deepseek-ai/dsh-subagent'
import css from './ModelActivityAvatar.module.css'

export type ModelAvatarKind = 'sol' | 'luna' | 'terra' | 'generic'

export function modelAvatarKind(model: string | undefined): ModelAvatarKind {
  const normalized = model?.toLowerCase() ?? ''
  if (normalized.includes('sol')) return 'sol'
  if (normalized.includes('luna')) return 'luna'
  if (normalized.includes('terra')) return 'terra'
  return 'generic'
}

export function ModelActivityAvatar({ activity, running, pending }: {
  activity: SubagentActivityProjection | undefined
  running: boolean
  pending: boolean
}) {
  const kind = modelAvatarKind(activity?.model)
  const phase = running ? activity?.phase ?? 'preparing' : 'idle'
  const state = pending ? 'pending' : running ? 'running' : 'done'
  return (
    <span
      className={css.avatar}
      data-avatar={kind}
      data-phase={phase}
      data-state={state}
      aria-hidden="true"
    >
      <span className={css.core} />
      <span className={css.orbit} />
      <span className={css.badge} />
    </span>
  )
}
```

Añadir `@deepseek-ai/dsh-subagent` como `peerDependency` y `devDependency` del paquete UI para que el tipo aumentativo `SessionProjectionMap` y su export sean dependencias explícitas.

- [ ] **Step 4: Implementar CSS de 24 px**

La base debe usar:

```css
.avatar {
  position: relative;
  isolation: isolate;
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.core,
.orbit,
.badge {
  position: absolute;
  pointer-events: none;
}

.badge {
  right: -1px;
  bottom: -1px;
  z-index: 3;
  width: 6px;
  height: 6px;
  border: 2px solid var(--dsh-color-surface, #fff);
  border-radius: 50%;
  background: #22c55e;
}

.avatar[data-state='done'] .badge {
  background: #86efac;
  box-shadow: inset 0 0 0 1px #16a34a;
}

.avatar[data-state='pending'] .badge {
  background: #f59e0b;
  box-shadow: 0 0 0 2px rgb(245 158 11 / 18%);
}
```

Familias:

```css
.avatar[data-avatar='sol'] .core { background: radial-gradient(circle at 35% 30%, #fff7c2, #f59e0b 48%, #c2410c); }
.avatar[data-avatar='luna'] .core { background: radial-gradient(circle at 35% 32%, #dbeafe, #6366f1 48%, #312e81); }
.avatar[data-avatar='terra'] .core { background: radial-gradient(circle at 35% 32%, #ccfbf1, #14b8a6 50%, #115e59); }
.avatar[data-avatar='generic'] .core { background: radial-gradient(circle at 35% 32%, #e0f2fe, #3b82f6 50%, #1e3a8a); }
```

Añadir formas distintivas con `::before`/`::after`: rayo radial para Sol, media luna por recorte para Luna, dos bandas curvas para Terra y núcleo estelar para genérico.

Animaciones:

```css
.avatar[data-phase='preparing'] .core { animation: avatar-breathe 1.8s ease-in-out infinite alternate; }
.avatar[data-phase='running-tools'] .orbit { animation: avatar-orbit 1.2s linear infinite; }
.avatar[data-phase='verifying']::after { animation: avatar-scan 1.6s ease-in-out infinite; }
.avatar[data-phase='idle'] { opacity: 0.72; }
```

Ninguna escala supera `1.06`. En movimiento reducido:

```css
@media (prefers-reduced-motion: reduce) {
  .avatar,
  .avatar::before,
  .avatar::after,
  .avatar * {
    animation: none !important;
  }
}
```

- [ ] **Step 5: Ejecutar prueba verde**

```bash
pnpm exec vitest run packages/client/ui-kira-teams/tests/model-activity-avatar.client.spec.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit focal**

```bash
git add packages/client/ui-kira-teams/package.json packages/client/ui-kira-teams/src/client/ModelActivityAvatar.tsx packages/client/ui-kira-teams/src/client/ModelActivityAvatar.module.css packages/client/ui-kira-teams/tests/model-activity-avatar.client.spec.tsx
git commit -m "feat: add animated model activity avatars"
```

### Task 3: Integrar el avatar en KIRA · Equipos

**Files:**
- Modify: `packages/client/ui-kira-teams/src/client/KiraTeamsDock.tsx:1-6,190-214`
- Modify: `packages/client/ui-kira-teams/src/client/KiraTeamsDock.module.css:87-109`
- Modify: `packages/client/ui-kira-teams/tests/browser-plugin.client.spec.ts:73-81`

- [ ] **Step 1: Escribir fixture rojo con proyección real**

Importar el tipo `SubagentActivityProjection` y añadir a `c1`:

```ts
projectionValues: {
  subagentActivity: {
    provider: 'openai-codex',
    model: 'gpt-5.6-luna',
    phase: 'running-tools',
  },
},
```

Añadir una prueba pura exportando un helper `activityOf` desde `KiraTeamsDock.tsx`:

```ts
it('reads the durable child model activity projection', () => {
  const child = FAMILY.find(item => item.id === sid('c1'))!
  expect(activityOf(child)).toEqual({
    provider: 'openai-codex',
    model: 'gpt-5.6-luna',
    phase: 'running-tools',
  })
})
```

- [ ] **Step 2: Ejecutar y confirmar RED**

```bash
pnpm exec vitest run packages/client/ui-kira-teams/tests/browser-plugin.client.spec.ts
```

Expected: FAIL porque `activityOf` no existe.

- [ ] **Step 3: Sustituir el punto principal**

Eliminar `StateDot` del import de primitivas, importar el componente y el tipo, y añadir:

```tsx
export function activityOf(summary: SessionSummary): SubagentActivityProjection | undefined {
  return summary.projectionValues?.subagentActivity
}
```

En la fila:

```tsx
<ModelActivityAvatar
  activity={activityOf(summary)}
  running={summary.running}
  pending={summary.pendingInteraction !== undefined}
/>
```

Conservar sin cambios `name`, `tag`, `status`, `openChild` e indentación.

- [ ] **Step 4: Ajustar ritmo de la fila**

Cambiar únicamente:

```css
.row {
  gap: 8px;
  min-height: 36px;
  padding-block: 5px;
}
```

La tarjeta mantiene `width: 288px`; no ampliar el dock ni reducir el texto.

- [ ] **Step 5: Ejecutar suite UI completa**

```bash
pnpm exec vitest run packages/client/ui-kira-teams/tests
```

Expected: todas las pruebas PASS.

- [ ] **Step 6: Commit focal**

```bash
git add packages/client/ui-kira-teams/src/client/KiraTeamsDock.tsx packages/client/ui-kira-teams/src/client/KiraTeamsDock.module.css packages/client/ui-kira-teams/tests/browser-plugin.client.spec.ts
git commit -m "feat: show model avatars in KIRA teams"
```

### Task 4: Validación integrada

**Files:**
- Verify only; no product files expected.

- [ ] **Step 1: Ejecutar suites afectadas**

```bash
pnpm exec vitest run packages/subagent/subagent/tests packages/client/ui-kira-teams/tests
```

Expected: 0 fallos.

- [ ] **Step 2: Ejecutar lint focal**

```bash
pnpm exec oxlint packages/subagent/subagent/src/projection.ts packages/subagent/subagent/src/projection-types.ts packages/client/ui-kira-teams/src/client/ModelActivityAvatar.tsx packages/client/ui-kira-teams/src/client/KiraTeamsDock.tsx packages/subagent/subagent/tests/activity-projection.spec.ts packages/client/ui-kira-teams/tests
```

Expected: 0 errores y 0 avisos.

- [ ] **Step 3: Construir PHOENIX**

```bash
pnpm run build
```

Expected: exit code 0. Los avisos existentes de chunks grandes o paquetes Linux opcionales no bloquean.

- [ ] **Step 4: Confirmar watcher o refrescar GUI existente**

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'pnpm(\.cmd)?\s+run\s+dev:web' }
```

Si no hay watcher, los artefactos ya fueron reconstruidos por `pnpm run build`; refrescar `http://127.0.0.1:3080/`. No iniciar otro servidor.

- [ ] **Step 5: Verificar en Chrome real**

Abrir el dock con un hijo activo y comprobar por DOM:

```js
[...document.querySelectorAll('[data-avatar]')].map(element => ({
  avatar: element.getAttribute('data-avatar'),
  phase: element.getAttribute('data-phase'),
  state: element.getAttribute('data-state'),
  animation: getComputedStyle(element.querySelector('[class*=orbit]')).animationName,
}))
```

Expected: identidad correcta (`sol`, `luna`, `terra` o `generic`), fase real y animación correspondiente. Hacer clic en la fila y confirmar navegación al hijo.

- [ ] **Step 6: Verificar movimiento reducido por CDP**

Emular `prefers-reduced-motion: reduce` y comprobar:

```js
[...document.querySelectorAll('[data-avatar], [data-avatar] *')]
  .map(element => getComputedStyle(element).animationName)
  .every(name => name === 'none')
```

Expected: `true`.

- [ ] **Step 7: Verificar consola y capturas**

Tras recargar con caché ignorada:

- 0 `Runtime.exceptionThrown`;
- 0 `console.error`/`console.warn` nuevos;
- 0 overlay de compilación.

Guardar:

```text
.kira/audits/kira-team-model-avatars.png
.kira/audits/kira-team-model-avatars-closeup.png
```

Comparar contra la captura aprobada: avatar junto al nombre, punto verde como insignia, tarjeta de igual ancho y texto sin colisión.

- [ ] **Step 8: Revisar alcance y commit final si hizo falta**

```bash
git diff --check
git status --short
git diff --stat
```

Expected: sin snapshots ni artefactos ajenos. Si la verificación exigió un ajuste de código:

```bash
git add packages/subagent/subagent/src/projection-types.ts packages/subagent/subagent/src/projection.ts packages/subagent/subagent/src/index.ts packages/subagent/subagent/tests/activity-projection.spec.ts packages/subagent/subagent/tests/timing-projection.spec.ts packages/client/ui-kira-teams/package.json packages/client/ui-kira-teams/src/client/ModelActivityAvatar.tsx packages/client/ui-kira-teams/src/client/ModelActivityAvatar.module.css packages/client/ui-kira-teams/src/client/KiraTeamsDock.tsx packages/client/ui-kira-teams/src/client/KiraTeamsDock.module.css packages/client/ui-kira-teams/tests/model-activity-avatar.client.spec.tsx packages/client/ui-kira-teams/tests/browser-plugin.client.spec.ts
git commit -m "fix: polish KIRA model avatar states"
```

## Revisión del plan contra la especificación

- Identidad Sol/Luna/Terra: Task 2.
- Fallback para otros proveedores/modelos: Task 2.
- Fases durables y no inferidas: Task 1.
- Reset de forks: Task 1.
- Insignia verde/ámbar y estado final: Task 2.
- Movimiento reducido: Tasks 2 y 4.
- Conservación de navegación, truncado e indentación: Task 3.
- Sin cambios RPC ni selector/enrutamiento: arquitectura y Tasks 1–3.
- Pruebas, build, consola y captura real: Task 4.
