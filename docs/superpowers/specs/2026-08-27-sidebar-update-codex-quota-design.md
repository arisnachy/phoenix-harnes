# Diseño: visibilidad del updater y cuota OpenAI Codex

English | [中文](2026-08-27-sidebar-update-codex-quota-design.zh.md)

## Objetivo

Corregir el sidebar de PHOENIX para que una actualización ausente no ocupe espacio y para que la cuota de cuenta OpenAI/Codex aparezca junto a `Settings` únicamente con una ruta compatible y telemetría válida.

## Decisiones

1. `paused` es un estado de Host válido para diagnóstico, pero no se pinta cuando no hay una actualización accionable.
2. `CodexQuotaRemaining` es dueño de la cuota y no copia código del repositorio `openai/codex`.
3. El componente solo renderiza con `wide`, sesión activa, proveedor OpenAI/Codex y una ventana de límite numérica, finita y acotada.
4. El valor visible es porcentaje restante: `clamp(round(100 - usedPercent), 0, 100)`.

## Pruebas

- El mapa del updater confirma que `paused` no genera etiqueta ni DOM.
- La cuota cubre telemetría ausente, valores inválidos, prioridad de ventanas y cambio de proveedor.
- Build, typecheck, tests focales y refresco de la GUI se ejecutan antes de publicar.

## Seguridad

No se muestran tokens, claves, payloads ni respuestas de autorización. Solo se expone el porcentaje derivado de telemetría ya autorizada.
