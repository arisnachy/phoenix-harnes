# PHOENIX Soccer Intelligence — Plan maestro mundial de investigación

**Fecha de diseño:** 2026-11-02  
**Estado:** PLAN OPERATIVO, no predictor implementado, no apuestas garantizadas.  
**Disciplina:** fútbol asociación (soccer), masculino, femenino, clubes, selecciones, juveniles y copas.  
**Principio vinculante:** investigar como un analista humano experimentado, desde los hechos del partido hasta el mercado. Kira razona con fuentes, contradicciones, contexto y escenarios; no impone una fórmula universal ni inventa probabilidades.

## 0. Objetivo y límites fundamentales

Construir un **especialista de fútbol mundial** que descubra partidos de todas las competiciones legítimas accesibles, descarte juegos que no disponen de información suficiente, abra expedientes profundos de los candidatos, compare las alineaciones jugador por jugador y el encaje táctico de los equipos, compruebe opiniones de terceros, contraste con líneas de una casa real y emita hipótesis auditables de mercados. Las oportunidades investigadas se incorporarán más adelante al coordinador multideporte de 5–6 patas junto con MLB/NBA/NFL/NHL/tenis.

No existe una API gratuita única que asegure alineaciones, xG, mapas de disparos, bajas, árbitros, prensa y cuotas para absolutamente todos los partidos del planeta. La ambición de cobertura global significa **descubrimiento mundial con profundidad por nivel de evidencia**, no cobertura inventada. Ninguna selección se anuncia como ganadora cierta; Kira puede concluir «sin evidencia suficiente» y debe hacerlo cuando corresponda.

**Diferencia con béisbol:** no trasladar ERA, bullpen, run line ni modelos de carreras al soccer. Mantener la MISMA disciplina de investigación, trazabilidad, comparación con casa y contrato para el agregador, pero usar variables y reglas del fútbol.

## 1. Universo de competiciones: registro global, dinámico y verificable

El registro parte de País → confederación → competición → temporada → fase → jornada → partido → equipos. Soporta ascensos, cambios de nombre y temporadas partidas; los ID de un proveedor se guardan en un espacio de nombres separado para no confundir equipos que se llaman igual.

- **CONCACAF / Norteamérica y Caribe:** MLS, Liga MX, Leagues Cup, USL, NWSL, US Open Cup, Canadá, Costa Rica, Honduras, Guatemala, El Salvador, Panamá, República Dominicana (LDF), Jamaica y competiciones CONCACAF de clubes y selecciones.
- **CONMEBOL / Sudamérica:** Argentina (Liga Profesional, Copa), Brasil (Brasileirão A/B y copas), Colombia, Chile, Uruguay, Paraguay, Perú, Ecuador, Bolivia, Venezuela; Libertadores, Sudamericana, Recopa y torneos continentales femeninos.
- **UEFA / Europa:** Premier League, Championship y otras ligas inglesas; LaLiga y Segunda; Serie A/B; Bundesliga/2. Bundesliga; Ligue 1/2; Portugal, Países Bajos, Bélgica, Turquía, Grecia, Escocia, países nórdicos, Balcanes y Europa oriental; Champions, Europa League, Conference, Euro, Nations League y copas nacionales.
- **AFC / Asia:** Japón J1/J2, Corea K1/K2, China, Arabia Saudita, Emiratos Árabes Unidos, Qatar, India, Tailandia, Indonesia, Australia afiliada AFC, torneos de clubes y selecciones.
- **CAF / África:** Egipto, Marruecos, Túnez, Argelia, Sudáfrica, Nigeria, Ghana, Senegal y demás ligas verificadas; Champions CAF, Confederation Cup, AFCON y eliminatorias.
- **OFC / Oceanía:** Nueva Zelanda, Fiyi y otras competiciones disponibles, más clubes/selecciones OFC.
- **FIFA / Internacional:** Mundial masculino y femenino, clasificatorias por confederación, amistosos, mundiales juveniles, torneos olímpicos y clubes.
- **Fútbol femenino y juvenil:** liga femenina de España, Inglaterra, Francia, Alemania, Italia, NWSL, Liga MX Femenil, A-League Women, Copa Libertadores Femenina, Champions femenina, academias/sub-20/sub-17 cuando haya datos. Nunca mezclar estadísticas de categoría y sexo como si fueran la misma distribución competitiva.

