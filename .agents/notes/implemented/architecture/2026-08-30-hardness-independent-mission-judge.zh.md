# Agent Note: independent HARDNESS mission judge

Status: implemented

English | [中文](2026-08-30-hardness-independent-mission-judge.md)

## Problem

Una ejecución de capacidad podía producir evidencia sin una decisión persistente que demostrara que el objetivo de la misión se había cumplido realmente, por lo que la finalización dependía de la afirmación del propio ejecutor.

## Decision

El ejecutor de misiones HARDNESS bloquea el objetivo, los entregables, los criterios obligatorios y los requisitos de calidad al iniciar la misión. Cada criterio avanza por los estados de evidencia `PENDING`, `IMPLEMENTED`, `TESTED` y `VERIFIED`. El ejecutor entra en `VERIFYING` antes de invocar a un juez estructurado independiente, que devuelve `pass`, `needs_changes` o `blocked`, un resumen limitado, revisiones por criterio, hallazgos del control de calidad, referencias de evidencia y cambios requeridos.

El kernel acepta `pass` solo cuando cada criterio obligatorio tiene evidencia, el control de calidad aprueba con evidencia y la decisión cubre el objetivo bloqueado. Un `pass` incompleto se persiste como `needs_changes`; no puede establecer `DONE` ni promover la evidencia de capacidad. La única otra acción terminal es la cancelación explícita del usuario. El juez predeterminado inicia un subagente nuevo con una lista permitida de herramientas de solo lectura y el proveedor LLM configurado. No puede editar archivos, ejecutar comandos ni iniciar otro agente. La falta del proveedor, una salida malformada o un fallo del juez producen una decisión en espera en lugar de una misión exitosa. El estado se reproduce como `ACTIVE`, `RECOVERING`, `WAITING_EXTERNAL`, `VERIFYING` o `DONE`.

Los fallos de intentos, planes, herramientas y estrategias siguen siendo registros descartables. Las huellas de estrategias repetidas se ponen en cuarentena, y el protocolo de bloqueo registra la causa, las rutas alternativas y las dependencias faltantes para reanudar. El texto parecido a una plantilla dentro de la memoria reciente de aprendizaje se inserta como contenido literal, por lo que el código que contiene `{{...}}` no se interpreta como una variable.

Los fallos descartables de una herramienta activan una recuperación limitada: la capacidad fallida se pone en cuarentena, ATLAS se consulta de nuevo y se prueba otro proveedor cuando existe. Cuando la misión se ejecuta dentro de un objetivo durable, su identidad se deriva del objetivo y no del identificador de llamada de cada turno, de modo que las rondas posteriores reproducen el mismo kernel. El juez puede usar búsqueda y consulta web de solo lectura para comparar productos, interfaces, documentos y trabajo visual con estándares externos pertinentes antes de aprobar la calidad.

El registro de capacidades trata un registro idéntico con la misma versión como una contribución de montaje idempotente y cuenta sus propietarios. Un descriptor con la misma versión pero semántica diferente sigue fallando de forma explícita, y una revisión anterior continúa siendo rechazada. Esto permite que una proyección del host y un preset de agente reanudado compartan un descriptor sin ocultar una colisión real de versiones.

随附的 `standard`、`code` 和 `cordis` 角色使用同一条任务完成规则。只要仍有必需交付物或验证未完成，它们就不得输出最终答复；一次尝试失败后必须改用实质不同的策略；无法安全绕过的物理或人工依赖必须保存为 `WAITING_EXTERNAL`。模型只请求最少的外部操作，并且只有独立评审者基于证据给出通过结论，或用户明确取消任务时，才能关闭任务。

## Alternatives considered

**Confiar en la verificación del ejecutor:** se rechazó porque el mismo camino que produjo el artefacto también decidiría si su propio trabajo aprobó.

**Cerrar después de una llamada exitosa a una herramienta:** se rechazó porque el éxito de una herramienta no demuestra que se cumplieran el objetivo del usuario o los criterios de calidad.

**Usar el agente principal como su propio juez:** se rechazó porque no ofrece un contexto de revisión independiente y puede heredar las suposiciones del camino de ejecución.

## Consequences

Las misiones exitosas requieren un proveedor de juez disponible y evidencia explícita, mientras que las misiones incompletas o bloqueadas externamente siguen pudiendo reanudarse en lugar de cerrarse falsamente. Cuando el juez solicita cambios, el orquestador recibe las reparaciones requeridas y puede volver a planificar sin promover el artefacto actual. La revisión adicional consume una llamada al modelo, pero su esquema limitado y su lista de herramientas hacen la decisión auditable e impiden que el revisor modifique el trabajo revisado.

## Testing

Las pruebas enfocadas del adaptador HARDNESS cubren aprobación, reparaciones solicitadas, ausencia de juez, proveedores no disponibles, liberación, decisiones persistentes del kernel, fallos repetidos de estrategia y reproducción. Las pruebas del registro cubren el registro idempotente con la misma versión y el rechazo de revisiones incompatibles. La prueba de presets ensamblados verifica la regla de misión no terminal en los tres roles incluidos. El typecheck del adaptador pasa y el catálogo de persistencia generado pasa su comprobación de actualidad.
