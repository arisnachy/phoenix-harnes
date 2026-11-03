# PHOENIX WNBA Research — protocolo independiente

**Estado:** especificación. Complementa el [plan maestro](./nba-wnba-basketball-intelligence-plan.md). WNBA no se implementa como un switch de nombres del motor NBA.

## Investigación WNBA: 18 estaciones

1. Calendario WNBA real, fase regular/playoffs/offseason, horarios, ID ESPN y estado pregame.
2. Temporada y rosters vigentes con cambios de club, altas y bajas; no copiar año anterior.
3. Cuatro cuartos de diez minutos (40 reglamentarios), ritmo WNBA por 40 y eficiencia por 100 posesiones.
4. Ranking, W/L, márgenes, últimos 5/10/15, rival, local/visitante y pequeños tamaños de muestra.
5. OffRtg, DefRtg, NetRtg, Four Factors, tiros triples/pintura, rebote, ritmo y contexto.
6. Matchups H2H condicionados por equipo actual, estrellas y disponibilidad real.
7. Reporte oficial WNBA de lesiones y descanso, última publicación y comprobación cercana al tip.
8. Cinco titulares confirmados frente a probables, jugadoras de banco y roles; roster no garantiza participación.
9. Cada titular y suplente clave: minutos, PTS/REB/AST/3PM/BLK/STL/TOV, FT, TS%, USG%, stats por posesión y por 40.
10. Enfrentamientos guard-defensora, wing-perímetro, interior-defensa del aro, tamaño, faltas y switches.
11. Quintetos 5-on-5, on/off, segunda unidad, minutos y usos cuando falta estrella.
12. Calendario, back-to-back, descanso, viajes, compromisos externos solo si verificados.
13. Tácticas reales de entrenadores, transición, pick-and-roll, volumen de triples y defensa interior.
14. Q1 a Q4, primer/segundo tiempo, clutch, blowout y sustituciones por faltas.
15. Noticias confirmadas, periodistas y expertos atribuibles; un titular no equivale a un pick.
16. Mercados disponibles realmente en WNBA por bookmaker: ML/spreads/totales/cuartos/props.
17. Contraste con cuota, línea, identidad de jugadora, OT, DNP y condiciones de devolución de la casa.
18. Conclusión auditada y ledger pregame: lesiones, minutos y resultados reales, además de abstenciones.

## Diferencias no negociables

Comparar ritmo y períodos usando 40 min, nunca datos 48 min sin conversión. Mantener estadísticas y modelos propios de la WNBA y sus temporadas, contratos y lineups. No asumir que tracking, xFG, props o precios son igualmente accesibles que en NBA. La WNBA publica estadísticas avanzadas y quintetos, pero la disponibilidad se verifica por fecha/temporada. El reporte WNBA de lesiones se actualiza durante el día: guardar snapshot y revisarlo antes del tip.

**Ejemplo de investigación:** si una base anotadora enfrenta una línea de 19.5 puntos, estudiar su volumen de tiros, minutos, suplencia de creadoras, defensora probable, faltas, ritmo y posibilidades de blowout. Su promedio de 18 PPG no demuestra una apuesta al under ni viceversa.

## Gates y pruebas WNBA

Temporada sin eventos no crea partidos; ID roster real, cinco titulares, jugadora ausente/no listada no equivale a sana, 40 min y pace/40, datos advanced sin inventar, Q1/FT/OT, player DNP, mercados no disponibles, odds desactualizadas, lines enteras push y fuente de ruleset. Test end-to-end con partido real de regular season y playoffs. WNBA solo se declarará terminada tras su propia validación.

Fuentes oficiales: https://stats.wnba.com/impact/advanced/ ; https://stats.wnba.com/lineups/advanced/ ; https://www.wnba.com/wnba-injury-report ; https://www.wnba.com/wnba-rule-book
