# NBA LAB → PHOENIX/Kira: transferencia de investigación A–Q

## Contrato disponible

El lector \`src/nba-lab-research-handoff.ts\` acepta un objeto JSON
\`phoenix.nba.read-model.v1\` y devuelve expedientes NBA de **solo investigación**.
La fuente inicial es un expediente histórico de nueve juegos del 15 de noviembre
de 2026: 596 de 846 campos registrados, 250 campos faltantes; el ZIP histórico
debe importarse **por separado**, sin publicarse como datos vivos en este repositorio.

El paquete de entrega contiene: \`PHOENIX_KIRA_READ_MODEL.json\`,
\`manifest.json\`, \`index.json\`, nueve \`games/{eventId}.json\`,
\`research/research_queue.json\`, \`coverage/field_ledger.csv\`,
\`sources/endpoint_registry.json\`, y la auditoría de 56 lesiones
cuarentenadas contra una edición oficial identificada del PDF de NBA.

**El código no incluye los datos privados/externos, no los descarga ni se registra
automáticamente como herramienta del chat**. El host debe suministrar el JSON
por un canal explícitamente autorizado (archivo adjunto, storage local o conector).

## Puntos de integración nativos

- \`basketball-evidence-dossier.ts\`: reconciliar el evento, los equipos y datos.
- \`nba-specialist-supervisor.ts\`: integrar checklist histórico como **contexto**,
  ejecutar de nuevo la investigación especializada para cada partido.
- \`daily-specialist-checklist.ts\`: los estados \`verified|partial|missing\`
  describen evidencia de la captura, no validan apuestas.
- \`sports-research-coverage.ts\`: reconsultar solo campos ausentes con fuentes
  adecuadas; HTTP 200 no implica que el dato exista.
- \`sports-ticket-decision.ts\`: NO recibir elegibilidad, EV ni precio operativo
  desde este lector; requiere cuota viva y un modelo calibrado independiente.

## Fallos demostrados y prioridades

- 56 atribuciones de lesiones en cuarentena: 32 cruces entre eventos y 24 con
  el rival; la edición externa NBA 14:45 ET identifica los 56 equipos.
  **El PDF binario original del laboratorio no estaba en la evidencia**;
  no se debe reasignar en automático ni usar una edición posterior al tipoff.
- K: 36 campos ausentes (quintetos/rotaciones actuales).
- Q: 36 (decisión final y elegibilidad).
- N: 34 (noticias y restricciones).
- M: 32 (H2H, matchups); investigar \`summary.seasonseries\`.
- P: 27 (calibración, intervalo e EV).
- E: 19 (fortaleza de rivales calculada as-of).
- J: 19 (impacto y participación de lesiones).
- H/I: 18 cada uno (transición/media cancha, impacto de jugadores).
- L: 9 viajes; D: 2 splits de visita.

## Regla de protección

No convertir el expediente histórico ni una probabilidad de ESPN en una
recomendación operable. No confundir roster, quinteto histórico, projected y
confirmed. Cuando el instante capturado sea posterior al comienzo de un partido
(el 401909985 estaba \`in\`), prohibir su uso como entrenamiento pregame.
Registrar siempre edición, página y hash del PDF antes de emplear sus lesiones.

**Este PR aporta el contrato de lectura, NO la integración al runtime ni la
completitud de A–Q.** La integración operativa necesita un adaptador autorizado
de archivos y pruebas de extremo a extremo.
