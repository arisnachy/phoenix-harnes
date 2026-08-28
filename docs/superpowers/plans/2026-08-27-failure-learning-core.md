# Failure Learning Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar un ciclo seguro que normalice cada fallo, diagnostique su causa, pruebe soluciones gobernadas, evite rutas reincidentes y persista evidencia reutilizable.

**Architecture:** Crear un paquete provider-neutral `@deepseek-ai/dsh-failure-learning` con tipos, redacción, fingerprints, memoria Markdown y selección de recuperación. Exponer adaptadores pequeños para LLM/HARDNESS y una política de ruta consumible por `model-router`; el núcleo no ejecuta cambios peligrosos ni modifica pesos de modelos. HARDNESS seguirá siendo la puerta de experimento, holdout, rollback y promoción.

**Tech Stack:** TypeScript ESM del monorepo, Vitest, `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-hardness`, `LabMode`, `SelfImprovementLedger`, persistencia UTF-8 atómica y lint/typecheck existentes.

---

## Mapa de archivos

### Paquete nuevo

- Crear: `packages/failure-learning/failure-learning/package.json` — paquete y exports.
- Crear: `packages/failure-learning/failure-learning/src/types.ts` — contratos inmutables.
- Crear: `packages/failure-learning/failure-learning/src/redaction.ts` — eliminación de secretos.
- Crear: `packages/failure-learning/failure-learning/src/fingerprint.ts` — normalización y huella estable.
- Crear: `packages/failure-learning/failure-learning/src/memory.ts` — memoria indexada y persistencia Markdown inyectable.
- Crear: `packages/failure-learning/failure-learning/src/recovery.ts` — clasificación y límites de recuperación.
- Crear: `packages/failure-learning/failure-learning/src/route-policy.ts` — decisiones de ruta.
- Crear: `packages/failure-learning/failure-learning/src/index.ts` — API pública.
- Crear: `packages/failure-learning/failure-learning/tests/*.spec.ts` — pruebas del paquete.

### Integración LLM

- Crear: `packages/llm/llm/src/failure-learning.ts` — conversión de `LlmFailure` a fallo común.
- Modificar: `packages/llm/llm/src/index.ts` — exportar el adaptador.
- Crear: `packages/llm/llm/tests/failure-learning.spec.ts` — pruebas LLM.

### Integración HARDNESS

- Modificar: `packages/hardness/adapters/src/lab-mode.ts` — registros gobernados de aprendizaje.
- Modificar: `packages/hardness/adapters/src/acquisition-registry.ts` — BUILD como hipótesis.
- Modificar: `packages/hardness/adapters/src/mission-orchestrator.ts` — registrar fallos de misión.
- Modificar: `packages/hardness/adapters/src/mission-runtime.ts` — inyección explícita de memoria.
- Modificar: `packages/hardness/adapters/src/index.ts` — exports.
- Crear: `packages/hardness/adapters/tests/failure-learning.spec.ts` — ciclo HARDNESS.

### Documentación y memoria

- Modificar: `.kira/memory/failures.md` — conservar entradas y añadir formato común.
- Modificar: `.kira/evolution-status.md` — evidencia del ciclo implementado.
- Crear: `packages/failure-learning/failure-learning/README.md` — contrato y límites.

No se editarán fichas shipped del roster. La integración con `model-router` consumirá una política provider-neutral y conservará `model: ROUTER`.

---

## Task 1: Contrato provider-neutral

**Files:** `packages/failure-learning/failure-learning/package.json`, `src/types.ts`, `src/index.ts`, `tests/types.spec.ts`.

- [ ] **Step 1: Escribir la prueba de estados.**

```ts
import { describe, expect, it } from 'vitest'
import { isVerifiedLearning } from '../src/index.ts'

describe('failure-learning types', () => {
  it('solo considera activo el aprendizaje verified', () => {
    expect(isVerifiedLearning({ confidence: 'verified' })).toBe(true)
    expect(isVerifiedLearning({ confidence: 'probable' })).toBe(false)
    expect(isVerifiedLearning({ confidence: 'hypothesis' })).toBe(false)
    expect(isVerifiedLearning({ confidence: 'retired' })).toBe(false)
  })
})
```

- [ ] **Step 2: Ejecutar la prueba.**

Run: `pnpm exec vitest run packages/failure-learning/failure-learning/tests/types.spec.ts`
Expected: FAIL porque el paquete no existe.

- [ ] **Step 3: Implementar los tipos y exports.**

