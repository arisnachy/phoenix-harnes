# Adaptadores operativos para skills OpenClaw en PHOENIX

**Estado:** supersedido por `docs/superpowers/specs/2026-08-27-phoenix-skill-operational-adapters-design.md`.

## Objetivo

Hacer que las skills OpenClaw no solo sean cargables en PHOENIX, sino utilizables con un procedimiento operativo explícito: validar entradas, detectar ambigüedad, mapear herramientas OpenClaw a capacidades PHOENIX y explicar dependencias antes de intentar una acción.

## Alcance

- Las 51 skills del catálogo `openclaw/openclaw/skills`.
- El texto upstream y sus recursos permanecen intactos como contenido de referencia.
- Cada skill recibe una capa adaptadora PHOENIX separada.
- Las skills sin una herramienta equivalente no se simulan: quedan instaladas y cargables, pero marcadas como condicionadas.
- La primera integración concreta será `openclaw-weather`, porque permite demostrar desambiguación y fallback sin credenciales.

## Decisiones de arquitectura

### 1. Manifiesto separado

El puente `apps/cli/src/openclaw-skills.ts` generará, junto con `arsenal.json`, un manifiesto `adapters.json` bajo `$DSH_HOME/openclaw-skills/`. El checkout upstream no se modifica. La copia instalada sí se compondrá con un preflight PHOENIX delante del cuerpo upstream, preservando el cuerpo original como bloque de referencia; el alias y el adaptador se mantienen como metadatos PHOENIX.

Cada entrada tendrá esta forma lógica:

```ts ignore-check
interface OpenClawAdapter {
  alias: string
  sourceName: string
  executionMode: 'native' | 'conditional' | 'instruction-only'
  requiredInputs: readonly string[]
  toolMappings: readonly {
    upstream: string
    phoenix: string
    available: boolean
  }[]
  disambiguation?: {
    input: string
    rule: string
    question: string
  }
  fallback?: readonly string[]
  externalRequirements: readonly string[]
}
```

El manifiesto no contendrá tokens, API keys, cookies, datos de cuentas ni valores capturados en tiempo de ejecución.

### 2. Preflight antes de actuar

La copia instalada de cada `SKILL.md` presentará, antes del cuerpo upstream, una sección operativa PHOENIX generada desde el manifiesto. El `skill` tool existente la entregará automáticamente porque sigue cargando el bundle nativo:

1. comprobar `requiredInputs`;
2. aplicar `disambiguation` a nombres ambiguos;
3. elegir solo `toolMappings` con `available: true`;
4. usar `fallback` si la herramienta preferida no está disponible;
5. detenerse y explicar `externalRequirements` cuando falte un runtime, permiso, dispositivo o credencial.

El preflight no ejecutará comandos por sí mismo. Impedirá que el modelo invente una herramienta disponible y le dará una ruta clara para pedir el dato faltante.

### 3. Weather como contrato de referencia

`openclaw-weather` tendrá:

- entrada obligatoria: `location`;
- regla: ciudad sola es ambigua cuando existen coincidencias relevantes;
- pregunta: `¿Qué ciudad, región, aeropuerto o coordenadas quieres consultar?`;
- herramienta preferida: `web_fetch` si el entorno la expone;
- fallback: HTTPS a `wttr.in` mediante el mecanismo de red permitido por PHOENIX;
- ejecución: `native` solo si la herramienta está disponible; de lo contrario `conditional`.

La prueba `Santiago` debe preguntar o resolver con confirmación; `Santiago de los Caballeros, República Dominicana` debe quedar inequívoco antes de consultar.

### 4. Clasificación de las 51 skills

- `native`: existe una herramienta PHOENIX equivalente y el preflight puede dirigirla.
- `conditional`: la instrucción es válida, pero requiere un CLI, API, OAuth, dispositivo o plataforma que debe comprobarse.
- `instruction-only`: PHOENIX puede cargar y explicar la guía, pero no tiene una ruta de ejecución local declarada.

La licencia MIT se registra como licencia de contenido. La gratuidad no se interpreta como disponibilidad gratuita de servicios externos.

## Cambios previstos

- Modificar: `apps/cli/src/openclaw-skills.ts` para generar y validar adaptadores.
- Modificar: `scripts/verify-openclaw-skills.ts` para revisar que cada alias tenga adaptador y que el preflight compuesto sea cargable.
- Modificar: `apps/cli/tests/openclaw-skills.spec.ts` con pruebas RED/GREEN de manifiesto, preflight y desambiguación.
- Crear: `docs/subsystems/openclaw-skill-adapters.md` con el contrato de uso y los estados de ejecución.
- Regenerar: `docs/superpowers/evidence/openclaw-skills-verification.json` incluyendo estado del adaptador, sin secretos.
- No modificar: los `SKILL.md` upstream ni recursos originales salvo el alias técnico ya definido por el puente.

## Verificación

1. El test de adaptador falla antes de la implementación.
2. Las 51 entradas tienen adaptador válido y alias único.
3. `ctx.skills.get()` sigue cargando las 51 skills.
4. El preflight de weather rechaza ubicación ausente o ambigua antes de red.
5. El preflight de weather usa el fallback solo cuando la herramienta preferida no está disponible.
6. Una skill condicionada informa el requisito y no intenta ejecutar una acción no soportada.
7. `pnpm run typecheck`, tests focales y `git diff --check` pasan.

## Fuera de alcance

- Implementar 51 APIs o CLIs externos.
- Provisionar credenciales, OAuth, dispositivos o servicios de pago.
- Ejecutar automáticamente acciones destructivas o enviar mensajes/compras.
- Reescribir o traducir el contenido upstream.
