# PHOENIX Sports · Fuentes gratuitas de lesiones sin API key

## Integración operativa

El motor de expedientes `src/ticket-specialist-gate.ts` llama a
`src/free-injury-web.ts` **en paralelo** con la investigación del partido.
Las fuentes son accesibles mediante HTTP público, sin cuentas, claves ni
servicios de pago. El HTTP público no garantiza que el sitio permita todas las
consultas automatizadas; los errores se registran y no se interpretan como
plantillas sanas.

| Disciplina | Fuente | URL | Evidencia incorporada |
| --- | --- | --- | --- |
| NBA | NBA oficial | https://official.nba.com/nba-injury-report-2026-27-season/ | Descubre enlaces PDF reales por fecha/hora antes del inicio, **no interpreta el contenido del PDF** |
| NBA | Action Network | https://www.actionnetwork.com/nba/injury-report | Registros individuales en tablas HTML cuando el equipo, jugador y estado aparecen vinculados en la misma fila |
| NBA | B4SK3T | https://www.b4sk3t.com/injuries | Registros individuales en tablas HTML con vinculación estricta |
| NBA | FOX Sports | https://www.foxsports.com/nba/injuries | Registros individuales solo si la tabla atribuye expresamente el equipo |
| NHL | FOX Sports | https://www.foxsports.com/nhl/injuries | Igual: observación secundaria, no scratches confirmados |
| NFL | FOX Sports | https://www.foxsports.com/nfl/injuries | Igual: observación secundaria, no lista definitiva de inactivos |

ESPN, que ya está integrado en `espn-injury-backup.ts`, sigue ofreciendo el
feed JSON por liga y por equipo; estas fuentes añaden contraste independiente.
Para MLB/WNBA/fútbol se mantienen los adaptadores existentes, sin inventar una
cobertura externa que todavía no se ha probado.

## Garantías de interpretación

- **Fuente accesible ≠ lesión verificada.** Un `200 OK`, un encabezado o una
  noticia no acreditan que alguien esté fuera.
- El índice oficial NBA solo se marca como **PDF enlazado**. Hasta que exista
  extracción validada del PDF y vinculación por `eventId`, no sirve como prueba
  automática de `Out` o `Available`.
- Solo se retienen filas con nombres de ambos equipos cotejados y un único
  jugador/estatus individual reconocibles. Si la página exige JavaScript,
  bloquea la lectura o no publica el equipo en la fila, se registra sin forzar
  una identificación.
- Los estados secundarios no sustituyen el reporte oficial ni el quinteto.
  Si alguno contradice ESPN, se conserva el hallazgo para revisar.
- No hay **look-ahead**: los informes actuales no se utilizan para reconstruir
  estados prepartido después de comenzar el juego.
- Consulta HTTP limitada por fuente a 2.8 s; caché breve de 90 s solo en la red
  real. No se añade ninguna variable de entorno ni API key.
- La UI dispone de las fuentes en `specialistResearch.freeInjuryChecks` y
  `endpointAudit`; si hay nombres vinculados, se exponen en `pendingSteps`
  para cotejo con el informe oficial.

## Pruebas

```powershell
node --experimental-strip-types --test packages/core/tool-sports/tests/free-injury-web.test.mjs
node --experimental-strip-types --test packages/core/tool-sports/tests/ticket-specialist-gate.test.mjs
```

### Trabajo posterior necesario

Para cerrar por completo la incidencia #1732 hay que implementar un parser
fiable del PDF oficial NBA y contrastar historial de participación real por
jugador, con instantáneas cronológicas. Este módulo solo incorpora fuentes
adicionales y enlaces verificables: **no asigna probabilidades ni aprueba
automáticamente una apuesta por una baja reportada**.
