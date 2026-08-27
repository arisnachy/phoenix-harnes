# Feedback visible antes y durante las herramientas de PHOENIX

**Estado:** propuesta aprobada verbalmente; pendiente de revisión escrita del usuario
**Fecha:** 2026-08-27

## Objetivo

Cuando una solicitud de usuario requiera herramientas, PHOENIX debe explicar brevemente qué hará antes de la primera herramienta y comunicar progreso útil durante el trabajo. La experiencia no debe mostrar razonamiento interno bruto ni convertir tareas simples en una cascada de mensajes.

## Alcance

- Aplicar a todos los turnos que vayan a invocar una o más herramientas.
- No insertar una introducción artificial en respuestas que no usan herramientas.
- Mostrar estados de alto nivel antes de la primera herramienta, durante cambios de fase y al terminar.
- Mantener la protección HARDNESS y la separación entre estado visible y razonamiento privado.
- Verificar la experiencia en la GUI web actual y cubrir el ciclo con pruebas automatizadas.

## Enfoque elegido

Se usará un diseño híbrido:

1. **Contrato conversacional:** el prompt de despliegue instruye al agente para producir una introducción breve, localizada y orientada a la acción.
2. **Garantía de runtime:** el ciclo de ejecución identifica el inicio del turno con herramientas y publica un estado visible antes de la primera invocación; también publica actualizaciones cuando cambia la fase o aparece un resultado importante.
3. **Presentación final:** el agente entrega un resumen con `IMPLEMENTADO`, `PROBADO`, `VERIFICADO` y `PENDIENTE` cuando corresponda.

La garantía de runtime no fabricará detalles: si no hay una fase o resultado verificable, mostrará un estado genérico y honesto.

## Experiencia y flujo

1. El usuario envía una solicitud.
2. PHOENIX determina si el turno necesita herramientas.
3. Si no las necesita, responde normalmente.
4. Si las necesita, aparece una introducción compacta, por ejemplo: “Voy a revisar la configuración, aplicar el cambio y probarlo en la GUI”.
5. Antes de cada bloque de trabajo significativo se publica un estado de fase: `Revisando`, `Implementando`, `Probando` o `Verificando`.
6. Los resultados de herramientas se resumen en lenguaje humano; no se vuelcan comandos, trazas ni credenciales como sustituto de feedback.
7. Al terminar, el agente presenta resultado, evidencia y cualquier pendiente o bloqueo.

Las actualizaciones deben agruparse por fase para evitar ruido por cada llamada pequeña. Los errores deben indicar qué falló, qué quedó intacto y cuál es el siguiente paso.

## Componentes y límites

- Reutilizar el sistema existente de prompt y las superficies de actividad/progreso ya presentes, sin mezclar esta función con la política de sandbox HARDNESS.
- Mantener los eventos de progreso sanitizados y sin secretos.
- No alterar permisos, límites de sandbox, OAuth ni el contenido de las herramientas.
- La UI debe tolerar sesiones antiguas y eventos incompletos sin romper el chat.

## Pruebas y verificación

- Prueba unitaria: turno sin herramientas no genera introducción artificial.
- Prueba unitaria: turno con herramientas genera exactamente un preámbulo antes del primer tool call.
- Prueba unitaria: varias llamadas dentro de una fase se agrupan y los cambios de fase generan estados separados.
- Prueba unitaria: errores generan feedback visible sin filtrar payloads sensibles.
- Prueba de integración/E2E: la GUI muestra introducción, progreso y cierre en el orden correcto.
- Verificación en la URL PHOENIX existente tras reconstrucción y refresco; no se levantará un servidor sustituto.

## Publicación

- Trabajar en una rama dedicada, por ejemplo `kira/visible-progress-hardness`.
- Ejecutar las pruebas focales y las verificaciones de build antes de publicar.
- Crear un commit intencional y un PR de revisión en GitHub.
- No modificar `main` directamente ni subir secretos, tokens o archivos OAuth.

## Fuera de alcance

- Mostrar el razonamiento interno del modelo.
- Rediseñar toda la actividad lateral o el sistema de herramientas.
- Crear una segunda capa de permisos o un nuevo proveedor MCP.
- Cambiar la política de actualización/auto-evolución protegida por HARDNESS.
