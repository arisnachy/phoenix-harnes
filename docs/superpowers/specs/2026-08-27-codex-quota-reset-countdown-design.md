# Diseño: cuenta regresiva compacta de límites Codex

## Objetivo

Mejorar el indicador compacto de cuota Codex situado junto a Settings para que muestre cuánto falta para el reinicio de cada ventana, sin aumentar de forma significativa el espacio ocupado ni confundir el límite de 5 horas con el semanal de 7 días.

## Diseño visual

El indicador será una cápsula contenedora con dos segmentos internos claramente separados:

```text
╭────────────────────────────────────────────╮
│  5h  97%  ━━━━━━━━━━   │   7d  76%  ━━━━━━━ │
│      ↻ 2h 18m           │       ↻ 4d 6h       │
╰────────────────────────────────────────────╯
```

- Cada segmento conserva la etiqueta de ventana (`5h` o `7d`).
- El porcentaje continúa siendo el dato principal.
- La cuenta regresiva usa texto secundario y un icono de reinicio discreto.
- Un divisor vertical separa visualmente ambas ventanas.
- Las barras de progreso permanecen sutiles y no compiten con el contador.
- El tooltip de cada segmento explica el límite y puede incluir la fecha/hora exacta.

En anchos reducidos se conserva la identificación de las ventanas y se compacta el contenido: `5h · 2h18m | 7d · 4d6h`. El porcentaje puede ocultarse solo en el breakpoint estrecho si la geometría actual lo exige.

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
