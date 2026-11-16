# NHL — fuentes prepartido para PHOENIX (16 de noviembre 2026)

## Estatus de titularidad
La NHL no ofrece un SLA público de publicación de porteros titulares confirmados antes del partido. El boxscore con una bandera starter explícita es evidencia cuando se publica antes del faceoff; un roster, dos porteros listados o un portero probable no son confirmación.
Daily Faceoff, RotoWire y PuckPedia son referencias editoriales para cotejo de porteros/lineups; la presencia pública de un HTML no autoriza scraping masivo. Guardar autor, URL, status, publishedAt, observedAt y si la fuente tiene autorización.

## Licencias
- PuckPedia prohíbe robots y scraping: https://puckpedia.com/terms-of-use
- RotoWire prohíbe scraping y acceso automatizado no autorizado: https://www.rotowire.com/termsandconditions.php
- Daily Faceoff: no activar scraping de HTML/JSON interno sin verificar permisos.
- BALLDONTLIE Free admite 5 solicitudes/min, pero injuries y projected_lineups son GOAT; las projected_lineups NO son confirmadas: https://nhl.balldontlie.io/

## Ruta NHL sin clave para scratches
GET https://api-web.nhle.com/v1/gamecenter/{NHL_GAME_ID}/right-rail
La estructura documentada por proyectos externos es gameInfo.homeTeam.scratches y gameInfo.awayTeam.scratches. No prometer publicación 30 minutos antes: no existe SLA pública.

Implementado: src/nhl-pregame-scratches.ts con timeout 4 s y parser defensivo. Primero cotejar NHL gameId, ambas franquicias y horario; nunca usar eventId ESPN como gameId NHL. Capturar únicamente pre-kickoff. Si faltan los dos arrays explícitos, 404 o 204, el estado es not-published, no cero bajas. Si aparecen, es observed, NO official final lineup. Guardar timestamp de lectura, no inventar publicación. Identidad contradictoria descarta el resultado.
Clasificar scratches como observados, no necesariamente healthy. Para lesión o suspensión definitiva cruzar con partes datados de ESPN/club, con identidad de jugador y franquicia. Si no hay prueba, mantener desconocido. La NHL puede actualizar la lista cerca del inicio.

## Integración
- A-Q módulo J incorpora scratches pregame en paralelo con lesiones ESPN. Continúa parcial hasta parte definitivo.
- ticket-specialist-gate.ts registra endpoint y observa scratches sin promover a titulares o apuestas.
- Corrige xG: si MoneyPuck retorna xGF/xGA 5v5 de los dos clubes como verified, el chequeo ya no lo marca missing.
- ESPN lesiones: https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries; ausencia de equipo no es salud confirmada.
- ESPN transacciones: https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/transactions como contexto, no sustituto de lesiones.

## Siguiente ejecución y calidad
Agenda sugerida T-180, T-90, T-45, T-20 y T-5 min, con caché y cuotas de proveedores respetadas. Recalcular al pasar de probable a confirmado o cambiar lesión de cuestionable a fuera. No elevar la apuesta sin estado de portero comprobado, lesiones críticas cerradas, mercado reconciliado y modelo calibrado.
Comando prueba: node --experimental-strip-types --test packages/core/tool-sports/tests/nhl-pregame-scratches.test.mjs packages/core/tool-sports/tests/nhl-lab-research-handoff.test.mjs
Los tests validan contratos con fixtures; no prueban publicación real antes de un partido.