# PHOENIX Sports Intelligence · Protocolo original recuperado (84 pasos operativos)

**Origen:** documentos de planificación remitidos el 8 y 9 de noviembre de 2026 (10 universales + 74 específicos); las fuentes de noticias, árbitros y opinión externa constituyen capas adicionales explícitas. Esta reconstrucción se conecta a los expedientes de ticket por `sports-original-deep-protocol.ts`.

**Importante:** 84 son los requisitos catalogados, NO 84 pasos ejecutados en cada juego. Cada partido recorre 10 universales + los 12/13 de su deporte. No se valida un subindicador solo porque la API de una categoría general haya respondido HTTP 200. El estado individual puede ser `verified`, `partial` o `missing`; la capa de adquisición también debe conservar contradicción, antigüedad y fuente de los datos.

## 10 etapas universales

- **U01** · Descubrir evento: deporte, liga, contendientes, ID, fecha, sede, hora local y UTC
- **U02** · Historial 5/10/20, temporada, local/visitante y fuerza de calendario
- **U03** · Rendimiento de ambos: eficiencia, tendencias y métricas avanzadas específicas
- **U04** · Individualizar jugadores decisivos, titulares/suplentes y cruces uno contra uno
- **U05** · Lesiones, inactivos, limitación de minutos, sanciones y noticias verificadas
- **U06** · Contexto: viajes, descanso, estadio, árbitros, clima y motivación competitiva
- **U07** · Redundancia: principal, respaldo, concordancia, fecha y discrepancias
- **U08** · Modelo propio por mercado, incertidumbre, calibración y backtest cronológico
- **U09** · Mercados, cuotas reales, movimientos, casa, reglas y valor vs probabilidad
- **U10** · Auditoría adversarial, noticias, consenso experto, correlación y defensa por pata

## NBA / WNBA · 12

- **B01** · Confirmar fecha, localía, estado, arena e ID NBA/WNBA
- **B02** · Temporada y últimos 5, 10 y 20 encuentros con fecha y rival
- **B03** · Local/visita, margen, fuerza de rivales y calendario ajustado
- **B04** · Offensive Rating, Defensive Rating, Net Rating y Pace por ambos equipos
- **B05** · PTS anotados/permitidos, eFG%, TS%, TOV%, ORB/DRB%, FT rate y 3P rate
- **B06** · Estrellas y rotación: PTS, AST, REB, MIN, USG%, TS%, on-court impact
- **B07** · Quintetos, combinaciones, on/off, minutos de suplentes y matchups
- **B08** · Lesiones propias y rivales, gravedad, restricciones de minutos y parte oficial fechado
- **B09** · Back-to-back, 3 en 4 noches, descanso en horas, viajes y fatiga
- **B10** · Matchups base-alero-pívot: interior, perímetro, rebotes, defensa y H2H actual
- **B11** · Modelos separados de ganador, spread y totales; sensibilidad a estrellas
- **B12** · Cuotas exactas, línea, proveedor, hora, movimientos, noticias y auditoría de selección

## NHL · 12

- **H01** · Identidad, cancha, fecha, zona y últimos juegos
- **H02** · Últimos 5/10/20 y fortaleza de los oponentes
- **H03** · Distinguir 60 minutos vs OT y shootout
- **H04** · Goles a favor/en contra, diferencial, tiros y tendencia local/visita
- **H05** · xG/xGA, 5v5, high-danger chances, Corsi/Fenwick y calidad de tiro
- **H06** · Porteros SV%, GAA, GSAx, últimas 5 salidas y fatiga
- **H07** · Portero titular real de cada equipo con Confirmed/Likely/Unconfirmed
- **H08** · PP%, PK%, faceoffs, penalizaciones y duelo de unidades especiales
- **H09** · Líneas, parejas defensivas, scratches, lesiones y suspensiones
- **H10** · Back-to-back, viajes, minutos, portero descansado y home ice
- **H11** · Modelos independientes ML, puck line y totales; empty net y OT/SO
- **H12** · Cuotas, definiciones 60 minutos vs OT/SO, contraste experto y riesgo

## MLB · 13

