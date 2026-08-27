# Phoenix Activity Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir el halo naranja difuso del indicador activo por una animación orbital azul-dorada, nítida, suave y accesible.

**Architecture:** Mantener el componente `TurnStatus` y el logotipo existente; ampliar el emblema activo a 28 px y construir la nueva composición exclusivamente con los pseudo-elementos CSS de `.phoenixActivity`. Conservar `prefers-reduced-motion` como contrato de accesibilidad y verificar el resultado en la GUI existente.

**Tech Stack:** React, TypeScript, CSS Modules, Vitest, Testing Library, Vite.

---

### Task 1: Exigir el nuevo tamaño activo

**Files:**
- Modify: `packages/client/ui-conversation/tests/chat-view.client.spec.tsx:953-963`
- Modify: `packages/client/ui-conversation/src/client/chat/ChatView.tsx:154-158`

- [ ] Añadir a la prueba existente:

```ts
expect(activeLogo?.getAttribute('width')).toBe('28')
expect(activeLogo?.getAttribute('height')).toBe('28')
```

- [ ] Ejecutar:

```text
pnpm exec vitest run packages/client/ui-conversation/tests/chat-view.client.spec.tsx -t "ignites the PHOENIX emblem"
```

Esperado: FAIL porque el emblema activo todavía mide 24 px.

- [ ] Cambiar `PhoenixLogo size={24}` por `PhoenixLogo size={28}`.

- [ ] Repetir la prueba. Esperado: PASS.

### Task 2: Implementar el aro orbital

**Files:**
- Modify: `packages/client/ui-conversation/src/client/chat/ChatView.module.css:72-186`

- [ ] Ajustar `.turnStatus` a `height: 30px`, `gap: 10px` y shimmer de `2.4s`.
- [ ] Convertir `.phoenixActivity` en un contenedor de `32×32px`, aislado con `isolation: isolate`, sin escalado brusco.
- [ ] Usar `::before` como aro `conic-gradient` azul-violeta-dorado con máscara central y rotación de `2.4s`.
- [ ] Usar `::after` como resplandor interior naranja-azul de respiración suave.
- [ ] Sustituir `phoenix-fire-pulse` y `phoenix-flame` por `phoenix-orbit` y `phoenix-breathe`.
- [ ] Suavizar `phoenix-complete` para un destello breve sin rebote mayor de `1.08`.
- [ ] Incluir ambos pseudo-elementos en el bloque `prefers-reduced-motion` y dejar transformaciones estáticas.

### Task 3: Verificar código y artefactos

- [ ] Ejecutar la suite completa:

```text
pnpm exec vitest run packages/client/ui-conversation/tests/chat-view.client.spec.tsx
```

Esperado: PASS.

- [ ] Ejecutar:

```text
pnpm --filter @deepseek-ai/dsh-client-ui-conversation run build
pnpm run build:web
```

Esperado: ambas compilaciones terminan sin errores.

### Task 4: Verificar la GUI real

- [ ] Comprobar si `pnpm run dev:web` ya está activo; no iniciar servidor sustituto.
- [ ] Refrescar `http://127.0.0.1:3080/`.
- [ ] Activar una ejecución breve y comprobar: logo nítido, aro azul-dorado, resplandor contenido, texto legible y consola sin errores.
- [ ] Emular `prefers-reduced-motion: reduce` y confirmar que el aro queda estático.
- [ ] Guardar captura en `.kira/audits/phoenix-activity-animation.png`.

### Task 5: Cerrar el cambio

- [ ] Revisar `git diff` y confirmar que `.kira/ci-consumers-202443.log` permanece ajeno.
- [ ] Ejecutar la verificación final antes de afirmar completitud.
- [ ] Registrar únicamente el componente, CSS, prueba y plan.