Definir `FailureScope`, `FailureConfidence`, `FailureRisk`, `FailureEvidence`, `FailureRecord`, `LearningEntry`, `RouteCandidate`, `RouteDecision`, `RecoveryAction` y `RecoveryResult`, todos con campos persistentes `readonly`. Exportar:

```ts
export function isVerifiedLearning(value: Pick<LearningEntry, 'confidence'>): boolean {
  return value.confidence === 'verified'
}
```

Crear el paquete ESM con peer dependency de `@deepseek-ai/dsh-llm` opcional solo en el adaptador, no en el núcleo.

- [ ] **Step 4: Ejecutar la prueba.**

Run: `pnpm exec vitest run packages/failure-learning/failure-learning/tests/types.spec.ts`
Expected: PASS.

- [ ] **Step 5: Verificar typecheck del paquete.**

Run: `pnpm exec tsc -p packages/failure-learning/failure-learning/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit.**

```text
git add packages/failure-learning/failure-learning
git commit -m "feat: add failure learning contracts"
```

## Task 2: Redacción y fingerprint determinista

**Files:** `src/redaction.ts`, `src/fingerprint.ts`, `tests/redaction.spec.ts`, `tests/fingerprint.spec.ts`.

- [ ] **Step 1: Escribir pruebas de secreto y estabilidad.**

```ts
import { describe, expect, it } from 'vitest'
import { redactFailureText } from '../src/redaction.ts'
import { failureFingerprint } from '../src/fingerprint.ts'

describe('failure redaction', () => {
  it('reemplaza credenciales y conserva el diagnóstico', () => {
    const safe = redactFailureText('AUTH token=sk-live-123 api_key=secret-value')
    expect(safe).not.toContain('sk-live-123')
    expect(safe).not.toContain('secret-value')
    expect(safe).toContain('AUTH')
  })
})

describe('failure fingerprint', () => {
  it('ignora espacios y casing accidental, pero conserva código y ruta', () => {
    const a = failureFingerprint({ code: 'AUTH', message: 'Provider failed', provider: 'deepseek-official', model: 'flash' })
    const b = failureFingerprint({ code: 'AUTH', message: ' provider   FAILED ', provider: 'deepseek-official', model: 'flash' })
    expect(a).toBe(b)
  })
})
```

- [ ] **Step 2: Ejecutar y confirmar FAIL.**

Run: `pnpm exec vitest run packages/failure-learning/failure-learning/tests/redaction.spec.ts packages/failure-learning/failure-learning/tests/fingerprint.spec.ts`
Expected: FAIL por exports ausentes.

- [ ] **Step 3: Implementar redacción y fingerprint.**

Redactar valores asociados a `token`, `api_key`, `authorization`, `password`, `secret`, `cookie`, `requestId` y claves con formato de credencial. Usar sustitución `[REDACTED]`, truncar mensajes a un límite constante y ordenar campos antes de hashear. El hash será SHA-256 hexadecimal de la representación normalizada; no incluir argumentos completos ni contenido de usuario.

- [ ] **Step 4: Ejecutar pruebas y typecheck.**

Run: `pnpm exec vitest run packages/failure-learning/failure-learning/tests/redaction.spec.ts packages/failure-learning/failure-learning/tests/fingerprint.spec.ts`
Expected: PASS.

Run: `pnpm exec tsc -p packages/failure-learning/failure-learning/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit.**

```text
git add packages/failure-learning/failure-learning/src/redaction.ts packages/failure-learning/failure-learning/src/fingerprint.ts packages/failure-learning/failure-learning/tests
git commit -m "feat: normalize and fingerprint failures safely"
```

## Task 3: Memoria Markdown e índice consultable

**Files:** `src/memory.ts`, `tests/memory.spec.ts`, `.kira/memory/failures.md`.

- [ ] **Step 1: Escribir pruebas de persistencia y confianza.**

```ts
import { describe, expect, it } from 'vitest'
import { FailureMemory } from '../src/memory.ts'

describe('FailureMemory', () => {
  it('persists records, finds verified matches, and keeps hypotheses inactive', async () => {
    const io = { read: async () => '# FAILURE MEMORY\n', write: async (_path: string, _text: string) => {} }
    const memory = new FailureMemory(io, 'failures.md')
    await memory.load()
    await memory.record({
      id: 'failure-auth', fingerprint: 'fp-auth', scope: 'model', symptom: 'AUTH', cause: 'invalid credential',
      solution: 'use approved fallback', prevention: 'avoid failed route', evidence: { reproduction: 'test-auth', validation: 'test-fallback', regression: 'test-repeat' },
      confidence: 'hypothesis', risk: 'high', affectedRoutes: ['deepseek-official/flash'], rollback: 'remove route rule', createdAt: '2026-08-27',
    })
    expect(memory.findVerified('fp-auth')).toEqual([])
  })
})
```

