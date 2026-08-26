# Agent Note: Búsqueda web resiliente con fallback
Status: implemented

[English](2026-08-26-web-search-free-fallback.md) | 中文

## Problem
Un proveedor de búsqueda de pago puede fallar por cuota, créditos, límites, autenticación, timeout o indisponibilidad. Los reintentos del modelo pueden consumir todo el turno y dejar al agente detenido en `maxStepsPerTurn`.

## Decision
El seam web conserva el proveedor configurado como primario y prueba un proveedor sin claves para Bing/DuckDuckGo después de fallos recuperables. El bucle del agente puede abrir hasta tres turnos de continuación acotados cuando el trabajo pendiente alcanza `maxStepsPerTurn`, sin exigir un nuevo prompt humano. La cancelación y la configuración inválida siguen siendo fallos definitivos.

## Alternatives considered
- Aumentar solo `maxStepsPerTurn`: rechazado porque solo retrasa los bucles sin fin.
- Reintentar silenciosamente todo error: rechazado porque cancelaciones y errores de configuración deben permanecer visibles.
- Exigir una clave de búsqueda de pago: rechazado porque el fallback debe funcionar sin créditos adicionales.

## Consequences
El modelo puede continuar una cadena legítima de herramientas después del límite, mientras los bucles patológicos siguen deteniéndose tras un número acotado de continuaciones automáticas. La búsqueda HTML gratuita puede variar por región o anti-bot y debe tratarse como corroboración, no como disponibilidad garantizada.

## Verification
Las suites focales del bucle y del proveedor web pasan; el smoke real de Bing devolvió fuentes HTTPS normalizadas sin credenciales.
