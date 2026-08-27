# Plan de implementación: sidebar, updater y cuota Codex

English | [中文](2026-08-27-sidebar-update-codex-quota.zh.md)

**Objetivo:** ocultar estados del updater sin acción disponible y mostrar la cuota restante de cuenta junto a `Settings` solo para rutas OpenAI/Codex con telemetría válida.

**Arquitectura:** `UpdateFooterAction` decide la visibilidad sin cambiar el contrato Host. `CodexQuotaRemaining` usa el directorio de modelo por sesión y `authorization.list({})`; no copia módulos de `openai/codex` ni mezcla cuota de cuenta con ocupación del contexto.

**Verificación requerida:** ejecutar tests focales, `pnpm typecheck`, `pnpm build`, refrescar la GUI existente y revisar que no se filtren secretos.

## Cambios implementados

- [x] `paused` es invisible cuando no representa una actualización accionable; permanece en los contratos para diagnóstico.
- [x] La cuota usa `100 - usedPercent`, acotado a `0–100`, y omite telemetría ausente, no finita o fuera de rango.
- [x] Si `primaryLimit` es inválido se usa el primer `secondaryLimit` válido.
- [x] El indicador se registra en `settings.trigger.trailing` y no deja espacio cuando no aplica.
- [x] Las pruebas cubren proveedor compatible, proveedor ajeno, cambio de proveedor, ausencia y valores inválidos.

## Evidencia local

- Tests focales: 3 archivos, 44 tests aprobados.
- Typecheck completo: código de salida 0.
- Build completo: código de salida 0.
- GUI `http://127.0.0.1:3080`: página renderizada, sin “Actualizaciones en pausa” y sin porcentaje inventado cuando la autorización viva no entrega telemetría.

## Publicación

- [x] Rama `kira/visible-progress-hardness` publicada en `origin`.
- [x] PR #60 marcado como listo para revisión, no draft.
- [ ] Fusionar a `main` únicamente cuando todos los checks requeridos estén verdes.