- [ ] **Step 2: Ejecutar la prueba y confirmar FAIL.**

Run: `pnpm exec vitest run packages/failure-learning/failure-learning/tests/memory.spec.ts`
Expected: FAIL porque `FailureMemory` no existe.

- [ ] **Step 3: Implementar `FailureMemory`.**

Exponer `load`, `record`, `find`, `findVerified`, `markRetired` y `snapshot`. Parsear bloques YAML delimitados dentro de Markdown, ignorar texto histórico no estructurado y conservarlo al serializar. Escribir mediante una interfaz `read/write` inyectable; el adaptador de disco deberá escribir temporalmente y reemplazar de forma atómica. Rechazar entradas sin fingerprint, evidencia o rollback. Deduplicar por `id` y no permitir que `hypothesis` o `probable` aparezcan en `findVerified`.

- [ ] **Step 4: Añadir la entrada estructurada existente.**

Actualizar `.kira/memory/failures.md` sin eliminar sus 77 líneas históricas. Añadir una sección de registros estructurados y migrar los fallos conocidos de autenticación de `deepseek-official`, RPC, PowerShell, Git, edición y Chrome como `verified` solo cuando ya exista evidencia en el documento; los demás quedan `probable`.

- [ ] **Step 5: Ejecutar pruebas y revisar diff.**

Run: `pnpm exec vitest run packages/failure-learning/failure-learning/tests/memory.spec.ts`
Expected: PASS.

Run: `git diff --check`
Expected: sin salida.

- [ ] **Step 6: Commit.**

```text
git add packages/failure-learning/failure-learning/src/memory.ts packages/failure-learning/failure-learning/tests/memory.spec.ts .kira/memory/failures.md
git commit -m "feat: persist structured failure memory"
```

## Task 4: Recuperación segura y política de rutas

**Files:** `src/recovery.ts`, `src/route-policy.ts`, `tests/recovery.spec.ts`, `tests/route-policy.spec.ts`.

- [ ] **Step 1: Escribir pruebas de límites y fallback.**

```ts
import { describe, expect, it } from 'vitest'
import { chooseRecovery } from '../src/recovery.ts'
import { decideRoute } from '../src/route-policy.ts'

describe('safe recovery', () => {
  it('never auto-applies a persistent or permission-changing action', () => {
    expect(chooseRecovery({ kind: 'change-credentials', reversible: false })).toMatchObject({ kind: 'approval-required' })
  })
})

describe('route policy', () => {
  it('excludes a verified failure and selects a healthy fallback', () => {
    const decision = decideRoute(
      [{ provider: 'deepseek-official', model: 'flash' }, { provider: 'openai-codex', model: 'gpt-5.6-luna' }],
      [{ confidence: 'verified', affectedRoutes: ['deepseek-official/flash'], fingerprint: 'fp-auth' }],
    )
    expect(decision.selected).toEqual({ provider: 'openai-codex', model: 'gpt-5.6-luna' })
    expect(decision.excluded).toContain('deepseek-official/flash')
  })
})
```

- [ ] **Step 2: Ejecutar y confirmar FAIL.**

Run: `pnpm exec vitest run packages/failure-learning/failure-learning/tests/recovery.spec.ts packages/failure-learning/failure-learning/tests/route-policy.spec.ts`
Expected: FAIL por funciones ausentes.

- [ ] **Step 3: Implementar recuperación y política.**

`chooseRecovery` permitirá únicamente reintento idempotente, reread, backoff, fixture, experimento y fallback a ruta verificada; todo lo demás devolverá `approval-required`. Aplicar máximo tres intentos, timeout explícito y correlation ID obligatorio. `decideRoute` excluirá coincidencias `verified`, penalizará `probable`, preferirá rutas sin fallos y devolverá motivo, exclusiones y estado de confianza sin mutar el roster.

- [ ] **Step 4: Ejecutar pruebas y typecheck.**

Run: `pnpm exec vitest run packages/failure-learning/failure-learning/tests/recovery.spec.ts packages/failure-learning/failure-learning/tests/route-policy.spec.ts`
Expected: PASS.

