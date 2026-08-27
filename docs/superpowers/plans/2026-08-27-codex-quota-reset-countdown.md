# Cuenta regresiva de cuota Codex — Plan de implementación

> **Para agentes de implementación:** REQUIRED SUB-SKILL: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para seguimiento.

**Goal:** Mostrar en el chip compacto de Settings el tiempo restante para el reinicio de las ventanas Codex de 5 horas y 7 días, manteniendo el porcentaje y una lectura visual compacta.

**Architecture:** Reutilizar `CodexQuotaRemaining` como única fuente de presentación. Normalizar cada ventana a un modelo visual con etiqueta, porcentaje, barra y `resetsAt`; calcular el texto restante en una función pura; actualizar el reloj cada minuto con un único temporizador del componente. Si una ventana no tiene `resetsAt`, conservar su representación actual sin inventar un contador.

**Tech Stack:** React, TypeScript, CSS Modules, Vitest, Testing Library, `@testing-library/react`.

---

## Mapa de archivos

- **Modificar:** `packages/client/ui-model-selection/src/client/CodexQuotaRemaining.tsx`
  - Añadir formateo puro de duración, estado de reloj y estructura de dos líneas.
- **Modificar:** `packages/client/ui-model-selection/src/client/CodexQuotaRemaining.module.css`
  - Convertir el chip en una cápsula de dos filas con columnas flexibles, separador y breakpoint estrecho.
- **Modificar:** `packages/client/ui-model-selection/tests/codex-quota-remaining.client.spec.tsx`
  - Añadir pruebas de formato, asociación de ventanas, actualización del reloj y fallback.

## Tarea 1: Crear pruebas fallantes para el formato y la presentación

**Archivos:**
- Test: `packages/client/ui-model-selection/tests/codex-quota-remaining.client.spec.tsx`

- [ ] **Paso 1: Añadir casos de duración con reloj controlado**

Usar `vi.useFakeTimers()` y `vi.setSystemTime()` para comprobar exactamente:

```tsx
it('formats reset countdowns as hours/minutes and days/hours', () => {
  expect(formatResetCountdown(Date.now() + (2 * 60 + 18) * 60_000)).toBe('2h 18m')
  expect(formatResetCountdown(Date.now() + (4 * 24 + 6) * 60 * 60_000)).toBe('4d 6h')
})

it('uses disponible at or after the reset instant', () => {
  expect(formatResetCountdown(Date.now())).toBe('disponible')
  expect(formatResetCountdown(Date.now() - 1)).toBe('disponible')
})
```

La función debe quedar exportada solo si la convención de pruebas del paquete lo requiere; preferir export nombrado desde el componente para evitar duplicar lógica.

- [ ] **Paso 2: Añadir un fixture de telemetría con ambos `resetsAt`**

Extender el caso de dos ventanas con valores dinámicos basados en un `now` fijo:

```tsx
const now = new Date('2026-08-27T12:00:00.000Z')
vi.setSystemTime(now)
const auth = authorizationWithWindows({
  primary: { usedPercent: 14, windowDurationMins: 300, resetsAt: now.getTime() / 1000 + 2 * 3600 + 18 * 60 },
  secondary: { usedPercent: 9, windowDurationMins: 10080, resetsAt: now.getTime() / 1000 + 4 * 86400 + 6 * 3600 },
})
```

Verificar que el DOM contenga `5h`, `86%`, `↻ 2h 18m`, `7d`, `91%` y `↻ 4d 6h`, y que cada segmento tenga un nombre accesible que identifique su ventana.

- [ ] **Paso 3: Añadir el caso de fallback sin `resetsAt`**

Comprobar que una ventana sin timestamp siga mostrando `5h` y su porcentaje, pero no renderice el texto `↻` ni una duración inventada.

- [ ] **Paso 4: Ejecutar la suite para confirmar que falla antes de implementar**

Ejecutar:

```bash
pnpm exec vitest run packages/client/ui-model-selection/tests/codex-quota-remaining.client.spec.tsx
```

Esperado: FAIL porque no existe el formateador ni la nueva presentación.

## Tarea 2: Implementar el modelo de tiempo y el estado del reloj

**Archivos:**
- Modify: `packages/client/ui-model-selection/src/client/CodexQuotaRemaining.tsx`

- [ ] **Paso 1: Añadir el formateador puro**

Implementar una función con timestamp Unix en segundos y hora actual opcional para hacerla determinista:

```tsx
export function formatResetCountdown(resetsAt: number, nowMs = Date.now()): string {
  const remainingMs = Math.max(0, resetsAt * 1000 - nowMs)
  if (remainingMs === 0) return 'disponible'
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}
```

Validar `resetsAt` antes de llamarla: debe ser finito y no negativo.

- [ ] **Paso 2: Añadir un `clockMs` que se actualice cada minuto**

Inicializarlo con `Date.now()` y usar `window.setInterval(() => setClockMs(Date.now()), 60_000)`. Limpiar el intervalo en el retorno del `useEffect`; si el componente no muestra cuota, el efecto no debe quedar activo. El efecto de carga de autorización seguirá siendo el responsable de actualizar porcentajes y timestamps.

