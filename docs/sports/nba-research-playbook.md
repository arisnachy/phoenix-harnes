# PHOENIX NBA Research — protocolo por partido

**Estado:** especificación. Complementa el [plan maestro](./nba-wnba-basketball-intelligence-plan.md); no es predictor implementado.

## Investigación NBA: 18 estaciones

1. Cartelera y fase NBA con ID ESPN, horario RD, estadio y verificación de pregame.
2. Forma y ranking: W/L temporada, últimos 5/10/20, diferenciales, rivales y local/visita.
3. Descanso, back-to-back, tres partidos en cuatro noches, viajes, OT reciente y carga por jugador.
4. OffRtg/DefRtg/NetRtg y Four Factors por 100 posesiones, pace/48 y muestras.
5. Ataque vs defensa rival: triples, pintura, transición, halfcourt, tiros libres, pérdidas y rebotes.
6. H2H reciente condicionado por roster, lesiones, entrenador y minutos.
7. NBA injury report oficial con estado y fecha; confirmar minuto limitado y disponibilidad.
8. Roster real por ID; cinco titulares oficiales vs probables, banco, suplentes y cambios de club.
9. Cada titular: PTS, REB, AST, 3PM, TOV, STL, BLK, FG%, TS%, USG%, minutos y recientes 5/10.
10. Matchups individuales: ball handler vs point-of-attack, wings, poste vs aro, pick-and-roll, coberturas.
11. Quintetos 5-on-5, combinaciones, on/off de estrellas y muestras de posesiones.
12. Segunda unidad: creación y rebote cuando las estrellas descansan, hábitos de sustitución.
13. Cargas, foul trouble, defensores con faltas, small ball, esquemas de switch y zona.
14. Q1/Q2/Q3/Q4, 1H/2H y clutch; escenarios de blowout y OT cuando mercado lo incluye.
15. Árbitros, noticias, entrenadores, reporteros y picks externos por autor y fecha.
16. Inventario real de ML, spread, team/game total, quarters/halves, props PTS/REB/AST/3PM/PRA.
17. Confrontación de cada tesis con cuota, casa, línea, período, reglas DNP/OT y contradicciones.
18. Dictamen de Kira y ledger pregame, posterior boxscore/settlement, evaluación sin datos futuros.

## Matrices de jugadores y unidades

Para cada uno de los cinco titulares y suplentes relevantes: ID actual, estado, minutos/uso, stats por 36 y por 100 posesiones, defensor(es) probable(s), patrón de coberturas, habilidades que explotan o neutralizan al oponente y alternativas tácticas. Para cada combinación real de cinco: minutos, pace, ortg, drtg, netrtg, posesiones y cambios al salir estrella; si faltan datos, marcar pendiente.

**Ejemplos de preguntas de mercado:** ¿El creador mantendrá asistencias frente a defensas que niegan líneas de pase? ¿El pívot capturará rebotes si el rival usa cinco tiradores abiertos? ¿Una estrella con minutos restringidos puede cubrir puntos aunque venga anotando mucho? No concluir basándose solo en promedios.

## Gates y pruebas NBA

Identidades de evento/equipos/jugadores sin confundir casa; cinco titulares confirmados solo con fuente; lesiones y último reporte fechado; periodos 48 min, OT, Q1, 1H, FT; spreads enteros con push; props DNP y reglas reales de casa; mercados stale; contrato research opportunity común. Test end-to-end con partido NBA de regular season y playoff. Ningún pick se presenta como ganador cierto ni se atribuye edge sin validación fuera de muestra.

Fuente principal: https://www.nba.com/stats/help/glossary
