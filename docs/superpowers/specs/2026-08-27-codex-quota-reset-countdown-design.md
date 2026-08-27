# Diseño: cuenta regresiva compacta de límites Codex

## Objetivo

Mejorar el indicador compacto de cuota Codex situado junto a Settings para que muestre cuánto falta para el reinicio de cada ventana, sin aumentar de forma significativa el espacio ocupado ni confundir el límite de 5 horas con el semanal de 7 días.

## Diseño visual

El indicador será una cápsula contenedora de dos líneas, con las ventanas distribuidas en paralelo y un divisor vertical sutil:

```text
╭──────────────────────────────────────╮
│  5h   97%  ━━━━━━━━━━    7d   76%  ━━━━━━━ │
│       ↻ 2h 18m              ↻ 4d 6h          │
╰──────────────────────────────────────╯
```

- Cada columna conserva su etiqueta de ventana (`5h` o `7d`).
- El porcentaje y la barra son el nivel principal.
- La cuenta regresiva queda debajo como información secundaria.
- El icono `↻` identifica que el valor es tiempo hasta el reinicio.
- Un divisor vertical sutil separa las dos ventanas sin crear tarjetas independientes.
- El tooltip de cada columna explica el límite y puede incluir la fecha/hora exacta.

En anchos reducidos se compactan espacios internos, pero se conservan las dos líneas y las etiquetas `5h`/`7d`; solo se oculta el porcentaje si la geometría actual lo exige.

## Arquitectura y flujo de datos

1. `authorization.list({})` obtiene la telemetría nativa de Codex.
2. `primaryLimit.resetsAt` alimenta la cuenta regresiva de `5h`.
3. `secondaryLimit.resetsAt` alimenta la cuenta regresiva de `7d`.
4. El componente calcula `max(0, resetsAt * 1000 - Date.now())` y actualiza el estado cada minuto.
5. Al llegar a cero, el texto pasa a `disponible` y una nueva lectura de autorización puede actualizar el porcentaje.
6. Si falta `resetsAt` o no es válido, no se inventa una duración: se mantiene la visualización actual de porcentaje/ventana.

## Formato del tiempo

- Menos de 24 horas: `2h 18m`.
- 24 horas o más: `4d 6h`.
- Menos de un minuto: `1m` para evitar mostrar un contador vacío antes del reinicio.
- Cero: `disponible`.

El cálculo será independiente de la zona horaria. La fecha absoluta, si se muestra en tooltip, usará la localización del navegador.

## Estados y accesibilidad

- El segmento completo tendrá un `title` descriptivo y un nombre accesible que incluya la ventana, porcentaje y tiempo restante.
- No se dependerá únicamente del color para distinguir ventanas; `5h` y `7d` siempre serán texto visible.
- Codex no conectado, proveedor no OpenAI/Codex o telemetría ausente: no se renderiza el chip.
- Error de lectura: se conserva el último estado válido durante la carga y se evita mostrar datos fabricados.

## Pruebas

- Formateo de duraciones en minutos, horas, días y cero.
- Render de ambas ventanas con sus respectivos contadores.
- Asociación correcta de `primaryLimit` con `5h` y `secondaryLimit` con `7d`.
- Actualización al avanzar el reloj y limpieza del temporizador.
- Fallback cuando falta `resetsAt`.
- Ocultamiento para proveedores no Codex.
- Revisión visual en el ancho actual del chip y en un viewport estrecho.