Run: `pnpm exec tsc -p packages/failure-learning/failure-learning/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit.**

```text
git add packages/failure-learning/failure-learning/src/recovery.ts packages/failure-learning/failure-learning/src/route-policy.ts packages/failure-learning/failure-learning/tests
git commit -m "feat: govern recovery and route selection"
```

## Task 5: Adaptador LLM

**Files:** `packages/llm/llm/src/failure-learning.ts`, `packages/llm/llm/src/index.ts`, `packages/llm/llm/tests/failure-learning.spec.ts`.

- [ ] **Step 1: Escribir la prueba de conversión segura.**

```ts
import { describe, expect, it } from 'vitest'
import { failureFromLlm } from '../src/failure-learning.ts'

describe('LLM failure adapter', () => {
  it('retains provider/model and redacts request secrets', () => {
    const result = failureFromLlm(
      { message: 'invalid token=sk-live-value', code: 'AUTH' },
      { provider: 'deepseek-official', model: 'flash' },
    )
    expect(result.scope).toBe('model')
    expect(result.affectedRoutes).toEqual(['deepseek-official/flash'])
    expect(result.symptom).not.toContain('sk-live-value')
  })
})
```

- [ ] **Step 2: Ejecutar y confirmar FAIL.**

Run: `pnpm exec vitest run packages/llm/llm/tests/failure-learning.spec.ts`
Expected: FAIL porque el adaptador no existe.

- [ ] **Step 3: Implementar el adaptador.**

Usar `normalizeLlmFailure` como única fuente de hechos LLM, redactar el mensaje y conservar `code`, `status` y provider/model. No confiar en códigos de SDK no validados. Exportar `failureFromLlm` desde `packages/llm/llm/src/index.ts` sin cambiar la API de streaming.

- [ ] **Step 4: Ejecutar prueba y regresión LLM.**

Run: `pnpm exec vitest run packages/llm/llm/tests/failure-learning.spec.ts packages/llm/llm/tests/adapter-failure.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```text
git add packages/llm/llm/src/failure-learning.ts packages/llm/llm/src/index.ts packages/llm/llm/tests/failure-learning.spec.ts
git commit -m "feat: adapt LLM failures to learning core"
```

## Task 6: Integrar HARDNESS y su ledger

**Files:** `packages/hardness/adapters/src/lab-mode.ts`, `acquisition-registry.ts`, `mission-orchestrator.ts`, `mission-runtime.ts`, `index.ts`, `tests/failure-learning.spec.ts`.

- [ ] **Step 1: Escribir prueba de ciclo gobernado.**

```ts
it('records a failed mission as hypothesis and never freezes it', async () => {
  const result = await runFixtureMissionThatFails()
  expect(result.kind).toBe('blocked')
  expect(result.learning?.confidence).toBe('hypothesis')
  expect(result.learning?.rollback).toBeTruthy()
  expect(result.learning?.frozen).toBe(false)
})
```

La prueba usará un `ToolRuntime` fixture que devuelve `isError: true`, una memoria en memoria y un `LabMode` aislado.

- [ ] **Step 2: Ejecutar y confirmar FAIL.**

Run: `pnpm exec vitest run packages/hardness/adapters/tests/failure-learning.spec.ts`
Expected: FAIL porque HARDNESS no recibe memoria ni devuelve aprendizaje.

- [ ] **Step 3: Extender `LabMode` y `SelfImprovementLedger`.**

Añadir un registro opcional `FailureLearningRecord` con `failureId`, `confidence`, `rollback`, `sideEffects`, `verified` y `frozen`. Mantener snapshots actuales compatibles. Rechazar `freeze` cuando no exista `holdout`, regresión o rollback.

- [ ] **Step 4: Conectar adquisición y misión.**

`AcquisitionRegistry` registrará BUILD como `hypothesis`. `runHardnessMission` registrará fallos de ejecución, artifact ausente y renderer ausente mediante un sink opcional; conservará la cuarentena actual. Solo una ejecución pasada con evidencia, regresión, holdout y rollback podrá marcar `verified`. `mission-runtime.ts` recibirá dependencias explícitas y no creará memoria implícita.

- [ ] **Step 5: Ejecutar pruebas HARDNESS completas.**

Run: `pnpm exec vitest run packages/hardness/adapters/tests/failure-learning.spec.ts packages/hardness/adapters/tests/mission-learning.spec.ts packages/hardness/adapters/tests/mission-orchestrator.spec.ts`
Expected: PASS.

