# Diseño: feedback visible antes y durante las herramientas

English | [中文](2026-08-27-visible-progress-hardness-design.zh.md)

**Estado:** implementado y verificado localmente.

**Fecha:** 2026-08-27

## Objetivo

Cuando una solicitud requiere herramientas, PHOENIX explica brevemente qué hará antes de la primera herramienta y comunica progreso útil durante el trabajo sin mostrar razonamiento interno bruto.

## Enfoque

1. El prompt de despliegue solicita una introducción breve, localizada y orientada a la acción.
2. La GUI deriva fases seguras de la línea temporal: preparación, ejecución de herramientas y verificación.
3. El agente termina con resultado, evidencia y pendientes cuando corresponda.

## Límites

- No se crean eventos persistidos nuevos.
- No se exponen comandos, nombres de herramientas, argumentos, credenciales ni payloads.
- Las sesiones antiguas y nodos incompletos no deben romper el chat.
- No se modifican permisos, OAuth, sandbox ni la política de actualización.

## Verificación

La cobertura combina pruebas unitarias del cálculo, tests de UI, escenario web de integración y refresco de `http://127.0.0.1:3080`.