**Descubrimiento:** catálogo ESPN + listado dinámico cuando fuente lo permita; API-Football/otros proveedores conectados por el usuario, football-data.org u oficiales; registrar cobertura por competición/temporada/partido. La etiqueta «liga existente» no equivale a «tiene odds», «tiene titulares» ni «tiene xG».

**Niveles de cobertura:**
- A: resultados + plantillas + alineaciones + eventos, estadísticas de partido, jugador, xG/calidad de ocasiones documentada, árbitros, bajas y cuotas;
- B: partidos + equipos + plantillas/jugadores + alguna estadística + cuotas o lesiones incompletas;
- C: calendario, resultados, forma, clasificación y datos parciales; **solo investigación descriptiva**, sin forzar picks individuales;
- D: identidad/fecha/no confirmados; **no apto para ticket**.
La etiqueta A/B/C/D es de **cobertura**, no probabilidad de éxito; calcular por partido, no por nombre de liga.

## 2. Proveedores, verificación, licencias y auditoría de fuentes

- **ESPN Site/Core**: fixture/scoreboard, summary, boxscore, standings, team, roster, líderes, injuries, news y PickCenter cuando exista realmente; endpoints no documentados pueden cambiar, registrar error y campos útiles por ruta; aprovechar el explorador integrado de PHOENIX.
- **API-Football (API-Sports)** cuando el operador esté autorizado: countries, leagues/coverage, seasons, fixtures, lineups, events, fixture/player/team statistics, squad, transfers, injuries, sidelined, predictions, odds; su indicador coverage es orientativo y puede variar por temporada y fixture. No activar licencias ni cobrar sin autorización.
- **football-data.org**: competitions, matches, standings con cortes local/visitante, teams y scorers según plan y cobertura.
- **Fuentes oficiales de ligas, clubes, federaciones y torneos:** comunicados de alineaciones, partes médicos, sanciones, árbitros, cambios de entrenador, fechas, sedes/neutralidad.
- **Datos de eventos avanzados** (xG, xA, presión, cadenas de pases, post-shot xG, mapas, FBref/Opta/StatsBomb/Wyscout): solo si una fuente autorizada **realmente los entrega** y se puede confirmar definición, unidades y muestra. StatsBomb Open Data es un conjunto público HISTÓRICO PARCIAL, no un feed en vivo global.
- **Noticias y expertos:** ESPN, Covers, analistas deportivos públicos e informes de periodistas verificables; registrar autor, fecha y pick/mercado literal si se accede realmente. Un titular indexado no prueba un pick, un pronóstico ni una lesión.
- **Clima:** Open-Meteo u otro servicio permitido por coordenadas del estadio y hora del partido; conservar el pronóstico observado ANTES del inicio, no el clima real futuro.
- **Cuotas:** The Odds API, API-Football odds, ESPN Odds observacionales y otros proveedores autorizados. Comparar solo con cuotas de casa/mercado/fecha/ruleset y timestamp verificables; históricos NO son cotización actual.
- **Política de credenciales:** OAuth o API key en vault propio de PHOENIX, sin exponerlas en pantalla/log. No usar extracción no autorizada ni superar límites de consulta.

**Átomo de evidencia:** source, endpoint/url, retrievedAt, dataEffectiveAt, leagueId, seasonId, eventId, teamId, playerId, refereeId, timeWindow, numerator/denominator cuando sea tasa, metric, value, units, verifiedState (verified/provisional/stale/missing/contradictory), sampleSize, definitions, limitations.

**Trazabilidad temporal:** Solo datos conocidos en el momento en que Kira recomienda. Para evaluación histórica, reproducir el snapshot prepartido original y NO filtrar información del futuro.

## 3. Secuencia de investigación humana — 24 etapas