- [ ] **Paso 3: Enriquecer cada ventana visual con el contador opcional**

Conservar `windowLabel()` y `remaining()`. Añadir `resetText` únicamente cuando `resetsAt` sea válido. No mostrar `disponible` como dato inventado para ventanas que no exponen timestamp; `disponible` solo aplica cuando sí existía un timestamp y ya venció.

- [ ] **Paso 4: Renderizar las dos filas**

La estructura de cada ventana debe conservar `5h`/`7d`, porcentaje y barra en la primera fila, y mostrar debajo el contador con `↻` solo cuando esté disponible. Usar `aria-label` y `title` descriptivos, por ejemplo:

```tsx
<section aria-label="Límite de 5 horas; 97% restante; reinicia en 2h 18m">
  <div className={css.summary}>...</div>
  <div className={css.reset}>↻ 2h 18m</div>
</section>
```

No cambiar el filtro que limita este componente a proveedores OpenAI/Codex.

- [ ] **Paso 5: Ejecutar las pruebas focales**

```bash
pnpm exec vitest run packages/client/ui-model-selection/tests/codex-quota-remaining.client.spec.tsx
```

Esperado: PASS en todos los casos existentes y nuevos.

## Tarea 3: Aplicar el diseño CSS compacto y responsive

**Archivos:**
- Modify: `packages/client/ui-model-selection/src/client/CodexQuotaRemaining.module.css`

- [ ] **Paso 1: Cambiar el contenedor a dos filas**

Mantener `height: 28px`, `flex: 0 0 auto`, fondo y radio existentes para no alterar la barra lateral. Usar una cuadrícula interna que permita dos ventanas en paralelo, con `gap` pequeño y un divisor visual mediante `border-left` en la segunda ventana.

- [ ] **Paso 2: Añadir clases de resumen y reinicio**

La fila superior debe alinear `label`, `value` y `track`; la fila inferior debe usar tipografía secundaria, `font-variant-numeric: tabular-nums`, `white-space: nowrap` y opacidad menor. El icono no debe depender de una fuente externa.

- [ ] **Paso 3: Ajustar el ancho estrecho sin romper etiquetas**

Añadir un breakpoint del paquete para reducir padding/gaps y el ancho de barra. No ocultar `5h` ni `7d`. Solo ocultar el porcentaje si las medidas del viewport estrecho demuestran overflow; el tooltip y el contador deben seguir identificando la ventana.

- [ ] **Paso 4: Ejecutar pruebas y comprobación de tipos del paquete**

```bash
pnpm exec vitest run packages/client/ui-model-selection/tests/codex-quota-remaining.client.spec.tsx
pnpm run build:lib:client
```

Esperado: suite focal PASS y compilación cliente sin errores TypeScript.

## Tarea 4: Verificar el artefacto web y la apariencia renderizada

**Archivos:**
- Verificación del componente compilado y de la GUI existente; no crear capturas dentro del repositorio.

- [ ] **Paso 1: Construir los artefactos web afectados**

```bash
pnpm run build:web
```

Esperado: build web exitoso.

- [ ] **Paso 2: Verificar la GUI en `http://127.0.0.1:3080`**

Refrescar la URL existente, abrir o enfocar la sesión conectada a Codex y comprobar visualmente:

```text
╭──────────────────────────────────────╮
│  5h   97%  ━━━━━━━━━━    7d   76%  ━━━━━━━ │
│       ↻ 2h 18m              ↻ 4d 6h          │
╰──────────────────────────────────────╯
```

Comprobar también un viewport estrecho, que no haya overlay de Vite/React y que no aparezcan errores de consola relevantes.

- [ ] **Paso 3: Verificar la actualización temporal**

Con timestamps de fixture o telemetría real próximos, confirmar que el texto cambia tras avanzar el reloj; confirmar que la ausencia de `resetsAt` no muestra valores falsos.

- [ ] **Paso 4: Ejecutar la revisión React final**

Invocar la revisión de buenas prácticas React sobre el componente modificado y corregir solo problemas relacionados con esta implementación.

- [ ] **Paso 5: Revisar estado y realizar commit funcional**

```bash
git diff --check
git status --short
git add packages/client/ui-model-selection/src/client/CodexQuotaRemaining.tsx packages/client/ui-model-selection/src/client/CodexQuotaRemaining.module.css packages/client/ui-model-selection/tests/codex-quota-remaining.client.spec.tsx
git commit -m "feat: show Codex quota reset countdowns"
```

Esperado: sin errores de espacios y commit limitado a la funcionalidad del contador.

## Auto-revisión del plan

- **Cobertura:** incluye diseño de dos líneas, separación `5h`/`7d`, cálculo desde `resetsAt`, actualización por minuto, formatos `h/m` y `d/h`, fallback, accesibilidad, pruebas y verificación web.
- **Placeholders:** no hay `TBD`, `TODO` ni pasos sin comando o criterio observable.
- **Consistencia:** todos los pasos usan `resetsAt` en segundos Unix y la misma función `formatResetCountdown`; el componente, CSS y test apuntan a rutas existentes.
