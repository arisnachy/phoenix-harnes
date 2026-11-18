# NHL LAB → PHOENIX / Kira: investigación A–Q

Se añadió `src/nhl-lab-research-handoff.ts`, contrato NHL análogo al de NBA (`nba-lab-research-handoff.ts`). **En NHL no se inventa una cobertura como 596/846**: hasta ejecutar la investigación real no existe ese resultado.

## Uso nativo

```ts
import {collectNhlResearchHandoff,readNhlResearchHandoff}
  from './src/nhl-lab-research-handoff.ts'

// La fecha y el gameId vienen de la cartelera NHL oficial, no de texto libre.
// El recolector ya usa investigateNhl() y probeNhlOfficialStarters().
const snapshot=await collectNhlResearchHandoff('2026-11-16','2026020255')
const evidence=readNhlResearchHandoff(snapshot)
// Evidencia archivada / investigación: NUNCA aprobación automática del ticket.
```

La fecha/ID anteriores son ilustrativos: se comprueban contra `https://api-web.nhle.com/v1/score/{date}`, y una ausencia produce error, no partido inventado.

## Módulos

- A: identidad, estado, localía, kickoff.
- B: clasificación y forma 5/10/20.
- C: descanso y local/visita; viaje pendiente.
- D: goles, differential y ritmo (sin inventar tiros).
- E: fuerza de rivales (pendiente).
- F: xG/xGA 5v5 (pendiente sin fuente autorizada).
- G: **dos porteros confirmados** mediante NHL gamecenter pregame; un candidato en roster equivale solo a parcial.
- H: estadísticas de porteros; **GSAx pendiente** sin evidencia específica.
- I: plantillas, player game logs y splits comprobables.
- J: lesiones/scratches/sanciones (no inferir del roster).
- K: líneas y parejas defensivas (no inferir del roster).
- L: power play/penalty kill oficiales con ambos equipos.
- M: enfrentamientos y cara a cara; roster-only no equivale a matchup confirmado.
- N: noticias fechadas y corroboradas.
- O: cuota + identidad de mercado 60min/OT/SO; precio antiguo no es operable.
- P: predicción calibrada, validada por fecha (sin valor fabricado).
- Q: decisión basada en evidencia, EV y reglas; pendiente.

Se emite `missingResearch` con ruta recomendada por cada dimensión faltante, `checklistObservations` con estados del investigador nativo y `sourceRecords` con URL, estado y fecha. Un HTTP 200 no equivale a todas las métricas en su interior.

## Fuentes públicas de partida (no datos de una ejecución concreta)

- NHL scoreboard: `https://api-web.nhle.com/v1/score/{YYYY-MM-DD}`
- NHL gamecenter: `https://api-web.nhle.com/v1/gamecenter/{id}/boxscore`
- NHL play-by-play: `https://api-web.nhle.com/v1/gamecenter/{id}/play-by-play`
- NHL player game log: `https://api-web.nhle.com/v1/player/{id}/game-log/{season}/2`
- NHL team summaries PP/PK:
  `https://api.nhle.com/stats/rest/en/team/powerplay`, `https://api.nhle.com/stats/rest/en/team/penaltykill`

El endpoint existe en documentación comunitaria; **el presente PR no ha demostrado por sí mismo una corrida NHL en vivo**. Deben conservarse el as-of y la semántica temporal antes de usar una respuesta para predicción.

## Estado de integración

El módulo es una función reutilizable del paquete nativo `@phoenix-ai/dsh-tool-sports`; **todavía no es una herramienta registrada en la UI de Kira**. La interfaz nativa puede importarla desde el mismo módulo y hacer la investigación por ID de partido. No se han añadido nuevos servicios ni claves de terceros; se reutiliza el investigador NHL existente.

Los datos NHL tienen un contrato distinto de NBA (incluido mercado 60min), pero usan el mismo patrón A–Q de brechas, prueba de integridad y protección frente a confundir investigación con selección de apuestas.