### 01. Cartelera de TODO el fútbol mundial
Consultar por fecha y huso horario (mostrar RD), continente, país, liga, categoría, género, temporada, fase y ronda. Identificar todos los partidos reales con IDs, hora, estadio, clima, local/visita o cancha neutral, estado y doble jornada. Distinguir liga, eliminatoria a un partido, ida/vuelta, amistoso y final. Ordenar y paginar; jamás inferir un evento desde nombres sin ID.

### 02. Primer filtro de viabilidad y cobertura
Verificar fecha prepartido, equipos correctos, fuentes activas, suficientes resultados previos, disponibilidad de plantillas, árbitros, alineaciones probables, cuotas cotizables y reglamento. Señalar candidatos a estudio profundo y apartar competiciones de cobertura C/D. Priorizar calidad de evidencia, no solo la fama de la liga ni una cuota alta.

### 03. Tabla, resultados y forma de ambos equipos
Posición, puntos, partidos, victorias/empates/derrotas, goles a favor/contra, diferencial, puntos por juego, últimos 5/10/15/20, rachas, remontadas, porterías a cero y rivalidades. Ajustar la interpretación a fuerza de los adversarios y calidad de ocasiones; distinguir un 3-0 engañoso de un dominio real. No evaluar dos clubes en distintas ligas mediante posición ordinal cruda.

### 04. Rendimiento en casa y fuera
W-D-L, goles a favor/contra, frecuencia de marcar/encajar, porterías a cero, remontadas, rendimiento primera/segunda mitad, xG/xGA si es verificable, posición en tabla local/visita, rendimiento *en ese mismo estadio*. Distinguir sede neutral, partidos a puerta cerrada y cambios de cancha. Mostrar pequeñas muestras y dificultad del calendario.

### 05. Enfrentamientos previos (H2H) contextualizados
Últimos 5/10 encuentros directos con sede, fecha, marcador, goleadores, expulsiones, entrenadores y plantilla de entonces. Separar H2H en otra competición o hace muchos años del contexto actual. No usar un H2H favorable como argumento determinista.

### 06. Ataque de equipo
Goles, xG / no-penalty xG, tiros, tiros a puerta, big chances, calidad de tiros, conversión, xG por tiro, posesión útil, entradas al área, progresiones, contraataques, pases profundos, centros, transiciones, volumen de ataques y rendimiento según rival. Distinguir falta de xG de valor cero.

### 07. Defensa y portería de equipo
Goles recibidos, xGA, tiros y tiros a puerta permitidos, ocasiones grandes cedidas, PPDA/presión si fuente compatible, bloque alto/medio/bajo, recuperaciones, pérdidas en zonas peligrosas, defensa de transiciones, duelos aéreos, faltas, errores que terminan en remate y clean sheets. Calidad de rivales siempre.

### 08. Plantilla y todos los titulares potenciales
Roster oficial actual y IDs fiables: once inicial probable vs confirmado, suplentes, porteros, minutos recientes, posición, lateralidad, sustituciones, ausencias, regresos, suspensiones, cesiones y transferencias; confirmar pertenencia actual. Distinguir *convocado*, *probable*, *titular confirmado*, *duda*, *descartado*. No reutilizar el once anterior sin etiqueta.

### 09. Estrellas y forma individual
Para cada atacante y mediocampista: minutos, goles/90, xG/90, xA/90, asistencias, tiros y tiros a puerta/90, acciones de creación, pases clave, faltas recibidas, penaltis y tiros libres, últimas 5/10 actuaciones, tendencia y contrincantes. Para defensas: duelos, intercepciones, despejes, errores, tarjetas, minutos. Guardametas: paradas/90, goles evitados (PSxG-GA cuando disponible), goles encajados y desempeño reciente. Normalizar **por minutos realmente jugados**, penalizar muestras bajas; un nombre famoso no equivale a buen estado.

### 10. Matchups individuales atacante × defensor × portero
Matriz comparable a «bateador vs pitcher», pero en soccer:
- extremo izquierdo vs lateral derecho + ayuda del central;
- extremo derecho vs lateral izquierdo + cobertura;
- delantero centro vs centrales y guardameta;
- mediapunta vs pivote defensivo;
- mediocentro creador vs presión y bloque del rival;
- atacante de balón parado vs defensores/receptor de remates.
Cruzar perfil, pie, velocidad, altura, juego aéreo, progresiones, duelos, tackles, regates, disciplina, cambios de posición y minutos. Añadir quién podría sustituir a quién. No afirmar que habrá enfrentamiento directo continuo: los roles cambian por esquema.

