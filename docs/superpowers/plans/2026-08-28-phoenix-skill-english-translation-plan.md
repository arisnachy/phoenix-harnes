# Plan de traducción inglesa de skills de PHOENIX

> **Para agentes:** usa `codex-superpowers-subagent-driven-development` (recomendado) o `codex-superpowers-executing-plans` para ejecutar este plan tarea por tarea. Las tareas usan casillas (`- [ ]`).

**Objetivo:** ofrecer un overlay inglés completo para cada skill visible en PHOENIX, preservando cuerpos upstream, identificadores técnicos, comandos, URLs, licencias y rutas de recursos.

**Arquitectura:** generar el overlay específico de locale durante la carga de la skill, usando el mismo snapshot dinámico de `ctx.skills.list()` que usan los adaptadores operativos. El contenido original sigue siendo la fuente de verdad; las traducciones se almacenan por separado y de forma auditable. La verificación falla si una respuesta inglesa mezcla etiquetas generadas en español/chino o pierde tokens técnicos obligatorios.

**Tecnología:** TypeScript, `@phoenix-ai/dsh-skill`, `@phoenix-ai/dsh-tool-skill`, overlays en filesystem, evidencia Markdown/JSON y Vitest.

---

### Tarea 1: Inventario y contrato de traducción

**Archivos:**
- Leer: `docs/superpowers/evidence/skill-operational-adapters-verification.json`
- Crear: `docs/superpowers/specs/phoenix-skill-english-translation-design.md`
- Crear: `docs/superpowers/evidence/skill-english-translation-inventory.json`

- [ ] Congelar el inventario visible por nombre, provider, hash de fuente, recursos y tokens técnicos.
- [ ] Definir el contrato del overlay: la prosa traducida queda separada, el cuerpo fuente se puede recuperar y nombres/comandos/URLs/bloques de código se preservan exactamente.
- [ ] Exigir revisión humana para instrucciones legales, médicas, financieras, destructivas o sensibles a credenciales antes de promocionarlas.

### Tarea 2: Construir el loader de overlays ingleses

**Archivos:**
- Modificar: `packages/skill/skill/src/operational.ts`
- Modificar: `packages/skill/tool-skill/src/index.ts`
- Test: `packages/skill/tool-skill/tests/tool-skill.spec.ts`

- [ ] Añadir selección de overlay `locale: 'en'` después de generar el preflight operativo.
- [ ] Hacer fallback al contenido original con etiqueta explícita cuando no exista traducción revisada; nunca fingir silenciosamente una traducción completa.
- [ ] Preservar los mismos gates de seguridad y preflight en español e inglés.
- [ ] Verificar que el camino model-facing y `/skill` produzcan overlays ingleses idénticos con las mismas capacidades.

### Tarea 3: Traducir y revisar cada skill visible

**Archivos:**
- Crear: `docs/skills/en/<skill-name>.md` o el almacén de overlays aprobado en la tarea 1.
- Crear: `docs/superpowers/evidence/skill-english-translation-review.json`

- [ ] Traducir propósito, activadores, flujo, requisitos, notas de seguridad y recursos de cada fila del inventario.
- [ ] Preservar nombres exactos, flags CLI, nombres de campos API, código, rutas, URLs y avisos de licencia/fuente citados.
- [ ] Registrar por skill los estados `translated`, `reviewed`, `fallback` y `needs-human-review`; no declarar completitud si hay fallback.
- [ ] Mantener todas las etiquetas generadas en inglés y rechazar chino accidental o fragmentos mezclados.

### Tarea 4: Verificar locale e integridad de fuentes

**Archivos:**
- Crear: `scripts/verify-skill-english-overlays.ts`
- Modificar: `package.json`
- Crear: `docs/subsystems/skill-english-overlays.md`

- [ ] Verificar que cada skill visible tenga overlay o estado de fallback explícito.
- [ ] Verificar hashes de fuente y preservación de tokens técnicos.
- [ ] Verificar que las cargas inglesas de `skill` tengan preflight inglés y no etiquetas chinas accidentales.
- [ ] Reportar traducciones faltantes como pendientes, nunca ocultarlas.

Ejecutar: `pnpm run verify:skill-english-overlays`

Resultado esperado: cero fallos de integridad y conteo explícito de traducción.

### Tarea 5: Aceptación

- [ ] Ejecutar: `pnpm exec vitest run packages/skill/skill/tests packages/skill/tool-skill/tests`
- [ ] Ejecutar: `pnpm run typecheck`
- [ ] Ejecutar: `pnpm run verify:skill-operational-adapters`
- [ ] Ejecutar: `pnpm run verify:skill-language-hygiene`
- [ ] Ejecutar: `git diff --check`
- [ ] Reportar por separado conteos traducidos, revisados y pendientes.

## Límites explícitos

- No sobrescribir archivos upstream `SKILL.md`.
- No traducir ni exponer credenciales, datos de cuentas ni historial privado.
- No afirmar que un servicio externo funciona porque sus instrucciones estén traducidas.
- No promocionar automáticamente una traducción de máquina para instrucciones sensibles sin revisión.
