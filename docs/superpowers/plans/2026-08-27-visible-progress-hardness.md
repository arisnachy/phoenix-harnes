# Plan de implementación: progreso visible de herramientas

English | [中文](2026-08-27-visible-progress-hardness.zh.md)

**Objetivo:** hacer que PHOENIX explique sus próximas acciones antes de usar herramientas y muestre progreso agrupado, localizado y seguro durante el turno.

**Arquitectura:** los presets piden una introducción breve y un cierre con evidencia. La GUI deriva `preparing`, `running-tools` y `verifying` de la línea temporal existente, sin crear eventos persistidos ni exponer argumentos, payloads o razonamiento privado.

## Alcance

- Aplicar el contrato a los presets `standard`, `cordis` y `code`.
- Mantener `role="status"`, `aria-live="polite"`, el reloj y la compatibilidad con sesiones antiguas.
- Localizar los estados en inglés y español.
- Cubrir el cálculo puro, la composición de `ChatView` y el escenario web de cola de herramientas.

## Cambios implementados

- [x] Los tres presets narran antes de herramientas, agrupan avances y separan `IMPLEMENTADO`, `PROBADO`, `VERIFICADO` y `PENDIENTE`.
- [x] `turnProgress` clasifica solo nodos del turno abierto y trata raíces incompletas de forma defensiva.
- [x] `ChatView` muestra estados de preparación, ejecución y verificación sin inspeccionar contenido sensible.
- [x] Las pruebas de conversación y el escenario web cubren el orden de narración, herramienta y verificación.

## Evidencia

- La verificación local incluye tests focales de conversación y UI, typecheck y build.
- La GUI existente se refresca sin iniciar un servidor sustituto.
- La publicación usa la rama dedicada y no incluye credenciales, tokens ni archivos OAuth.
