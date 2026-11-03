# PHOENIX · MLB Research Intelligence — plan maestro basado en investigación

**Estado:** especificación de implementación. **Disciplina inaugural:** béisbol MLB. **No es un predictor desplegado ni promete apuestas ganadoras.** La ampliación posterior a KBO, NPB, LIDOM, LMB y otros deportes reutilizará el contrato de investigaciones, sin trasladar los criterios MLB a esas ligas.

## 0. Decisión de diseño: la investigación manda, Kira razona

No construir una fórmula universal, un ranking fijo por victoria/margen ni un motor matemático que tome decisiones antes de mirar el juego. **Primero se recopila y contrasta evidencia del partido real; después Kira, como analista, elabora la hipótesis, identifica los mercados pertinentes y explica su decisión con fuentes y datos fechados.** La investigación no consiste en rellenar campos decorativos después de elegir un favorito.

La simulación solicitada será en principio una **exploración razonada de escenarios** (abridor dominante, salida temprana, bullpen cansado, lineup incompleto, viento favorable) sustentada en evidencia verificable; jamás se fabricará una probabilidad numérica por el hecho de que la LLM pueda escribirla. La estimación cuantitativa y el backtesting podrán añadirse *después* como instrumentos de contraste auditables, subordinados a los datos reales. Un conteo de expertos, una ventaja narrativa o un porcentaje de resultados pasados no demuestran por sí mismos probabilidad predictiva ni valor esperado positivo.

**Flujo obligatorio:** calendario MLB → cribado de todos los encuentros → expedientes de candidatos → enfrentamiento roster×pitchers → escenarios de juego y mercados → cruce de cuota específica de la misma casa → deliberación independiente → propuesta de patas → seguimiento y aprendizaje.

## 1. Fuentes y trazabilidad (antes de elegir un partido)

Fuentes oficiales primarias: **MLB Stats API** para schedule, gamePk, probablePitcher, team roster, boxscore, live feed, estadísticas de temporada y partido, gamelogs/últimas salidas, standings, sede y estatus; **MLB News / equipos** para anuncios oficiales, partes médicos, lineups y cambios; **ESPN Site/Core/Summary** como fuente secundaria de contexto, rankings, noticias y pronósticos publicados. Los endpoints se deben **probar de verdad** por recurso; un 200 sin los campos requeridos significa cobertura insuficiente, no confirmación. Para clima, proveedor autorizado de meteorología con coordenadas verificadas del estadio y condiciones por hora; registrar si techo está cerrado/abierto/desconocido. Para métricas avanzadas, incorporar solo fuentes con acceso permitido y metadatos consistentes; no inventar xFIP, wRC+, xwOBA, framing, etc. si faltan. Para expertos: ESPN PickCenter, Covers, VegasInsider y artículos públicos accesibles de autores identificables; mantener fuentes/citas separadas de pronóstico propio, nunca atribuir predicción externa a PHOENIX.

Cuotas: ESPN cuando las publica con casa, selección, línea y timestamp, The Odds API v4 / TheOddsAPI con autorización del usuario, OddsHarvester cuando esté instalado y accesible según permisos. Las bases históricas sirven para analizar, **no** para cotizar apuestas actuales. No utilizar reglas de un sportsbook como si fueran de otro; verificar vigencia y términos de la casa exacta.