- **M01** · gamePk, ID ESPN, sede, hora y doble cartelera
- **M02** · Resultados y últimos 5/10/20 con calidad de oposición
- **M03** · Splits global/local/visita, vs LHP/RHP y calendario
- **M04** · Abridores: ERA, FIP/xFIP, WHIP, K%, BB%, IP, últimas salidas, repertorio
- **M05** · Abridor contra la ofensiva rival y lateralidad de bateadores
- **M06** · Lineup: AVG, OBP, SLG, OPS, wOBA, xwOBA, hard-hit y forma
- **M07** · Matriz bateador vs pitcher, pitcheos, tamaño de muestra y recencia
- **M08** · Bullpen 24/48/72h, entradas, disponibilidad y fatiga
- **M09** · Lineups confirmados, receptores, bajas, IL y sustituciones
- **M10** · Parque, techo, viento/dirección, humedad, temperatura y park factors
- **M11** · Defensa, corrido de bases, carreras por inning y errores
- **M12** · Modelar ML partido completo, F5, run line y totales por separado
- **M13** · Cuota real, run line, abridores declarados, 9 innings y reglas de liquidación

## NFL · 12

- **N01** · Semana, estadio, kickoff y localía con evento NFL exacto
- **N02** · Últimos 3/5/10 y dificultad de rivales
- **N03** · EPA/play, success rate, DVOA autorizado, puntos/yardas por drive
- **N04** · QB: titularidad, CPOE, presión, sacks, INT, explosivas y salud
- **N05** · 11 ofensivos + 11 defensivos de cada lado y snap counts
- **N06** · OL vs pass rush, QB protection y blitz/pressure rate
- **N07** · WR/TE frente CB/LB, separaciones, cobertura y H2H
- **N08** · RB y esquema terrestre frente defensa carrera y cajas cargadas
- **N09** · Special teams, turnovers, tercera oportunidad, 4th down y red zone
- **N10** · Lesiones, práctica, inactivos 90m, viajes, bye y descanso
- **N11** · Viento, lluvia, temperatura, superficie, techo y patadas
- **N12** · Modelos ML/spread/total, cuota, news, árbitros y contraargumentos

## Soccer mundial · 13

- **S01** · Liga, fase, sede, equipos, kickoff y localía verificable
- **S02** · Últimos 5/10/20, calendario y dificultad de rivales
- **S03** · Splits local/visita, goles, puntos, tendencias de 1X2
- **S04** · Goles, xG/xGA, diferencia y calidad de ocasiones por equipo
- **S05** · Posesión, tiros, tiros a puerta, grandes oportunidades y conversión
- **S06** · Goleadores, asistentes, portero, defensas, mediocampo y minutos
- **S07** · Tácticas, formación, pressing, duelo lateral/central y vulnerabilidades
- **S08** · H2H reciente sin sobrevalorar plantillas antiguas
- **S09** · Once confirmado/probable, suplentes, bajas, sanciones y rotación
- **S10** · Descanso, viajes, fecha FIFA, congestión y prioridades
- **S11** · Tabla, incentivo, árbitro, clima, altitud y césped
- **S12** · Modelos 1X2/empate, doble oportunidad, BTTS, goles y handicap (90m)
- **S13** · Cuotas exactas, reglas 90m, news, mercado y auditoría adversarial

## Tenis ATP/WTA · 12

- **T01** · Torneo, ronda, cancha, superficie, formato y horario
- **T02** · Ranking, Elo y últimos 5/10/20 de ambos
- **T03** · Forma indoor/outdoor y superficie dura/arcilla/hierba
- **T04** · Primero %, puntos primer/segundo, aces y dobles faltas
- **T05** · Puntos ganados al resto y break points generados/convertidos
- **T06** · Hold%, break%, tie-breaks, sets y juegos ganados/perdidos
- **T07** · H2H total y misma superficie con fechas
- **T08** · Fuerza y estilo de rivales, calidad de resultados y Elo superficie
- **T09** · Lesión, médica, retiradas, walkovers y estado de ambos
- **T10** · Minutos, carga, viajes, descanso y cambio de superficie
- **T11** · Simulación ML, sets/juegos/hándicaps y distribución de scores
- **T12** · Cuota, retiros, super-tiebreak, walkover y settlement