### 11. Alineaciones y esquemas tácticos
4-3-3, 4-2-3-1, 3-5-2, etc.; cómo ataca y defiende cada club, pressing, profundidad, posesión vs transición, posesión estéril, defensa a balón parado, repliegue, control del mediocampo. Comparar sistema A vs B y plan B tras sustituciones. Confirmar si el sistema viene cambiando con entrenador reciente.

### 12. Entrenadores y decisiones
Director técnico actual, antigüedad, cambios recientes, rotación prevista, cargas, estilo, patrón de sustituciones, gestión de 1-0/0-1, estrategia de copa/ida-vuelta, declaraciones verificables. No convertir rumores de tácticas en hechos confirmados.

### 13. Lesiones, suspensiones y noticias
Verificar boletines oficiales, fecha, naturaleza y probabilidad de jugar de jugadores relevantes; tarjetas acumuladas por competición, convocatoria, enfermos, limitación de minutos, descanso de estrellas, transferencias. Contrastar al menos fuente primaria y fuente secundaria cuando discrepan. Actualizar en cuanto salga la alineación oficial.

### 14. Calendario, desgaste, viajes, motivación y contexto
Días de descanso, partidos últimos 7/14/21 días, kilómetros/continentes, cambios horarios, convocatorias internacionales, altura, posible rotación por competición paralela, final/playoff/descenso/derbi. Motivación NO es indicador medible por sí sola; interpretar hechos (necesita un punto, diferencia global, fixture próximo), no narrativas sobre «hambre de ganar».

### 15. Estadio, superficie y clima
Estadio real vs nominal, altura sobre nivel del mar, superficie natural/artificial, dimensiones permitidas, capacidad de local, cancha neutral, terreno pesado, lluvia, temperatura, humedad, viento, pronóstico para duración del juego y riesgo de suspensión. Distinguir techo retráctil. No convertir 20 km/h de viento en aumento fijo de goles sin evidencia histórica.

### 16. Árbitro, disciplina y VAR
Árbitro y asistentes confirmados, faltas señaladas, amarillas/rojas, penaltis, ventaja, tarjetas por equipo y estilos, VAR y criterio de la competición. Medir muestras y sesgo por dificultad del partido; jamás afirmar «árbitro favorece a X» sin evidencia robusta. Para mercados de tarjetas, identificar reglas de tarjetas de banca, técnicos y segundas amarillas según casa.

### 17. Balón parado, córners, faltas y penaltis
Córners a favor/en contra, córners cedidos por bandas, frecuencia por período, tiros libres, penaltis a favor/en contra, designación verificada de lanzador, goles de balón parado, juego aéreo, tiros de cabeza, defensas vulnerables. Mercados de córners/tarjetas/tirador solo con fuentes pertinentes.

### 18. Tendencias según minutos y estado del marcador
Goles del 0–15, 16–30, 31–45+, 46–60, 61–75 y 76–90+; anotación/encaje primero, cambios cuando gana, pierde o empata, descanso y cambios de sistema; no promediar sin controlar exposición y estado. Separar primer tiempo, segundo tiempo y FT.

### 19. Revisión de expertos y mercado
Recopilar pick de autor identificado, cuota/línea/mercado, fecha, razones de ESPN/PickCenter, Covers y otros si realmente están disponibles. Registrar opiniones divergentes, detectar repeticiones/copia, comparar con noticias; consenso no es verdad ni probabilidad. Examinar movimientos de línea, profundidad de mercado y vigencia.

### 20. Escenarios razonados del partido
Kira prepara varias hipótesis competidoras basadas en evidencia: dominio local temprano; visitante que repliega y contraataca; partido trabado; un gol temprano que cambia presión; 0-0 al descanso; lesión, rotación, roja y cambios de esquema. Para cada tramo del encuentro, identificar quién atacaría, quién generaría ocasiones, quién sufriría, qué indicios podrían invalidar la tesis. **No inventar porcentajes exactos ni jugadas futuras reales**. Simulación numérica futura solo si entrada/datos/validación son reproducibles; la investigación es el núcleo.