Run: `pnpm exec tsc -p packages/hardness/adapters/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit.**

```text
git add packages/hardness/adapters/src packages/hardness/adapters/tests/failure-learning.spec.ts
git commit -m "feat: govern failure learning through hardness"
```

## Task 7: Montaje, documentación y evidencia

**Files:** `packages/failure-learning/failure-learning/src/index.ts`, `README.md`, `.kira/evolution-status.md`.

- [ ] **Step 1: Exponer la API final.**

Exportar tipos, redacción, fingerprint, `FailureMemory`, `chooseRecovery`, `decideRoute` y adaptadores sin exponer funciones internas ni permitir mutación directa de snapshots.

- [ ] **Step 2: Documentar uso y límites.**

El README debe mostrar un ejemplo de `FailureMemory`, la diferencia entre `hypothesis`, `probable`, `verified` y `retired`, la regla de aprobación y el procedimiento de rollback. Debe declarar que no se entrenan pesos de modelos ni se modifican credenciales automáticamente.

- [ ] **Step 3: Actualizar estado evolutivo.**

Añadir una pieza con estado `IMPLEMENTADO` solo después de las pruebas finales, enlazando los comandos ejecutados y los commits. No declarar verificación de browser si no se ejecuta browser E2E.

- [ ] **Step 4: Commit.**

```text
git add packages/failure-learning/failure-learning/src/index.ts packages/failure-learning/failure-learning/README.md .kira/evolution-status.md
git commit -m "docs: document failure learning lifecycle"
```

## Task 8: Puerta final de no reincidencia

**Files:** `packages/failure-learning/failure-learning/tests/non-recurrence.spec.ts`, `packages/hardness/adapters/tests/failure-learning.e2e.spec.ts`.

- [ ] **Step 1: Escribir la prueba end-to-end local.**

```ts
it('learns AUTH failure and avoids the same route on the next decision', async () => {
  const first = await executeWithFailure('deepseek-official', 'flash')
  expect(first.failure.confidence).toBe('hypothesis')
  await verifyInHoldout(first.failure.id)
  const second = await chooseNextRoute('AUTH', ['deepseek-official/flash', 'openai-codex/gpt-5.6-luna'])
  expect(second.selected.provider).toBe('openai-codex')
  expect(second.excluded).toContain('deepseek-official/flash')
})
```

- [ ] **Step 2: Ejecutar la prueba para confirmar el contrato.**

Run: `pnpm exec vitest run packages/failure-learning/failure-learning/tests/non-recurrence.spec.ts packages/hardness/adapters/tests/failure-learning.e2e.spec.ts`
Expected: FAIL hasta conectar memoria, verificación y política.

- [ ] **Step 3: Implementar el escenario con fixtures deterministas.**

Usar solo proveedores y herramientas fixture locales. El escenario debe demostrar error, causa registrada, solución validada, holdout, decisión alternativa y segunda ejecución sin reincidencia. No usar credenciales ni red externa.

- [ ] **Step 4: Ejecutar gates finales.**

Run: `pnpm exec vitest run packages/failure-learning/failure-learning/tests packages/hardness/adapters/tests packages/llm/llm/tests/failure-learning.spec.ts`
Expected: todos los tests relacionados PASS.

Run: `pnpm exec tsc -p packages/failure-learning/failure-learning/tsconfig.json --noEmit; pnpm exec tsc -p packages/hardness/adapters/tsconfig.json --noEmit; pnpm exec tsc -p packages/llm/llm/tsconfig.json --noEmit`
Expected: PASS.

Run: `pnpm exec oxlint packages/failure-learning/failure-learning/src packages/hardness/adapters/src packages/llm/llm/src/failure-learning.ts`
Expected: 0 warnings y 0 errors.

Run: `git diff --check`
Expected: sin salida.

- [ ] **Step 5: Registrar evidencia y commit final.**

Añadir los comandos y resultados a `.kira/evidence.md`, revisar `git status --short` y crear:

```text
git add .kira/evidence.md packages/failure-learning/failure-learning/tests/non-recurrence.spec.ts packages/hardness/adapters/tests/failure-learning.e2e.spec.ts
git commit -m "test: prove failure non-recurrence"
```

## Revisión del plan contra la especificación

- Normalización segura y secretos: Task 2 y Task 5.
- Memoria persistente e historial: Task 3.
- Causa, confianza y prevención: Tasks 1–4.
- Reintentos y reparaciones seguras: Task 4.
- Integración `model-router`: Task 4 mediante `route-policy.ts`, sin mutar roster.
- HARDNESS, laboratorio, holdout, rollback y ledger: Task 6.
- No reincidencia verificable: Task 8.
- Documentación, métricas y evidencia: Task 7 y Task 8.
- No se entrena ni modifica el modelo: declarado en arquitectura, README y límites.

El plan no deja pasos con nombres indeterminados, no usa acciones automáticas fuera de aprobación y conserva la separación entre hipótesis y aprendizajes activos.
