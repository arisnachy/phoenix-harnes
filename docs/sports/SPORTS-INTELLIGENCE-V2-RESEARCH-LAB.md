# PHOENIX Sports Intelligence V2 — investigación humana asistida por datos

> Diseño de arquitectura y criterios de aceptación. **Este documento no significa que el
> motor predictivo descrito esté entrenado, calibrado o habilitado en producción.**
> El ajuste visual compacto del mismo PR es independiente del entrenamiento.
> No existe pronóstico ni boleto ganador garantizado.

## Objetivo

Kira investiga la jornada completa por deportes y ligas activas (NBA, WNBA, MLB,
NFL, NHL, fútbol mundial, tenis ATP/WTA y las disciplinas con datos realmente
disponibles) sin agotar el presupuesto investigando cada partido con la misma
profundidad. Tras el barrido, escoge encuentros potencialmente investigables y
contrasta **mercados alternativos**, incluyendo hándicaps +1.5/-1.5,
totales, carreras/goles, estadísticas y líneas de jugadores, en lugar de
seleccionar por defecto al ganador.

## Pipeline obligatorio: exploración barata → investigación profunda → mercados

1. **Discover:** cartelera de la fecha local, calendario, IDs del proveedor,
   liga, deporte, hora, sede, estado y participantes confirmados. Ignorar
   eventos no confirmados, suspendidos o iniciados en el modo prepartido. Incluir
   todas las ligas configuradas y marcar explícitamente las no accesibles.
2. **Screen:** recopilar metadatos baratos por lote (muestras de rendimiento,
   fuentes de datos, enfrentamientos previos y disponibilidad de mercados).
   Priorizar la *investigabilidad* y la cobertura: al inicio aún no hay ventaja
   predictiva ni favorito. Evitar elegir ligas solo porque tienen más juegos.
   Un muestreo diverso debe impedir que una sola liga desplace todos los deportes.
3. **Deep dive** de un número limitado de candidatos (p. ej. máximo 8-12
   encuentros configurables por jornada): expedientes por equipo, titular/jugador
   y mercado; no hacer una solicitud cara de fichas o noticias por cada partido
   de todas las ligas.
4. **Model:** distribución del marcador final y de las estadísticas deportivas,
   no una única conjetura de ganador. Registrar versión de modelo, dataset,
   datos vistos hasta el momento de predicción, intervalos y evaluación histórica.
5. **Price:** consultar los mercados **exactos del evento y casa de apuestas**
   con cuota decimal, lado de la línea, umbral, jugador, fecha UTC de publicación
   y fuente. Comparar alternativas del mismo evento, no cambiar 'ML - gana A'
   por 'A -1.5', 'A +1.5' ni 'jugador más de 1.5' sin una cuota realmente observada.
6. **Audit:** pruebas de suficiencia, fuentes, calibración, incertidumbre,
   correlaciones entre patas y riesgo, con decisión APROBAR/RECHAZAR/PENDIENTE.
   Sin precio y mercado verificables, producir investigación, no un ticket cotizado.
7. **Build:** generar 1-2, 2-3 o 4-5 patas según modo. Maximizar la utilidad
   bajo restricciones de riesgo, límites de correlación y disponibilidad real
   de todas las patas en **la misma casa**. No completar un boleto con relleno.
8. **Learn:** registrar predicción y cuota ANTES del partido, resolver el
   mercado con reglas exactas del operador, evaluar pronósticos y recalibrar.

## Expediente completo por encuentro

- Equipos: últimos 5/10/20 juegos, dificultad del calendario, forma en casa
  y fuera, estadísticas avanzadas ajustadas por rival, descanso y viajes.
- Jugadores probables/confirmados: últimas participaciones, minutos o entradas,
  uso, tendencias, splits vs rivales y estilo de oposición; disponible vs
  confirmado son estados diferentes. **No modelar un prop si falta identidad
  del jugador, una línea publicada o evidencia de disponibilidad.**
- Historial directo: resultados y contexto de los partidos anteriores, con
  menor peso si cambiaron plantillas, entrenadores o condiciones.
- Lesiones y noticias: fuente, autor, hora de publicación y estado comprobable;
  no convertir feed vacío en 'todos sanos'. Considerar alineaciones, rotaciones,
  portero/abridor, cambios de entrenador y sanciones.
- Sede y entorno: estadio real, interior/exterior, clima y pronóstico
  correspondiente a la hora local del evento; solo si son relevantes (p. ej.
  viento en béisbol o NFL), sin inventar una influencia universal.
