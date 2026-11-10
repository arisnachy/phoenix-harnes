/** The original 10 + 12/13-step PHOENIX sports protocol recovered from
 * November 8–9 project specifications. It is DISTINCT from the compact
 * eight-to-nine-step acquisition gate used by older ticket engines.
 *
 * A broad metric never automatically proves a granular requirement. The
 * original signal may support PARTIAL coverage only until an exact
 * per-requirement observation exists. Sources are ordered recovery options,
 * NOT evidence that a route was invoked or succeeded.
 */
export type DeepStepState='verified'|'partial'|'missing'
export type DeepObservation={state:DeepStepState;detail:string}
export type DeepProtocolStep={
  key:string;title:string;critical:boolean;group:'universal'|'specialist'
  state:DeepStepState;detail:string;sources:string[]
}
type Requirement={
  key:string;title:string;critical:boolean;
  sources:readonly string[];from?:string
}
const U:readonly Requirement[]=[
 {key:'U01',title:'Descubrir evento: deporte, liga, contendientes, ID, fecha, sede, hora local y UTC',
  critical:true,sources:['ESPN Site scoreboard','Liga/organizador oficial','TheSportsDB'],from:'fixture'},
 {key:'U02',title:'Historial 5/10/20, temporada, local/visitante y fuerza de calendario',
  critical:true,sources:['ESPN scoreboards anteriores por fecha','Estadísticas de liga','Base histórica validada'],from:'form'},
 {key:'U03',title:'Rendimiento de ambos: eficiencia, tendencias y métricas avanzadas específicas',
  critical:true,sources:['ESPN statistics.results','Liga oficial','Proveedor especializado por deporte']},
 {key:'U04',title:'Individualizar jugadores decisivos, titulares/suplentes y cruces uno contra uno',
  critical:true,sources:['ESPN rosters + game logs','Boxscore y alineaciones oficiales','Stats especializados'],from:'rosters'},
 {key:'U05',title:'Lesiones, inactivos, limitación de minutos, sanciones y noticias verificadas',
  critical:true,sources:['Parte oficial de lesiones/inactivos','ESPN injuries por liga','Medios con fecha y atribución'],from:'injuries'},
 {key:'U06',title:'Contexto: viajes, descanso, estadio, árbitros, clima y motivación competitiva',
  critical:true,sources:['Calendario y sede oficiales','Open-Meteo','Designación de árbitros de la liga'],from:'schedule'},
 {key:'U07',title:'Redundancia: principal, respaldo, concordancia, fecha y discrepancias',
  critical:true,sources:['Auditoría de rutas reales','Segunda API independiente','Fuente oficial alternativa']},
 {key:'U08',title:'Modelo propio por mercado, incertidumbre, calibración y backtest cronológico',
  critical:true,sources:['Modelos por deporte con out-of-sample','Registro de simulaciones','Backtest sin datos futuros']},
 {key:'U09',title:'Mercados, cuotas reales, movimientos, casa, reglas y valor vs probabilidad',
  critical:true,sources:['ESPN Site/Core odds con atribución','The Odds API/OddsHarvester','Línea exacta de Juancito cuando disponible'],from:'market'},
 {key:'U10',title:'Auditoría adversarial, noticias, consenso experto, correlación y defensa por pata',
  critical:true,sources:['Dossier verificable del partido','Covers/Dimers/Forebet como contraste','Fuentes primarias de lesiones y titulares']},
]
const D:Readonly<Record<string,readonly Requirement[]>>={
 basketball:[
  {key:'B01',title:'Confirmar fecha, localía, estado, arena e ID NBA/WNBA',critical:true,
    sources:['ESPN scoreboard','Liga NBA/WNBA oficial'],from:'fixture'},
  {key:'B02',title:'Temporada y últimos 5, 10 y 20 encuentros con fecha y rival',critical:true,
    sources:['ESPN scoreboard histórico','ESPN summary lastFiveGames'],from:'form'},
  {key:'B03',title:'Local/visita, margen, fuerza de rivales y calendario ajustado',critical:true,
    sources:['ESPN team splits y resultados','Basketball Reference histórico'],from:'form'},
  {key:'B04',title:'Offensive Rating, Defensive Rating, Net Rating y Pace por ambos equipos',critical:true,
    sources:['NBA/WNBA Stats','ESPN teams/{id}/statistics.results','nba_api (solo NBA)'],from:'efficiency'},
  {key:'B05',title:'PTS anotados/permitidos, eFG%, TS%, TOV%, ORB/DRB%, FT rate y 3P rate',critical:true,
    sources:['NBA/WNBA Stats','ESPN team statistics','Datos por posesión NBA'],from:'efficiency'},
  {key:'B06',title:'Estrellas y rotación: PTS, AST, REB, MIN, USG%, TS%, on-court impact',critical:true,
    sources:['ESPN athlete stats/gamelog','NBA/WNBA Stats jugadores','Boxscore oficial'],from:'rosters'},
  {key:'B07',title:'Quintetos, combinaciones, on/off, minutos de suplentes y matchups',critical:true,
    sources:['NBA/WNBA lineup stats','ESPN summary boxscore/depthchart','Reporte de equipo'],from:'starters'},
  {key:'B08',title:'Lesiones propias y rivales, gravedad, restricciones de minutos y parte oficial fechado',critical:true,
    sources:['NBA/WNBA Official Injury Report','ESPN basketball/{liga}/injuries','ESPN summary injuries'],from:'injuries'},
  {key:'B09',title:'Back-to-back, 3 en 4 noches, descanso en horas, viajes y fatiga',critical:true,
    sources:['ESPN schedule/scoreboard','Viajes calculados con sede verificada'],from:'schedule'},
  {key:'B10',title:'Matchups base-alero-pívot: interior, perímetro, rebotes, defensa y H2H actual',critical:true,
    sources:['ESPN boxscores y jugadores','NBA/WNBA matchup y tracking','Histórico de rivales']},
  {key:'B11',title:'Modelos separados de ganador, spread y totales; sensibilidad a estrellas',critical:true,
    sources:['Modelo calibrado PHOENIX NBA/WNBA','Resultados históricos por mercado']},
  {key:'B12',title:'Cuotas exactas, línea, proveedor, hora, movimientos, noticias y auditoría de selección',critical:true,
    sources:['ESPN Core odds','The Odds API/OddsHarvester','Juancito verificación explícita'],from:'market'},
 ],
 hockey:[
  {key:'H01',title:'Identidad, cancha, fecha, zona y últimos juegos',critical:true,
    sources:['NHL API score','ESPN scoreboard'],from:'fixture'},
  {key:'H02',title:'Últimos 5/10/20 y fortaleza de los oponentes',critical:true,
    sources:['NHL API gamecenter','ESPN historial'],from:'form'},
  {key:'H03',title:'Distinguir 60 minutos vs OT y shootout',critical:true,
    sources:['NHL boxscore/play-by-play','ESPN summary']},
  {key:'H04',title:'Goles a favor/en contra, diferencial, tiros y tendencia local/visita',critical:true,
    sources:['NHL Stats REST','ESPN team statistics'],from:'form'},
  {key:'H05',title:'xG/xGA, 5v5, high-danger chances, Corsi/Fenwick y calidad de tiro',critical:true,
    sources:['MoneyPuck','Natural Stat Trick','NHL play-by-play'],from:'xg'},
  {key:'H06',title:'Porteros SV%, GAA, GSAx, últimas 5 salidas y fatiga',critical:true,
    sources:['NHL Stats REST','MoneyPuck','ESPN summary goalies'],from:'goalies'},
  {key:'H07',title:'Portero titular real de cada equipo con Confirmed/Likely/Unconfirmed',critical:true,
    sources:['Club/NHL oficial','Daily Faceoff starting goalies','ESPN summary'],from:'goalies'},
  {key:'H08',title:'PP%, PK%, faceoffs, penalizaciones y duelo de unidades especiales',critical:true,
    sources:['NHL Stats REST','ESPN special teams'],from:'special'},
  {key:'H09',title:'Líneas, parejas defensivas, scratches, lesiones y suspensiones',critical:true,
    sources:['NHL gamecenter','ESPN injuries por liga','Club oficial'],from:'injuries'},
  {key:'H10',title:'Back-to-back, viajes, minutos, portero descansado y home ice',critical:true,
    sources:['NHL calendario/boxscore','ESPN scoreboard']},
  {key:'H11',title:'Modelos independientes ML, puck line y totales; empty net y OT/SO',critical:true,
    sources:['Modelos históricos PHOENIX NHL','NHL períodos/gamecenter']},
  {key:'H12',title:'Cuotas, definiciones 60 minutos vs OT/SO, contraste experto y riesgo',critical:true,
    sources:['ESPN Core odds','OddsHarvester/The Odds API','Covers + noticias NHL'],from:'market'},
 ],
 baseball:[
  {key:'M01',title:'gamePk, ID ESPN, sede, hora y doble cartelera',critical:true,
    sources:['MLB StatsAPI schedule','ESPN scoreboard'],from:'fixture'},
  {key:'M02',title:'Resultados y últimos 5/10/20 con calidad de oposición',critical:true,
    sources:['MLB StatsAPI schedule/game','ESPN scoreboard'],from:'form'},
  {key:'M03',title:'Splits global/local/visita, vs LHP/RHP y calendario',critical:true,
    sources:['MLB StatsAPI team splits','Baseball Savant','ESPN splits'],from:'form'},
  {key:'M04',title:'Abridores: ERA, FIP/xFIP, WHIP, K%, BB%, IP, últimas salidas, repertorio',critical:true,
    sources:['MLB probable pitchers / StatsAPI','Baseball Savant','FanGraphs'],from:'starters'},
  {key:'M05',title:'Abridor contra la ofensiva rival y lateralidad de bateadores',critical:true,
    sources:['MLB StatsAPI splits','Baseball Savant Statcast'],from:'matchups'},
  {key:'M06',title:'Lineup: AVG, OBP, SLG, OPS, wOBA, xwOBA, hard-hit y forma',critical:true,
    sources:['MLB boxscore/lineup','Baseball Savant','FanGraphs'],from:'rosters'},
  {key:'M07',title:'Matriz bateador vs pitcher, pitcheos, tamaño de muestra y recencia',critical:true,
    sources:['MLB StatsAPI matchup','Statcast pitch-by-pitch'],from:'matchups'},
  {key:'M08',title:'Bullpen 24/48/72h, entradas, disponibilidad y fatiga',critical:true,
    sources:['MLB boxscore últimos partidos','MLB pitcher game logs'],from:'bullpen'},
  {key:'M09',title:'Lineups confirmados, receptores, bajas, IL y sustituciones',critical:true,
    sources:['MLB boxscore','MLB injury report','ESPN injuries por liga'],from:'injuries'},
  {key:'M10',title:'Parque, techo, viento/dirección, humedad, temperatura y park factors',critical:true,
    sources:['MLB ballpark/game info','Open-Meteo horario','Park factors'],from:'weather'},
  {key:'M11',title:'Defensa, corrido de bases, carreras por inning y errores',critical:true,
    sources:['MLB StatsAPI fielding/baserunning','Statcast'],from:'matchups'},
  {key:'M12',title:'Modelar ML partido completo, F5, run line y totales por separado',critical:true,
    sources:['Modelo PHOENIX MLB','Retrosheet/MLB históricos']},
  {key:'M13',title:'Cuota real, run line, abridores declarados, 9 innings y reglas de liquidación',critical:true,
    sources:['ESPN Core odds','Proveedor de cuotas','Juancito market/line'],from:'market'},
 ],
 football:[
  {key:'N01',title:'Semana, estadio, kickoff y localía con evento NFL exacto',critical:true,
    sources:['NFL schedule','ESPN scoreboard'],from:'fixture'},
  {key:'N02',title:'Últimos 3/5/10 y dificultad de rivales',critical:true,
    sources:['nflverse schedule','ESPN scoreboards'],from:'form'},
  {key:'N03',title:'EPA/play, success rate, DVOA autorizado, puntos/yardas por drive',critical:true,
    sources:['nflverse PBP','NFL Stats/Next Gen','ESPN team statistics']},
  {key:'N04',title:'QB: titularidad, CPOE, presión, sacks, INT, explosivas y salud',critical:true,
    sources:['NFL official depth/inactives','nflverse QBs','NFL Next Gen Stats'],from:'qb'},
  {key:'N05',title:'11 ofensivos + 11 defensivos de cada lado y snap counts',critical:true,
    sources:['NFL official inactives','nflverse rosters/snaps','ESPN rosters'],from:'rosters'},
  {key:'N06',title:'OL vs pass rush, QB protection y blitz/pressure rate',critical:true,
    sources:['nflverse/NGS','NFL ESPN boxscore'] ,from:'matchups'},
  {key:'N07',title:'WR/TE frente CB/LB, separaciones, cobertura y H2H',critical:true,
    sources:['Next Gen Stats','nflverse player stats'],from:'matchups'},
  {key:'N08',title:'RB y esquema terrestre frente defensa carrera y cajas cargadas',critical:true,
    sources:['NFL Stats/Next Gen','nflverse rush EPA'],from:'matchups'},
  {key:'N09',title:'Special teams, turnovers, tercera oportunidad, 4th down y red zone',critical:true,
    sources:['NFL boxscore/play-by-play','nflverse EPA'],from:'matchups'},
  {key:'N10',title:'Lesiones, práctica, inactivos 90m, viajes, bye y descanso',critical:true,
    sources:['NFL official inactives','NFL injury report','ESPN injuries/nflverse'],from:'injuries'},
  {key:'N11',title:'Viento, lluvia, temperatura, superficie, techo y patadas',critical:true,
    sources:['ESPN venue','Open-Meteo horario'],from:'weather'},
  {key:'N12',title:'Modelos ML/spread/total, cuota, news, árbitros y contraargumentos',critical:true,
    sources:['ESPN Core odds','Modelos nflverse','Liga/medios atribuidos'],from:'market'},
 ],
 soccer:[
  {key:'S01',title:'Liga, fase, sede, equipos, kickoff y localía verificable',critical:true,
    sources:['ESPN soccer scoreboard','Liga/club oficial'],from:'fixture'},
  {key:'S02',title:'Últimos 5/10/20, calendario y dificultad de rivales',critical:true,
    sources:['ESPN scoreboards','OpenFootball/football-data.org'],from:'form'},
  {key:'S03',title:'Splits local/visita, goles, puntos, tendencias de 1X2',critical:true,
    sources:['Liga oficial','ESPN standings/results'],from:'form'},
  {key:'S04',title:'Goles, xG/xGA, diferencia y calidad de ocasiones por equipo',critical:true,
    sources:['Understat donde cubra','American Soccer Analysis MLS','StatsBomb Open Data solo históricas'],from:'xg'},
  {key:'S05',title:'Posesión, tiros, tiros a puerta, grandes oportunidades y conversión',critical:true,
    sources:['ESPN soccer summary','API-Football si está habilitada'],from:'xg'},
  {key:'S06',title:'Goleadores, asistentes, portero, defensas, mediocampo y minutos',critical:true,
    sources:['Liga/club oficial','ESPN player stats'],from:'rosters'},
  {key:'S07',title:'Tácticas, formación, pressing, duelo lateral/central y vulnerabilidades',critical:true,
    sources:['Alineaciones de club/liga','Estadísticas de partidos'],from:'lineups'},
  {key:'S08',title:'H2H reciente sin sobrevalorar plantillas antiguas',critical:true,
    sources:['ESPN matchup/history','Resultados oficiales']},
  {key:'S09',title:'Once confirmado/probable, suplentes, bajas, sanciones y rotación',critical:true,
    sources:['Club/organizador oficial','ESPN summary rosters','API-Football'],from:'injuries'},
  {key:'S10',title:'Descanso, viajes, fecha FIFA, congestión y prioridades',critical:true,
    sources:['Calendario oficial liga/club','ESPN fixtures'],from:'lineups'},
  {key:'S11',title:'Tabla, incentivo, árbitro, clima, altitud y césped',critical:true,
    sources:['Liga oficial tabla/referee','Open-Meteo'],from:'lineups'},
  {key:'S12',title:'Modelos 1X2/empate, doble oportunidad, BTTS, goles y handicap (90m)',critical:true,
    sources:['Modelo Dixon-Coles/Poisson calibrado','Histórico por liga'] ,from:'draw'},
  {key:'S13',title:'Cuotas exactas, reglas 90m, news, mercado y auditoría adversarial',critical:true,
    sources:['ESPN Core odds','The Odds API','Proveedor local y fuentes editoriales'],from:'market'},
 ],
 tennis:[
  {key:'T01',title:'Torneo, ronda, cancha, superficie, formato y horario',critical:true,
    sources:['ATP/WTA oficial','Torneo oficial','ESPN tennis'],from:'fixture'},
  {key:'T02',title:'Ranking, Elo y últimos 5/10/20 de ambos',critical:true,
    sources:['ATP/WTA rankings','KickServe Elo','Histórico Sackmann'],from:'players'},
  {key:'T03',title:'Forma indoor/outdoor y superficie dura/arcilla/hierba',critical:true,
    sources:['ATP/WTA resultados','Tennis Abstract','KickServe'],from:'surface'},
  {key:'T04',title:'Primero %, puntos primer/segundo, aces y dobles faltas',critical:true,
    sources:['ATP Tour Stats','WTA Stats','Match Charting Project'],from:'serve'},
  {key:'T05',title:'Puntos ganados al resto y break points generados/convertidos',critical:true,
    sources:['ATP/WTA oficiales','Tennis Abstract'],from:'serve'},
  {key:'T06',title:'Hold%, break%, tie-breaks, sets y juegos ganados/perdidos',critical:true,
    sources:['ATP/WTA match stats','TennisData histórico'],from:'serve'},
  {key:'T07',title:'H2H total y misma superficie con fechas',critical:true,
    sources:['ATP/WTA H2H','Tennis Explorer']},
  {key:'T08',title:'Fuerza y estilo de rivales, calidad de resultados y Elo superficie',critical:true,
    sources:['ATP/WTA resultados','KickServe ratings'],from:'players'},
  {key:'T09',title:'Lesión, médica, retiradas, walkovers y estado de ambos',critical:true,
    sources:['Torneo/ATP/WTA','Comunicados jugador/prensa atribuida'],from:'injuries'},
  {key:'T10',title:'Minutos, carga, viajes, descanso y cambio de superficie',critical:true,
    sources:['Resultados oficiales previos','Calendario ATP/WTA'],from:'fatigue'},
  {key:'T11',title:'Simulación ML, sets/juegos/hándicaps y distribución de scores',critical:true,
    sources:['Modelo tenis superficie PHOENIX','Match Charting Project']},
  {key:'T12',title:'Cuota, retiros, super-tiebreak, walkover y settlement',critical:true,
    sources:['Bookmaker elegido','ESPN/mercado con fecha','Reglas del torneo'],from:'market'},
 ],
}
export const deepProtocolCounts=Object.freeze(
  Object.fromEntries(Object.entries(D).map(([sport,rows])=>[sport,rows.length])))
export function auditDeepProtocol(
  sport:string,observations:Readonly<Record<string,DeepObservation>>
):DeepProtocolStep[]{
  const rows=D[sport]
  if(!rows)return[]
  return [...U.map(x=>({...x,group:'universal' as const})),
    ...rows.map(x=>({...x,group:'specialist' as const}))]
    .map(r=>{
      const direct=observations[r.key]
      const broad=r.from?observations[r.from]:undefined
      const state=direct?.state==='verified'||direct?.state==='partial'
        ?direct.state:broad?.state==='verified'||broad?.state==='partial'
          ?'partial':'missing'
      const detail=direct&&direct.detail?.trim()?direct.detail.slice(0,220):
        broad&&broad.detail?.trim()?
          ('Dato general ('+r.from+'): '+broad.detail+
          '. Falta verificar este subindicador.').slice(0,220):
          'Sin cifra o fuente individual validada para este paso'
      return{key:r.key,title:r.title,critical:r.critical,group:r.group,
        state,detail,sources:[...r.sources].slice(0,4)}
    })
}