### 21. Mercados disponibles para ESE partido
Buscar e identificar casa, mercado, selección, línea, período, cuota, hora observada y regla de liquidación exacta:
- **1X2** 90 minutos más añadido (1, X, 2) y dos opciones de doble oportunidad 1X/X2/12;
- **draw no bet** / empate no acción, ML de clasificación para knockout (no confundir con 1X2), hándicaps europeos;
- **Asian handicap** ±0.25/0.5/0.75/1/1.5, totales asiáticos de 0.5 a 4.5 o según disponibilidad, cuotas de cuarto y medias devoluciones;
- **over/under goles** juego, por equipo y primer/segundo tiempo, ambos anotan (BTTS);
- **goles por mitad**, primer gol, gol en cada tiempo, resultado al descanso/final, marcador exacto (solo con evidencia suficiente);
- **córners y tarjetas** totales, por equipo, 1T/FT, expulsión, penaltis, faltas según proveedor;
- **props jugadores** goleador, asistente, tiros, tiros a puerta, faltas, tarjetas, paradas del portero, pases, tackles cuando son cotizables.
- **extra time y penales**: mercados de clasificarse o levantar título se liquidan distinto al resultado de 90 minutos; respetar reglamento específico.
La lista es inventario de mercados *posibles*, NO afirma disponibilidad real ni autorización para cualquier tipo de apuesta.

### 22. Cruzar hipótesis contra línea de la casa
Ejemplo ilustrativo: una investigación apunta hacia escenario de dos o más goles y la casa cotiza **más de 1.5**; estudiar 0–1 frente a 2+ y comprobar cuota, alineaciones, contrapruebas y posibilidad de que el partido sea cerrado. Si cotiza **más de 2.0** (asiático), exactamente 2 normalmente supone devolución; **más de 2.25** supone media pérdida ante exactamente 2, según regla. No basta decir «creo que habrá 3» para declarar edge. La comparación requiere incertidumbre, precio comercial real y prueba histórica de confiabilidad si se afirma EV.

### 23. Dictamen independiente de Kira
Ficha de decisión con **tesis**, evidencia favorable, evidencia CONTRARIA, qué fuentes faltan, escenario que invalidaría, mercado específico y alternativa más conservadora solo cuando esté cotizada. Estados: «investigar», «candidato para revisión humana», «abstenerse». **No publicar un número de confianza o probabilidad solo porque el LLM suene seguro**. Los atributos cuantitativos posteriores deben identificar método validado y evaluación fuera de muestra.

### 24. Auditoría posterior al partido y mejora
Guardar foto de investigación, datos conocidos antes de kickoff, cotizaciones en ese momento, quién jugó realmente y resultado oficial con reglas de liquidación. Revisar lesiones/rotaciones sorpresivas, tácticas, clima, árbitro, cambios de cuota, goles esperados vs reales, tarjetas, córners, props. Evaluar errores por liga/mercado/tipo de evidencia y rectificar el PROCESO de investigación; no ajustar retrospectivamente para aparentar aciertos.

## 4. Investigación individual por posición: fichas explícitas

Cada atleta, identificado por club/season/playerId, presenta minutos, titularidad real, 5/10 últimas participaciones, forma versus rivales de similar estilo, fatiga y rol táctico. Las comparaciones distintas no se mezclan:
- **Delanteros:** tiros, xG sin penales cuando disponible, tiros a puerta, asistencias, faltas sufridas, minutos y rival central/portero.
- **Extremos:** regates, centros, tiros, contribución defensiva, pie dominante y duelo con lateral/rival.
- **Mediocentros:** progresión, pases clave, presión, recuperaciones, tiros lejanos, sanciones, riesgo de tarjetas.
- **Defensores:** despejes, duelos y errores, faltas/tarjetas, eficacia aérea frente a rivales.
- **Porteros:** paradas, PSxG cuando disponible, tiros recibidos, juego aéreo y titular confirmado.
- **Suplentes clave:** minutos esperados basados en rotaciones observadas, no un supuesto arbitrario.

