# Prueba OpenAI Orquestador y Luna Ejecutor Implementation Plan

English | [中文](2026-08-27-openai-orquestador-luna-ejecutor.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verificar y dejar documentada una prueba temporal en la que el modelo OpenAI elegido conserva la orquestación y las delegaciones ejecutan con `openai-codex/gpt-5.6-luna` y `reasoningEffort: high`.

**Architecture:** Reutilizar la ruta condicional `childRoute` ya presente en el preset estándar y en los runtimes de `subagent` y `workflow`. El padre conserva su selección; únicamente el hijo cambia a Luna `high` cuando el padre usa `openai-codex`. La medición se obtiene de los eventos/proyecciones de sesión y de la vista existente de subagentes.

**Tech Stack:** TypeScript, YAML, Vitest, pnpm, PHOENIX session events/projections, GUI web existente.

---

## Mapa de archivos

- `apps/cli/config/agent-presets/standard/agent.cordis.yml` — configuración estándar de las tres rutas delegadas; ya contiene el enrutamiento experimental y solo se modificará si la validación detecta una discrepancia.
- `packages/subagent/tool-subagent/tests/tool-subagent.spec.ts` — prueba de la ruta `subagent` y `subagent_fork`; se ampliará para los tres modelos raíz.
- `packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts` — prueba de la ruta de workers y de sus límites.
- `packages/llm/token-meter/tests/token-usage-projection.spec.ts` — contrato de acumulación de tokens existente; se usará como evidencia, sin duplicar el proyector.
- `packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx` — contrato de visualización de tokens y duración de hijos; se usará para verificar la medición visible.
- `docs/superpowers/specs/2026-08-27-openai-orquestador-luna-ejecutor-design.md` — especificación aprobada de alcance y aceptación.

## Decisiones de implementación

La ruta actual ya está implementada en el preset estándar y condicionada por `whenProvider: openai-codex`. No se añadirá `whenModel`, porque los contratos actuales de `tool-subagent` y `workflow-worker-thread` solo admiten condición por proveedor. Los modelos raíz Sol, Luna y Terra pueden compartir la ruta ejecutora sin que el selector cambie.

No se creará una pantalla de métricas: los eventos `assistant/message` contienen uso, `subagent/start`/`subagent/end` delimitan delegaciones y la GUI ya muestra tokens y duración. La reversión de la prueba consiste en retirar las tres entradas `childRoute` del preset o revertir el commit experimental.

---

### Task 1: Probar los tres modelos raíz en `subagent`

**Files:**
- Modify: `packages/subagent/tool-subagent/tests/tool-subagent.spec.ts:289-327`

- [ ] **Step 1: Convertir la prueba existente en una tabla de modelos raíz**

Reemplazar la prueba que solo usa `gpt-5.4` por una prueba parametrizada con este cuerpo, conservando los helpers e imports ya existentes:

```ts
it.each(['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra'])(
  'routes OpenAI root %s children to Luna high without changing a non-OpenAI parent route',
  async (rootModel) => {
    let seen: { agentOptions?: { provider?: string; model?: string; reasoningEffort?: string } } | undefined
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'capture-route',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async (request) => {
        seen = request
        return {
          id: SessionId('capture-route-child'),
          localAgent: undefined,
          result: Promise.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' as const }),
          dispose: async () => {},
        }
      },
    })
    await ctx.plugin(tool, {
      provider: 'capture-route',
      childRoute: {
        whenProvider: 'openai-codex',
        provider: 'openai-codex',
        model: 'gpt-5.6-luna',
        reasoningEffort: 'high',
      },
      maxDepth: 'provider-managed',
    })

    const openAiParent = { ...fakeAgent(), options: { provider: 'openai-codex', model: rootModel } } as Agent
    await callSubagent(ctx, { description: 'd', prompt: 'p' }, { agent: openAiParent })
    expect(seen?.agentOptions).toEqual({ provider: 'openai-codex', model: 'gpt-5.6-luna', reasoningEffort: 'high' })

    const otherParent = { ...fakeAgent('other-parent'), options: { provider: 'openrouter', model: 'ox-alpha' } } as Agent
    await callSubagent(ctx, { description: 'd', prompt: 'p' }, { agent: otherParent })
    expect(seen?.agentOptions).toBeUndefined()
  },
)
```

- [ ] **Step 2: Ejecutar la prueba focal**

Run:

```text
pnpm exec vitest run packages/subagent/tool-subagent/tests/tool-subagent.spec.ts
```

Expected: PASS, incluyendo las tres variantes `gpt-5.6-sol`, `gpt-5.6-luna` y `gpt-5.6-terra`, además del caso no OpenAI.

- [ ] **Step 3: Revisar el diff para evitar cambios fuera de la prueba**

Run:

```text
git diff -- packages/subagent/tool-subagent/tests/tool-subagent.spec.ts
```

Expected: solo la parametrización de la prueba y ningún cambio en el runtime.

- [ ] **Step 4: Commit de la regresión**

```text
git add packages/subagent/tool-subagent/tests/tool-subagent.spec.ts
git commit -m "test: cover OpenAI root models for Luna delegation"
```

---

### Task 2: Confirmar workflow y límites de ejecución

**Files:**
- Modify: `packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts:179-203`

- [ ] **Step 1: Parametrizar el padre OpenAI del test de workflow**

Usar una tabla para ejecutar el mismo caso con cada raíz, manteniendo una sola ejecución por variante y verificando el límite ya configurado:

```ts
it.each(['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra'])(
  'routes OpenAI workflow root %s to Luna high and preserves the cap',
  async (rootModel) => {
    const { ctx, provider } = await setup({
      config: {
        maxConcurrentAgents: 2,
        maxTotalAgents: 2,
        childRoute: {
          whenProvider: 'openai-codex',
          provider: 'openai-codex',
          model: 'gpt-5.6-luna',
          reasoningEffort: 'high',
        },
      },
    })
    const result = await run(
      ctx,
      fakeParent({ provider: 'openai-codex', model: rootModel }),
      scripted("return await agent('review the focused change')"),
    )
    expect(result.stopReason).toBe('completed')
    expect(result.agentsStarted).toBe(1)
    expect(provider.runs[0]?.request.agentOptions).toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'high',
    })
  },
)
```

- [ ] **Step 2: Ejecutar la prueba focal de workflow**

Run:

```text
pnpm exec vitest run packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts
```

Expected: PASS para las tres raíces y para el resto de pruebas de límites/concurrencia.

- [ ] **Step 3: Commit de la regresión de workflow**

```text
git add packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts
git commit -m "test: cover OpenAI workflow roots for Luna delegation"
```

---

### Task 3: Validar configuración y medición existente

**Files:**
- Verify: `apps/cli/config/agent-presets/standard/agent.cordis.yml:195-257`
- Verify: `packages/llm/token-meter/tests/token-usage-projection.spec.ts`
- Verify: `packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx`

- [ ] **Step 1: Validar que las tres entradas de preset sean idénticas**

Comprobar que `tool-subagent`, `tool-subagent-fork` y `workflow-worker-thread` contengan exactamente `whenProvider: openai-codex`, `provider: openai-codex`, `model: gpt-5.6-luna` y `reasoningEffort: high`, sin cambiar otros proveedores.

Run:

```text
pnpm run verify-cordis-config
```

Expected: PASS.

- [ ] **Step 2: Verificar acumulación de tokens sin doble conteo**

Run:

```text
pnpm exec vitest run packages/llm/token-meter/tests/token-usage-projection.spec.ts
```

Expected: PASS, incluyendo reemplazo de muestras por uso final y acumulación de `uncachedInputTokens`, `outputTokens`, `cacheReadTokens` y `cacheWriteTokens`.

- [ ] **Step 3: Verificar tokens y duración visibles para hijos**

Run:

```text
pnpm exec vitest run packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx
```

Expected: PASS, incluyendo la métrica durable de tokens y la duración activa/congelada del subagente.

- [ ] **Step 4: Registrar evidencia de la configuración sin editarla**

Run:

```text
git diff -- apps/cli/config/agent-presets/standard/agent.cordis.yml
```

Expected: salida vacía; la ruta ya existente permanece sin cambios y queda cubierta por las pruebas.

---

### Task 4: Verificación integrada y reversibilidad

**Files:**
- Verify: `apps/cli/config/agent-presets/standard/agent.cordis.yml`
- Verify: `packages/subagent/tool-subagent/tests/tool-subagent.spec.ts`
- Verify: `packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts`

- [ ] **Step 1: Ejecutar el conjunto focal completo**

Run:

```text
pnpm exec vitest run packages/subagent/tool-subagent/tests/tool-subagent.spec.ts packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts packages/llm/token-meter/tests/token-usage-projection.spec.ts packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx
```

Expected: PASS sin modificar los archivos locales preexistentes.

- [ ] **Step 2: Construir los artefactos requeridos por la GUI existente**

Run:

```text
pnpm run build
```

Expected: compilación completa sin errores.

- [ ] **Step 3: Verificar la GUI actual tras refrescarla**

Usar la GUI existente en `http://127.0.0.1:3080`, refrescar la página y comprobar que el selector sigue mostrando las opciones normalmente. No iniciar un servidor sustituto. Si el watcher `pnpm run dev:web` ya está activo, reutilizarlo; si no, la comprobación se limita al artefacto construido y a la carga del URL existente.

Expected: la interfaz carga, el selector sigue operativo y no hay errores de consola relacionados con esta prueba.

- [ ] **Step 4: Confirmar reversibilidad y preservar cambios ajenos**

Run:

```text
git status --short
git diff --stat HEAD~2..HEAD
```

Expected: los únicos commits de esta misión son la especificación y las regresiones de prueba; los cambios locales anteriores permanecen sin ser staged ni modificados.

- [ ] **Step 5: Commit final de evidencia si la verificación pasa**

```text
git add packages/subagent/tool-subagent/tests/tool-subagent.spec.ts packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts
git commit -m "test: verify temporary OpenAI Luna orchestration trial"
```

---

## Revisión del plan

- **Cobertura de especificación:** raíz conservada (Tasks 1–2), hijos Luna `high` (Tasks 1–2), selector intacto y proveedores no OpenAI sin redirección (Tasks 1 y 4), profundidad/límites (Tasks 2 y 4), tokens/duración/delegaciones (Task 3), reversibilidad y cambios locales (Task 4).
- **Marcadores incompletos:** no hay `TODO`, `TBD` ni instrucciones abiertas.
- **Consistencia:** todos los pasos usan `gpt-5.6-luna`, `reasoningEffort: high`, `openai-codex`, `maxDepth: 1` y los límites de workflow actuales de dos agentes.
