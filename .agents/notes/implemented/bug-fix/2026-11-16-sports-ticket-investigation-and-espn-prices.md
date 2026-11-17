# Agent Note: Investigación deportiva y precios ESPN del ticket

Status: implemented

## Problem

La guía del generador podía encadenar el shortlist diario y el ticket cotizado; un resultado incompleto recomendaba iniciar el otro flujo y ambos podían repetirse. El timeout exterior competía con la investigación sin cancelar las lecturas HTTP pendientes. Además, los precios tenían prioridad en la selección de candidatos antes de revisar el mérito deportivo. En el flujo de shortlist, una observación ESPN marcada para relectura aún podía entrar al ticket, y la ficha del evento determinaba vigencia usando `updatedAt` en lugar de la hora de lectura ESPN.

## Decision

La solicitud amplia usa una sola llamada a `sports_chat_ticket_evidence_priced_auto`. La tarjeta parcial termina esa solicitud; una relectura exacta de `researchFixtures` es la única recuperación dirigida. Si vence el plazo del ticket, el controlador cancela las consultas fetch pendientes y devuelve el checkpoint más reciente.

Los candidatos se ordenan por evidencia histórica y revisión especializada. La disponibilidad de un precio solo restringe el grupo elegible para completar el ticket; no añade un bono al ranking. Cuando existe una misma casa con suficientes precios ESPN frescos, el generador elige dentro de ese conjunto por la puntuación de investigación.

ESPN solo aporta una cuota elegible cuando `observedAt` tiene menos de 15 minutos y coinciden evento futuro, ID, equipos, inicio, casa, mercado, selección y precio. `updatedAt` del bookmaker puede faltar. La ficha del evento y el ticket usan el mismo criterio y distinguen observación ESPN de aceptación en la casa.

Una observación ESPN antigua que no logra actualizarse queda fuera del ticket final. Los predictores ESPN nunca se convierten en precio. La tarjeta informa la hora de lectura y no afirma que la casa acepte el importe ni que la selección vaya a ganar.

## Alternatives considered

**Mantener el orden por precio y ampliar las explicaciones.** Pierde porque el precio podía decidir qué juegos recibían revisión especializada, aunque la elección declarada debía basarse en investigación.

**Mantener el encadenamiento de herramientas y elevar el timeout.** Pierde porque el ciclo de reintentos puede exceder cualquier plazo y las operaciones perdedoras de `Promise.race` siguen consumiendo recursos.

**Rechazar toda cuota ESPN que no incluya `updatedAt` del bookmaker.** Pierde porque ESPN proporciona una hora de lectura independiente; exigir el último cambio de la casa descartaría observaciones recientes válidas para investigación.

## Consequences

El flujo ya no repite automáticamente una búsqueda de calendario cuando falta una cuota o un dato médico. Un ticket puede terminar incompleto si ESPN no ofrece una lectura fresca, una casa identificada o las cinco patas requeridas. `observedAt` demuestra cuándo PHOENIX leyó el precio, pero no demuestra que la casa lo acepte. El ranking sigue siendo descriptivo: no existe una garantía de ganar ni una probabilidad calibrada para cada ticket.

## Verification

`node --experimental-strip-types --test` con las siete suites focalizadas del ticket, la selección diaria, la observación ESPN, la ficha del evento, la guía de investigación y el timeout: 65 pruebas pasan. `pnpm run build:lib` completó servidor y cliente. `pnpm run test:snapshot:refresh -- -t sports-ticket-guidance` pasó (1 prueba; 12 archivos omitidos) y registró el prompt, la herramienta y sus esquemas en la aplicación montada. `pnpm run doc-sync` terminó con 19/28 gates aprobados y 9 fallidos en el baseline: doc-typecheck apunta a un import inexistente en `NHL_LAB_RESEARCH_HANDOFF.md`; pairing, wrap, 1449 JSDoc, catálogo de herramientas, documentación de paquetes y clasificación/formato de notas reportan otros archivos preexistentes. La comprobación JSDoc filtrada no encontró violaciones en `packages/core/tool-sports`; los fallos de clasificación/formato no señalan esta nota.