La matriz ofensiva-defensiva contendrá **11 titulares × roles rivales**, y podrá ampliarse a suplentes, no una tabla 11×11 de duelos ficticios. Cada comparación señala identificadores, método, muestras y datos ausentes.

## 5. Dossier por partido y experiencia visual

Vista de cartelera compacta mundial → filtro por liga/cobertura → clic en partido → pestañas:
1. Resumen local/visitante y estado de jornada.
2. Tabla/forma/H2H.
3. Ataque/defensa y ocasiones (xG/xGA si existe).
4. Once confirmado/probable, estrellas, lesionados y cambios.
5. Matriz de enfrentamientos y táctica con explicación expandible.
6. Árbitro, córners, tarjetas, penaltis y balón parado.
7. Estadio/clima/viajes/descanso.
8. Noticias y expertos atribuibles.
9. Escenarios 1T/2T/90'+ añadido.
10. Tabla de cuotas y mercados reales por casa.
11. Dictamen de Kira, argumentos en contra, datos pendientes y motivo de abstención.
12. Histórico de hipótesis y resultados.

**UI PHOENIX:** tema claro, tarjetas pequeñas y proporcionales, logos discretos, noticias en español (traducción fiel y cita original), nada de fondo gris pesado ni panel intrusivo. Cargar detalle solo cuando se abre. Diferenciar «sin confirmar» de «dato cero». Botón «Actualizar antes del inicio» recalcula secciones afectadas sin repetir toda la investigación; registrar snapshots.

## 6. Arquitectura de ingeniería: escalable, sin escanear todo en profundidad

- **League Registry / Provider Capabilities:** países, zonas, género, campeonato, temporadas, licencia, endpoints, indicadores verificados por atributo con estado y fecha; adaptar proveedores, deduplicar por identificadores estables.
- **Global Schedule Scout:** sondeo por lotes/paginación, zonas horarias, planificación de caché y cuotas por proveedor, never storm de miles de requests por pregunta.
- **Quick Research Filter:** forma, localía, H2H y disponibilidad de cotizaciones para detectar candidatos sin elegir automáticamente un ganador; puede devolver «0».
- **Deep Soccer Dossier:** fetch bounded concurrent por fixture y por atleta con retries moderados, semáforo, cache segmentado, source provenance, circuito abierto por proveedor caído; cálculo de ratios solo si denominador verificable.
- **Specialist Research Reasoner:** Kira recibe evidencia *estructurada*, genera tesis/contratesis y preguntas pendientes, justifica cada mercado. La pregunta «por qué este mercado y no 1X2» debe responderse explícitamente.
- **Price & Settlement Validator:** unir ID y hora de evento, casa, mercado, jugador, línea, unidades, half/FT, extra time y la regla correspondiente. Rechaza cuota expirada/falsa. Para quarter lines se aplica split de stakes si y solo si contrato de la casa lo permite.
- **Research Opportunity Gateway:** exporta resultados a coordinador multideporte sin sustituirlo ni inventar probabilidades.
- **Temporal Ledger & Replay:** entradas/hallazgos/snapshots por partido, versiones y evaluación posterior.
- **Per-League Coverage Manifest:** histórico visible A/B/C/D por temporada y parámetro; actualizaciones periódicas con TTL diferenciados (fixture vs roster vs pronóstico clima vs odds).

**Propuesta de herramientas nativas de Kira:**
- sports_chat_soccer_leagues (descubrir países, competiciones y cobertura).
- sports_chat_soccer_slate (cartelera global por fecha/rango, ligas y filtro).
- sports_chat_soccer_investigate (expediente por eventId y leagueId).
- sports_chat_soccer_matchups (comparativas tácticas y jugadores por páginas).
- sports_chat_soccer_market_review (hipótesis, odds verificadas, ruleset, contradicciones).
- sports_chat_soccer_audit (replay y verificación histórica).

Nunca atribuir a una liga concreta un ESPN slug no verificado, y nunca confundir equipo/partido entre proveedores.

## 7. Contrato compartido con MLB y optimizador de tickets