**Registro de evidencia por campo:** \`sourceName, sourceUrl/endpoint, retrievedAt, effectiveAt, league, season, eventId, teamId, playerId?, metric, value, units, period, sampleSize, verifiedState, limitations\`. Estados: \`verified | provisional | missing | stale | contradictory\`. Guardar fallo de red, 404, respuesta vacía, IDs incompatibles y tiempo de observación. Sin evidencia = explícitamente «pendiente»; no se inventa ni se reemplaza con nombres de otra temporada.

## 2. Investigación humana obligatoria en 16 etapas MLB

### Etapa 1 — Cartelera real, selección de jornada
- Consultar todos los juegos MLB por fecha y huso horario del estadio, con \`gamePk\` auténtico; hora local de República Dominicana para mostrar.
- Anotar local, visitante, estadio, doble cartelera, estado pregame, probable pitcher por lado, partido de serie, estatus de suspensión.
- Separar equipos/series en temporada regular, spring training, playoffs; nunca compartir parámetros o estadísticas indiferenciadas.
- No pasar un juego iniciado/terminado como prepartido. No confundir gamePk de MLB con eventId de ESPN.

### Etapa 2 — Filtro rápido de ambos equipos
- Temporada: ganados/perdidos, rachas, posición, carreras anotadas/permitidas, diferencial.
- Últimos 5/10/20 juegos, dificultad de rivales y desgaste de calendario.
- Desempeño **local y visitante por separado**, incluyendo temporada, rachas y viajes.
- Últimos enfrentamientos entre ambos; indicar temporadas, alineaciones distintas y muestra pequeña.
- Debe devolver: «investigar a fondo», «insuficiente» o «descartar por datos/mercados» con motivo; **no** declarar apuesta.

### Etapa 3 — Estadio y condiciones ambientales
- Sede exacta, superficie, dimensiones/asimetrías de jardines, altitud, roof, factores de parque para carreras/hits/HR, regímenes por zurdo/derecho si está disponible.
- Rendimiento del local y visitante **en ese parque**, ajustado descriptivamente por rivales y pequeñas muestras; tendencias de home runs allí.
- Temperatura, humedad, probabilidad de lluvia, presión, viento **velocidad + dirección respecto a los jardines/home plate** a la hora del partido y durante las entradas. Clima exterior no implica viento de juego con techo cerrado.
- Retraso/cancelación y efecto sobre límites de innings o abridores, según reglamento.

### Etapa 4 — Abridor de cada equipo: identidad y forma
- Confirmado vs probable vs desconocido; mano, días de descanso, límites de lanzamientos, lesión reciente, rol de opener/bullpen game.
- W-L (contexto, no criterio central), ERA, WHIP, IP, starts, K, K/9, K%, BB%, BB/9, HR/9, FIP, xFIP, GB%, repertorio, velocidad, tendencias si disponibles.
- Últimas **5 aperturas individuales** con rival, fecha, innings, lanzamientos, K, BB, hits, carreras, home runs, eficiencia y cambios de velocidad.
- Splits local/visitante, vs bateadores derechos/izquierdos, vs rival actual (BvP con tamaño de muestra), vs este estadio.
- ¿Cuánto tiempo se espera que permanezca? Si no está confirmado, marcar los mercados dependientes como sensibles a cambios.

### Etapa 5 — Bullpen por **todos los relevistas pertinentes**
- Roster activo, lesionados, 40-man vs disponibles hoy, cerrador, setup, relevistas largos, zurdos/derechos, opener y sustitutos.
- Por pitcher: ERA, WHIP, FIP, K%, BB%, HR/9, entradas, últimos 7/14/30 días, uso y número de pitches en últimos 1–3 días, back-to-back, disponibilidad.
- Bullpen total y **proyectado para este encuentro**; no tratar todo jugador en roster como relevista dispuesto a lanzar.
- Analizar bullpen del equipo A contra alineación B **bateador por bateador**; y viceversa. Registrar quién tiene mayor probabilidad *cualitativa* de ser utilizado según contexto, sin fingir estrategia confirmada.

### Etapa 6 — Roster completo y alineación de cada club
- Verificar roster con IDs MLB actuales y temporada correcta; distinguir IL, bajas, suspensiones, call-ups, trades, catcher, suplentes, pinch-hitters, pinch-runners, cambios del día.
- Identificar **nueve titulares y orden al bate** solo cuando MLB lo haya publicado; antes, manejar alineación probable etiquetada.
- Por bateador: PA, AB, H, 1B/2B/3B/HR, AVG, OBP, SLG, OPS, RBI, BB, SO/K%, BB%, ISO, wOBA/wRC+, hard-hit/barrels, velocidad/sprint, robos, desempeño reciente 5/10/15/30, splits vs lanzadores zurdos/derechos, rendimiento como local/visitante y en estadio.
- Cada métrica requiere fuente, ventana temporal, recencia y muestra. No confundir porcentaje de juegos con probabilidad de una aparición al plato.

### Etapa 7 — **Matriz bateador × abridor** (9×1 por club)
- Para cada uno de los nueve bateadores de un equipo, confrontar abridor contrario: historial directo PA/AB/H/HR/K/BB, dirección del swing, platoon advantage, repertorio de pitches, zona, frecuencia de ponches, perfil de contacto, vulnerabilidad a velocidad/breaking/offspeed.
- Columna «evidencia real», «muestra», «ventaja/desventaja razonada», «qué falta», y «riesgo de muestra pequeña».
- Analizar al receptor, suplentes y emergentes cuando sean relevantes. Ninguna coincidencia aproximada por nombre sustituye playerId.

### Etapa 8 — **Matriz bateador × bullpen rival** (9×N)
- Para cada bateador y **cada relevista relevante** del otro equipo: platoon, split, tasas K/BB/HR, contacto, fatiga, repertorio/velocity y enfrentamiento directo si existe.
- Representar por fases del juego (entrada 4–6, 7–8 y 9+); el relevista de referencia depende de escenario, no se supone titular.
- Resaltar diferencias: lineup que castiga al abridor pero pierde ventaja ante relevistas frescos; starter dominante seguido de bullpen agotado; bullpen rival fuerte contra zurdos.
- Guardar visualización matriz compacta expandible en la tarjeta del partido, no 50 tarjetas intrusivas.

### Etapa 9 — Defensa, catcher, corrido de bases y managers
- Eficiencia defensiva, errores, rango, receptor, framing cuando exista, robos, outs en bases, velocidad y estrategia, posiciones debilitadas.
- Analizar sustituciones y cambios de lineup en función del pitcher; no suponer decisiones particulares sin evidencia de patrones.

### Etapa 10 — Noticias, estrellas y confirmación médica
- Consultar informes de equipos, IL, noticias y medios deportivos recientes; comprobar estrellas activas y **si jugarán hoy**.
- Para estrellas clave: cómo vienen rindiendo (últimos juegos, bateo vs mano rival), señales de regreso o restricción, y consecuencias de su ausencia.
- Noticias de viajes, descanso, cambios de entrenador, cambios de pitcher, roof/clima, suspensiones.
- Verificación cruzada por ID y tiempo. Diferenciar rumor, probable, confirmado y «no reportado»; ausencia en feed no equivale a salud confirmada.

### Etapa 11 — Expertos y pronósticos ajenos
- Investigar ESPN/PickCenter, Covers, VegasInsider y analistas públicos cuando haya acceso efectivo; obtener autor, fecha y argumentos y el mercado/line exactos.
- Comparar pronósticos a favor/en contra y registrar **desacuerdo** con evidencia propia; explicar sesgo de consenso y conflictos.
- Nunca transformar consenso de expertos ni cuotas implícitas en probabilidad propia; no copiar argumentos sin fuente.

### Etapa 12 — **Simulación razonada del partido** antes de la apuesta
- Crear el relato analítico por fases: entradas 1–3 (tope de lineup vs starter), 4–5 (segunda/tercera vuelta y fatiga), 6–7 (salida de starters, matchups con middle relievers), 8–9 (setup/closer, pinch-hitters y estrategia).
- Analizar escenarios explícitos: starter A domina, starter sale antes, bullpen fatigado, estrellas ausentes, viento hacia jardines, cero viento/techo cerrado, partido cerrado vs amplio.
- En cada escenario anotar impacto **sustentado y explicado** sobre carreras, ponches, hits, HR y posibilidad de remontada. Construir la lectura de *primeras 3, primeras 5 y juego completo* a partir del mismo expediente.
- La **primera implementación será simulación de escenarios en lenguaje claro**, no un motor Poisson/Monte Carlo fijado que decida quién gana. Si hay simulación numérica futura, tendrá entrada versionada, supuestos verificables, evaluación cronológica y límites de interpretación antes de usarse.
- No fingir narración de jugadas reales futuras ni porcentajes precisos de ocurrencia.

### Etapa 13 — Buscar mercados en vez de asumir moneyline
- Investigar cuotas **reales** de la misma casa para ML (si reglamento incluye extras), run line ±1.5/±2.5, totales del juego, team totals, F3/F5, props de pitcher K/outs/IP, bateador hits/HR/bases totales, cuando estén publicados.
- Matriz «hipótesis de investigación → mercado candidato → dato a favor → dato en contra → cuota → condición de liquidación → estado».
- Ejemplo: casa ofrece **total 8 carreras**; hipótesis central apunta a ~9, **no declarar automáticamente Over 8**. Examinar escenarios 7 o menos (pierde), exactamente 8 (push si así lo establece el reglamento), 9+ (gana), precio y muestras. Línea 8.5 no tiene push de ocho. Si house ofrece 8.0 asiático/alternativo, comprobar las reglas.
- Revisar innings jugados, lluvia/suspensión, cambio de pitcher listado, F5 empate/push, overtime, completitud y límites de cobro según casa. Si no está la cuota precisa, producir hipótesis **sin cotizar**.

### Etapa 14 — Conclusión de Kira respaldada y contradictoria
- Dictamen por partido: «oportunidad para revisar», «sin ventaja suficientemente documentada» o «descartar».
- Para cada mercado seleccionado: **evidencias a favor y en contra**, actores críticos, escenarios que invalidarían la tesis, datos faltantes, hora última comprobación y motivo de elegir ese mercado *en lugar de otros*.
- La inferencia final la hace el **modelo de lenguaje con una rúbrica explícita y verificable**, no una fórmula de ranking fija 0.55/0.40/0.05. Sin porcentajes inventados; probabilidades cuantitativas solo si proceden de un método evaluado y calibrado. Kira debe poder abstenerse.

### Etapa 15 — Ticket interdeportes de 5–6 patas (después de MLB)
- Entregar cada candidato MLB como \`ResearchedOpportunityV1\` con evidencia, fuente, mercado, casa y precio; hacer lo mismo más adelante con soccer/NBA/NFL/NHL/tenis, **cada deporte investigado con sus propios pasos**.
- El coordinador reúne solo selecciones vigentes de la **misma casa que pueda cotizar todas las patas**, verifica reglas y mercado exacto, evita dos selecciones incompatibles y correlaciones obvias (mismo evento, pitcher, lineup, clima, series y equipos). No simular una same-game parlay que la casa no acepte.
- Comparar conjuntos de 5 y 6 por plausibilidad de éxito, retorno comercial, incertidumbre y dependencia; **mayor ganancia posible y mayor probabilidad no se pueden maximizar simultáneamente en general**.
- No inventar «ticket de alta probabilidad» por acumular opiniones. Sin 5/6 fundamentos y cuotas de calidad, entregar borrador con faltantes; no maquillar la cobertura.

### Etapa 16 — Auditoría retrospectiva y aprendizaje
- Guardar expediente original sellado ANTES del juego, tesis y predicciones por mercado, fuente/edad de líneas, bajas confirmadas entonces y decisión.
- Al terminar, importar resultado oficial y settlement según casa, cotejar qué **hechos** cambiaron: abridor reemplazado, velocidad, lineup, bullpen, viento, lesión, opinión experta, línea móvil, falta de datos.
- Evaluar acierto por tipo de mercado, cobertura de fuentes, sesgos y rentabilidad en un historial independiente, descontando pushes/void y reglas.
- Usar hallazgos para mejorar el **procedimiento de investigación** y la rúbrica; no reescribir retrospectivamente datos para hacer que el modelo «parezca acertar».

## 3. Producto: expediente MLB compacto dentro del chat de PHOENIX

**Vista inicial:** cartelera y filtro. **Expediente por partido:** (1) 2 equipos y contexto; (2) abridores comparados y últimas salidas; (3) lineup de 9+ y estrellas; (4) matriz roster × abridor; (5) matriz roster × bullpen; (6) estadio y viento; (7) lesiones y noticias; (8) opiniones ESPN/Covers y discrepancias; (9) escenarios F3/F5/FT; (10) tabla exacta mercados/casas; (11) conclusión, riesgos y decisión. Cada sección puede expandirse; mostrar estado de dato faltante, frescura y fuente. Tema claro y componentes deportivos existentes; no abrir múltiples pantallas ni emitir JSON en chat.

**Regla de actualización:** ante lineup confirmado, cambio de probable starter, reporte de IL, techo o clima, o cambio sustantivo de cuota, invalidar dependencias correspondientes, **rehacer solo la parte afectada** y guardar versión del expediente. Persistencia reutilizable por \`league|season|gamePk|observedAt\` con TTL por tipo de evidencia (roster, noticias, lineup y cotizaciones distintos).

## 4. Contrato compartido para futuros especialistas

\`ResearchedOpportunityV1\`:
- \`sport, league, eventId, kickoff, teamIds, playerIds, bookmaker, marketFamily, period, selection, line, decimalOdds, quoteUpdatedAt, observedAt, sportsbookRules\`.
- \`researchSummary, favorableEvidence[], contradictoryEvidence[], sourceReferences[], missingEvidence[], scenarioAnalysis[], injuryStatus, lineupStatus, weatherStatus, researchUpdatedAt\`.
- \`qualityGates: { fixtureVerified, marketVerified, priceFresh, playerIdsVerified, rulesVerified, enoughPrimaryEvidence, contradictionsReviewed }\`.
- \`recommendation: investigate | candidate | abstain\`; \`reasoning\`, \`whatWouldChangeMyMind[]\`, \`correlationKeys[]\`.
- \`probability?: number\` **solo con fuente/método validado y explícito**; no campo obligatorio, no autocompletado por LLM. \`eligibleForTicket\` requiere todas las gates fundamentales, no solo una descripción persuasiva.

## 5. Implementación por entregas observables

**M0 — Plan MLB research-first:** retirar el baseline Poisson como motor de decisión; conservar solo el contrato y pruebas de investigación. (Este PR).

**M1 — MLB Schedule + Evidencia:** ruta \`sports_chat_mlb_daily_research\`, schedule/standings/partidos reciente local-visitante y MLB IDs; fuentes con fechas y errores. Pruebas de 2 equipos y doble cartelera.

**M2 — Dossier de roster real:** roster activo + boxscore lineups + cada bateador y pitcher (starter y relevistas), recientes 5/10/15/30, mano y splits; pruebas de 9 bateadores correctos, suplentes, jugador traspasado y lineup no confirmado.

**M3 — Matriz cruzada y profundidad:** \`sports_chat_mlb_matchups\`, cada bateador vs abridor y vs bullpen plausible, historial BvP, recencia, repertorio y muestras; pruebas de matrículas/IDs, data unavailable, mapeo correcto entre equipos.

**M4 — Parque, clima y actualidad:** altitud, orientación de viento, roof, travel, descanso, noticias, IL/estrellas, analistas externos atribuibles, cambios de pitchers; pruebas de fuentes discordantes y techo cerrado.

**M5 — Investigación por escenarios y mercados:** \`sports_chat_mlb_case_review\`: escenarios inning-by-inning narrativos y contrastados; comparación mercado y cuota de la misma casa, F3/F5/FT, hits/K/run lines; pruebas de over 8 vs 8.5, pushes, quotedAt, reglas y abortar selección por evidencia insuficiente. No publicar probabilidades ficticias.

**M6 — Especialista interoperable:** resultados \`ResearchedOpportunityV1\` auditables, cache versionada, APIs adaptables a futuros especialistas, y agregador de 5/6 patas sin garantía de victoria.

**M7 — Evaluación histórica:** replay de expedientes con solo información existente antes de kickoff, cobertura real, desempeño de recomendaciones y causas de error. Un evaluador cuantitativo solo se incorporará si añade valor demostrado sin sustituir la investigación.

## 6. Criterios de aceptación

- Desde «Investiga los partidos de hoy» Kira presenta toda la cartelera MLB disponible, filtra sin inventar datos, selecciona y abre **un** expediente completo por encuentro.
- Identifica dos rosters y nueve bateadores oficiales cuando estén publicados; muestra si no. Confronta todos los nueve contra **abridor rival y bullpen plausible**, incluyendo estado, fuente y ausencia de muestras.
- Verifica estadio local y visitante, viento relativo al terreno/techo, rendimiento local/visitante, lesiones, estrellas, últimos partidos, splits/ponches de pitchers y opiniones externas atribuibles cuando estén accesibles.
- Presenta escenarios completos de juego, selección de mercado sustentada y cotejo de precios frescos bajo reglas de casa. Distingue línea entera 8 (push si corresponde) y media línea 8.5.
- No describe un informe con 2 partidas superficiales como «análisis completo», ni predice con certeza, ni arma 5/6 patas de la nada.
- Pruebas de identidad, tiempo, fuentes fallidas, equipo incorrecto, pitchers cambiados, roster obsoleto, abstención y mercado no liquidable antes de promover a producción.

### Nota de estado
Este documento especifica la construcción del especialista y **no afirma que los siete hitos estén implementados**. Los módulos existentes \`mlb-matchup.ts\`, \`mlb.ts\`, \`mlb-research.ts\`, \`sports.ts\` son bloques reutilizables, pero aún no forman el expediente integrado ni realizan las matrices completas.