- Expertos y prensa: ESPN, BBC Sport, Covers y otras fuentes verificables
  pueden aportar hechos y opiniones, fechados y enlazados. Clasificar opinión
  por separado; medir posteriormente su acierto si se desea. **Consenso o
  'expert pick' no equivalen a una probabilidad objetiva.** Evitar scraping
  no autorizado; gestionar cuotas y permisos de cada proveedor.
- Auditor adversarial: '¿cómo puede ganar el rival?', escenarios para lesión
  no anunciada, baja rotación, cambio de portero y línea movida.
- Score: distribución completa y marcadores más probables; publicar el modelo,
  cobertura e intervalo de incertidumbre, sin presentar el marcador modal
  como certeza. ML puede usar simulaciones por posesiones/carreras/goles.

## Mercados y probabilidad: contrato estricto

Guardar `eventId`, `sport`, `league`, `bookmaker`, `marketKey`,
`participantId` (si es jugador), `selection`, `line` (+/- según
convención del mercado), `period`, `priceDecimal`, `updatedAt`,
`source`, `modelVersion`, `pCalibrated`, `pLow`, `pHigh`,
`reasoningEvidence[]`, `marketRules` y `correlationGroup`.

La probabilidad implícita `1/precio` no es la probabilidad de nuestro modelo.
Se compara **EV = pCalibrated * priceDecimal - 1** y además
`EV_conservador = pLow * priceDecimal - 1`, con propagación de incertidumbre.
Para combinadas correlacionadas se necesita una distribución conjunta o
simulación; no multiplicar probabilidades como si fueran independientes.

Familias que debe admitir el orquestador SOLO donde el proveedor devuelve línea
real: ganador (incluido empate), spread/run line/puck line, over/under,
doble oportunidad, ambos anotan, equipo total, alt lines y player props (puntos,
rebotes, asistencias, hits, strikeouts, tiros, saques, goles, etc.).
Las líneas -1.5 y +1.5 no son equivalentes. Los nombres de mercados
deben normalizarse con reglas específicas por deporte y periodo.

The Odds API documenta mercados por deporte y props de jugador por evento en:
- https://the-odds-api.com/sports-odds-data/betting-markets.html
- https://the-odds-api.com/liveapi/guides/v4/

El acceso a mercados de props depende de casa, geografía, clave y plan;
la presencia de un código en documentación no garantiza que haya precios.

## UI — implementación compacta incluida en este PR

- Cartelera: tarjetas densas y adaptativas, marcador/estado/hora/escudos arriba,
  contexto secundario plegado en 'Contexto del encuentro'; acceso directo
  a investigación sin expandir una gran ficha.
- Partido individual: máxima prioridad a equipos, hora, sede y marcador vivo;
  tablas de jugadores, bullpen, parciales y explicación dentro de disclosure
  nativo, accesible desde teclado. Sin perder análisis ni datos.
- Jugadores: fotografía circular `object-fit: cover`; logos de equipos
  siguen usando `contain`. Nunca fabricar avatar: usar solo URL de imagen
  permitida y fallback de iniciales.
- Futuro módulo de mercados por evento: tabs compactas Ganador, Hándicap,
  Totales y Jugadores. Listas densas de líneas/odds. Estado de datos
  incompletos visible; clic para abrir investigación y fuentes.

## Validación antes de fusionar el motor predictivo

- Tests unitarios de marketKey, sides de spread, nombres de jugadores,
  líneas y reglas de liquidación; timestamps y fuente obligatorios.
- Tests de desacople: ningún mercado de jugador por inferencia a partir de
  cuotas de ganador; sin titulares confirmados, estado no verificado.
- Backtest temporal walk-forward contra cuotas de cierre, con embargo temporal
  por publicación; log-loss, Brier score, calibration plots, ROI neto, tamaño
  de muestra, comisiones, yield por mercado, drawdown y cobertura.
- Probar predicción de score en NBA/fútbol primero; ampliar otros deportes
  solo después de superar una referencia simple de mercado fuera de muestra.
- Presupuestos: discovery barato reutilizable, cachés temporales y límite
  por profundidad/partidos. Prioridad a feeds existentes; nada de llamadas
  por cada jugador en todos los partidos desde el comienzo.
- Accesibilidad mobile, render plegado y expandido, performance y carga
  sin imágenes, deportes vacíos y enlaces no confiables.
- Mantener CI exigida por repositorio; no saltar validaciones para merge.