## Capas adicionales que también se acordaron

| Capa | Evidencia necesaria | Fuentes primarias y alternativas |
|---|---|---|
| Noticias | Medio, fecha de publicación, relación con partido, jugador o lesión, fotografía atribuida | ESPN News, comunicaciones oficiales, RSS, GDELT, prensa local |
| Expertos/consenso | Pick, línea, precio cuando exista, publicación, aciertos retrospectivos, grado de independencia | Covers, SportsLine, Dimers, Pickswise, Forebet según cobertura y condiciones |
| Árbitros y oficiales | Asignación confirmada, faltas, penales/tarjetas y tendencias ajustadas | Liga oficial, boxscores históricos; no asumir favoritismo por cifras brutas |
| Individual vs rival | Jugador vs defensor; bateador vs pitcher; atacante vs portero; QB vs presión | Boxscores oficiales, StatsAPI, Statcast, NHL/NFL/NBA tracking cuando autorizado |
| Rendimiento en sede | Localía, estadio, parque, techo, altitude, clima, parciales históricos y calidad de rivales | Calendarios, boxscores, Open-Meteo, estadísticas oficiales |
| Cuotas y valor | Apertura, movimiento, casa, línea, periodo, fecha de actualización, probabilidad implícita sin margen | ESPN Site/Core como precios observados; proveedores exactos y Juancito para oferta local |
| Auditoría adversarial | Contraargumentos, cambios tardíos de titulares, lesiones, fuentes contradictorias, correlación de patas | Expediente propio, informes oficiales y noticias con sello temporal |

## Encadenamiento real de adquisición

1. Cargar partido/fecha y comprobar IDs reales de liga, equipo, atleta y recinto.
2. Inicializar los 10 pasos universales más los 12/13 específicos en estado `missing`.
3. Intentar fuente principal y verificar **contenido útil**, no solo HTTP 200.
4. Si no entrega el dato requerido, ejecutar respaldo 1; si sigue faltando, respaldo 2 autorizado. Mantener historial de intentos.
5. Normalizar fecha, rival, localía, periodo, unidad y cobertura; evitar filtrar estadísticas de otra temporada o equipo.
6. Cotejar bajas, titulares, porteros, abridores y árbitros con las fuentes oficiales en el último corte pertinente.
7. Mostrar durante la investigación lo que se obtuvo y lo que falta, con un contador real por etapa.
8. Ejecutar modelos de ganador/margen/totales/props distintos, comparar contra mercado observado y calcular riesgos sin leakage.
9. Contrastar prensa y pronósticos de terceros como evidencia contextual, nunca como fuente primaria de disponibilidad.
10. Defender cada pata por escrito y con evidencia visual enlazada, explicando aciertos y riesgos; evaluar resultado tras el encuentro.

## Estado de implementación frente a la especificación

El motor previo usaba 8 o 9 pasos compactos por deporte y permitía agrupar subindicadores. Esta rama añade un protocolo separado de **22 o 23 pasos granulares por partido** y los presenta en el dossier del ticket. Un dato general se conserva solo como `partial`, hasta que se verifique el subindicador específico. **No se penaliza al equipo por el fallo de una fuente**.

Pendiente de validar como proceso completo: conectores oficiales de lesiones NBA/WNBA PDF, lineup NHL/MLB/NFL/soccer al inicio, fuentes actuales de xG y GSAx, árbitros, noticias/consenso, cuota exacta de Juancito, modelos predictivos calibrados y recuperación automática de cada indicador a través de múltiples fuentes. El catálogo de fuentes no equivale a una prueba de producción.

## Evidencia de rutas

La [auditoría HTTP de 119 rutas](ENDPOINT_AUDIT_REAL_2026-11-10.md) identifica las rutas de ESPN y respaldos realmente ensayadas. Para demostrar que un paso **se completó** no basta el catálogo: se necesita guardar el resultado que atravesó el adaptador, su valor, su fuente, su hora y el ID del encuentro.