ResearchedOpportunityV1:
- sport='soccer', league, season, stage, eventId, homeId, awayId, scheduledAt, venue, neutral;
- researchUpdatedAt, evidence[], favorableFacts[], contradictoryFacts[], missingEvidence[], coverageLevel, sourceAges;
- lineupStatus, playerIds, injuryStatuses, refereeStatus, weatherStatus, tacticalNotes[], scenarioAnalysis[];
- bookmaker, quoteId, marketFamily, period, selection, line, decimalOdds, quoteUpdatedAt, settlementRules;
- correlationKeys (mismo partido, club, país, copa, jugadores, árbitro, clima y calendario), uncertaintyNotes[];
- recommendation: investigate | candidate | abstain, whyThisMarket, whyNotOthers, whatWouldChangeDecision[];
- probability? *solo* con fuente/método cuantitativo verificado/calibrado; si no, no suministrar un número ni un EV calculado como si fuera fiable;
- eligibleForTicket: false hasta cumplir identidad, precio vigente, reglas, evidencia suficiente y ausencia de contradicciones graves.

El coordinador de 5–6 patas mezclará deportes SOLO con propuestas elegibles, de la misma casa y con compatibilidad de markets; analizará correlaciones entre patas y comparará riesgo/probabilidad/ganancia. Más cuota total no significa mejor probabilidad ni ganancia esperada. Si el operador no acepta same-game parlays, no inventarlas. No forzar 5/6 si la evidencia es insuficiente.

## 8. Reglas de competencia, temporalidad y liquidación que no pueden fallar

- **90 minutos y añadido** vs tiempo extra vs tanda de penales; mercados FT normales se liquidan a 90'+ añadido salvo términos concretos de la casa.
- **Empate:** partido de fútbol puede acabar X; no usar binaria ganador local/visitante para 1X2 ni confundir doble oportunidad, draw-no-bet y clasificarse.
- **Asian quarter lines:** ±0.25/0.75 y O/U 2.25, 2.75 → dividir importe entre líneas adyacentes, con resultados de cobro, media pérdida, media ganancia, push según mercado. Implementar en test y solo con ruleset del bookmaker.
- **Dos partidos ida/vuelta:** agregado, marcador previo, sede neutral, extra time/penaltis, criterios de desempate de la competición actual; no suponer antigua regla de gol visitante.
- **Amistosos y juveniles:** distintas reglas de sustituciones, duración o mercado; si se desconoce, bloquear conclusión apostable.
- **Abandonos/suspensiones:** reglas propias de proveedor; no confundir marcador al abandono con liquidación final.
- **Penaltis, tarjetas, córners y props:** exclusiones de suplentes/banca y elegibilidad por minutos dependen de casa; siempre verificar.
- **Clima:** pronóstico visto ANTES del kickoff y estadio realmente utilizado.
- **Lineups:** nunca convertir un roster en once confirmado; verificar aproximadamente 1h antes o ventana del proveedor.

## 9. Hitos de construcción y pruebas (no declarar 'terminado' prematuramente)

- **S0 — Plan mundial documentado (este PR).** No modifica el runtime deportivo, no crea automatizaciones ni promesas de nuevas ligas funcionando.
- **S1 — Catálogo mundial:** dynamic league registry + providers; fixtures en MLS, LaLiga, Premier, Liga MX, una liga asiática, una africana, una femenina y una segunda división de muestra; pruebas de ID, timezone y cobertura insuficiente.
- **S2 — Expediente básico:** forma 5/10/20, standings, home/away, H2H con tamaño de muestra y snapshots pregame; fixtures de temporadas de calendario diferente.
- **S3 — Roster y rendimiento:** 11 titulares, suplentes, posiciones, minutos/90, lesiones, transferencias, suspensiones, xG si permitido; casos de XI sin confirmar y club incorrecto.
- **S4 — Matríz táctica completa:** duelos por rol delantero-defensa-portero, estilo de juego, entrenador, presión, balón parado y rotaciones; pruebas de táctica probable vs confirmada.
- **S5 — Estadio/árbitro/tiempo:** sede, altitud, viento, viajes, descanso, referee/corners/cards cuando fuente disponible; prueba neutral/techo/árbitro desconocido.
- **S6 — Expertos y mercados:** fuente de opinión externa con atribución sin inventar picks; cuotas reales de 1X2, doble oportunidad, BTTS, O/U, handicap, córners, tarjetas, props; comparación de mercados + reglas de casa y abstención.
- **S7 — Revisión integral y casos reales:** chat compact UI, investigación por escenarios 1T/2T/FT, controles de calidad, refresh y evidencia contradictoria; pasar por 1 encuentro real MLS + 1 de LaLiga + 1 de otra región + 1 femenino con snapshots y degradación adecuada.
- **S8 — Replay histórico:** evalúar predicciones realmente emitidas, aciertos/error/no-pick, fiabilidad por liga y mercado, cambios por noticias, validez de snapshots, ajuste de metodología sin filtrado temporal.
- **S9 — Interoperabilidad global:** oportunidades a coordinador 5/6 patas junto con MLB bajo contrato común, diferencia de reglamentos y correlaciones. No pasar a producción como 'alta precisión' sin auditorías reproducibles.

