# Diseño: visibilidad del updater y cuota OpenAI Codex

## Objetivo

Corregir el sidebar de PHOENIX para que una actualización ausente no ocupe espacio y para que la cuota de cuenta OpenAI/Codex aparezca junto a `Settings` únicamente cuando la sesión activa esté en una ruta compatible y exista telemetría válida.

## Evidencia

- `UpdateFooterAction.updateLabelKey` ya oculta `idle`, `checking`, `current`, `updated` y `off`, pero todavía muestra `paused`; la captura confirma que ese estado produce “Actualizaciones en pausa” sin una actualización accionable.
- `CodexQuotaRemaining` ya reserva el slot `settings.trigger.trailing`, identifica rutas OpenAI/Codex y transforma `usedPercent` en porcentaje restante.
- El TUI de `openai/codex` sigue el mismo contrato: oculta el indicador si la información es desconocida y calcula el porcentaje con telemetría real, sin estimaciones.

## Decisiones

1. Tratar `paused` como estado no visible en `UpdateFooterAction`; se conserva en el contrato Host y en la máquina de estados para diagnóstico y reanudación externa, pero no se pinta como actualización.
2. Mantener `CodexQuotaRemaining` como dueño de la cuota. No copiar código de `openai/codex` ni crear un segundo medidor de contexto.
3. Mostrar la cuota junto a `Settings` solo con `wide`, sesión activa, proveedor OpenAI/Codex y `primaryLimit` o `secondaryLimit` numérico y finito. Sin telemetría, el componente devuelve `null` y no deja hueco.
4. Presentar el valor como porcentaje restante de la cuota de cuenta, con tooltip accesible; el cálculo será `clamp(round(100 - usedPercent), 0, 100)`.

## Pruebas

- Actualizar el mapa de estados para comprobar que `paused` no produce etiqueta ni DOM.
- Conservar y ampliar las pruebas de cuota para OpenAI/Codex, proveedor no compatible, telemetría ausente, valores inválidos y cambio de proveedor.
- Ejecutar build, typecheck, tests focales y verificar la GUI existente tras refrescar.

## Seguridad y alcance

No se mostrarán tokens, claves, payloads ni respuestas de autorización. Solo se expone el porcentaje derivado de telemetría ya autorizada. La integración se mantiene en la rama de trabajo y se pasará a `main` únicamente después de validar la PR.