## 10. Criterios exactos de aceptación

1. «Investiga todo el fútbol del mundo de mañana» devuelve las competiciones y juegos que los proveedores *realmente* pudieron verificar (con paginación y recuento por fuente), sin prometer exhaustividad universal.
2. «Investiga Inter Miami vs X» no se queda en últimos cinco resultados: revisa once, estrellas, forma individual/por90, rivalidades, home/away, formación y matchups, referee, estadio y calendario, dependiendo de cobertura; presenta faltantes explícitos.
3. Alineación no confirmada nunca aparece como oficial; jugadores transferidos o suspendidos nunca se recomiendan en props por pertenecer al roster anterior.
4. Estadísticas xG/xA/PSxG se muestran únicamente cuando hay fuente que define esa métrica y cubre el partido/atleta.
5. Una tarjeta de apuesta incluye **tesis + contraargumentos + información faltante + cotización fresca + reglas + evento correcto**; si falta algo crítico, «abstenerse».
6. 1X2, DNB, doble oportunidad, clasificación, handicap asiático, goles, córners, tarjetas y props no se confunden ni se liquidan usando reglas incorrectas.
7. La misma casa debe realmente cotizar las 5/6 patas, no combinar odds de casas distintas ni crear cuotas sintéticas.
8. Tests reproducibles (fuente falla, fixture duplicado, alineaciones, neutral, prórroga, A/B/C/D, cuarto asiático, publicación tardía, clima futuro, MLS vs LaLiga vs liga asiática/femenina) + TypeScript y verificación de UI. Comprobar datos reales sin exponer claves.
9. Ledger distingue investigación antes del juego y revisión posterior; ninguna afirmación sobre precisión o retorno sin seguimiento cuantificable y control de selecciones no hechas.
10. En todo momento Kira debe explicar qué encontró y qué NO encontró; conclusión inteligible en español, sin humo probabilístico y sin garantía de ganar.

## 11. Notas sobre el estado existente de PHOENIX (a noviembre de 2026)

El catálogo del repositorio en main incluye soccer: eng.1, esp.1, mex.1, usa.1, uefa.champions y fifa.world, más descubrimiento dinámico desde ESPN cuando responda. El módulo multi-sport-research concentra principalmente forma reciente y no implementa este expediente profundo individual/táctico. El modelo sports-forecast de fútbol es Poisson exploratorio no calibrado y **no sustituye** al especialista de investigación. Esta rama define el trabajo, no implementa aún las herramientas propuestas.

## 12. Fuentes de documentación inicial (comprobar vigencia al integrar)

- ESPN público/catálogo: endpoints ya presentes en packages/core/tool-sports/src/sports.ts de PHOENIX.
- API-Football coverage: https://www.api-football.com/coverage
- API-Football docs: https://www.api-football.com/documentation_v3
- football-data.org docs: https://www.football-data.org/documentation/api
- StatsBomb Open Data (solo subconjunto histórico, atribución requerida): https://github.com/statsbomb/open-data
- Open-Meteo forecast/previous runs: https://open-meteo.com/en/docs/historical-forecast-api
