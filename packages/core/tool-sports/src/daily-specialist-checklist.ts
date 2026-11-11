/** Per-discipline daily-ticket audit. Presence of a provider response or a
 * candidate on a roster is not proof of starter confirmation or bet approval.
 * This checklist records individually observed research steps, not probability.
 */
import {auditDeepProtocol,type DeepProtocolStep} from './sports-original-deep-protocol.ts'
export type StepState='verified'|'partial'|'missing'
export type StepObservation={state:StepState;detail:string}
export type ChecklistStep={key:string;title:string;critical:boolean;
  state:StepState;detail:string;sources:string[]}
export type SportChecklist={sport:string;checkedAt:string;
  steps:ChecklistStep[];verified:number;partial:number;missing:number;
  criticalPending:string[];complete:boolean
  /** 10 universal + original 12/13 specialist checks; never claimed complete
   * merely because the compact acquisition gate has passed. */
  fullSteps:DeepProtocolStep[]
  fullVerified:number;fullPartial:number;fullMissing:number;fullComplete:boolean
}
type Requirement={key:string;title:string;critical:boolean}
const common=[
  {key:'fixture',title:'Identidad, localía e inicio del partido',critical:true},
  {key:'form',title:'Forma reciente de ambos rivales, local/visitante y descanso',critical:true},
  {key:'market',title:'Cuota real vigente, mercado y período exactos',critical:true},
] as const
const definitions:Readonly<Record<string,readonly Requirement[]>>={
  football:[...common,
    {key:'rosters',title:'Rosters de ambos equipos y posiciones',critical:true},
    {key:'qb',title:'Quarterback titular y disponibilidad',critical:true},
    {key:'matchups',title:'Líneas ofensivas, pass rush y enfrentamientos individuales',critical:true},
    {key:'injuries',title:'Lesiones e inactivos con parte actualizado',critical:true},
    {key:'weather',title:'Clima y situación del estadio',critical:false}],
  basketball:[...common,
    {key:'rosters',title:'Plantillas de ambos equipos',critical:true},
    {key:'starters',title:'Quintetos y rotaciones confirmados',critical:true},
    {key:'efficiency',title:'Pace, eficiencia y métricas avanzadas',critical:true},
    {key:'injuries',title:'Lesiones, descansos y bajas actualizadas',critical:true},
    {key:'schedule',title:'Back-to-back y descanso comparado',critical:true}],
  hockey:[...common,
    {key:'rosters',title:'Jugadores y defensa de ambos equipos',critical:true},
    {key:'goalies',title:'Dos porteros titulares CONFIRMADOS (no candidatos)',critical:true},
    {key:'xg',title:'xG 5 contra 5, tiros de calidad y GSAx (investigación avanzada)',critical:false},
    {key:'special',title:'Power play, penalty kill y enfrentamientos',critical:true},
    {key:'injuries',title:'Lesiones, scratches y suspensiones actuales',critical:true}],
  baseball:[...common,
    {key:'rosters',title:'Rosters activos de ambos equipos',critical:true},
    {key:'starters',title:'Dos pitchers abridores confirmados',critical:true},
    {key:'bullpen',title:'Bullpen y carga de relevistas',critical:true},
    {key:'matchups',title:'Bateadores versus abridores y forma de equipos',critical:true},
    {key:'weather',title:'Parque, techo, viento y clima en el horario',critical:true},
    {key:'injuries',title:'Bajas y lineups de ambos equipos',critical:true}],
  soccer:[...common,
    {key:'rosters',title:'Plantillas de ambos clubes',critical:true},
    {key:'lineups',title:'Onces y ausencias confirmadas',critical:true},
    {key:'xg',title:'xG/xGA y calidad de las ocasiones',critical:true},
    {key:'injuries',title:'Lesiones, sanciones y bajas',critical:true},
    {key:'draw',title:'Riesgo de empate y reglas de mercado a 90 minutos',critical:true}],
  tennis:[...common,
    {key:'players',title:'Perfiles y ranking de ambos tenistas',critical:true},
    {key:'surface',title:'Superficie y forma específica',critical:true},
    {key:'serve',title:'Servicio, devolución y estadísticas de ambos',critical:true},
    {key:'fatigue',title:'Fatiga, calendario y viajes',critical:true},
    {key:'injuries',title:'Disponibilidad y molestias físicas',critical:true}],
}
/** Actual source order shown to Kira and the user per mandatory step.
 * URLs with an event/team ID are resolved by their existing adapters. A named
 * backup is a recovery instruction, NOT proof the specific endpoint responded.
 * Live endpoint evidence is written by scripts/phoenix-sports-endpoint-audit.mjs.
 */
const commonSources:Record<string,string[]>={
  fixture:['ESPN Site scoreboard (ID, localía, hora)'],
  form:['ESPN scoreboard histórico por fechas individuales','ESPN team statistics'],
  market:['ESPN scoreboard odds','ESPN Core event competition odds/ID',
    'ESPN summary pickcenter','OddsHarvester / The Odds API si están disponibles'],
}
const specialistSources:Record<string,Record<string,string[]>>={
  basketball:{
    rosters:['ESPN Site teams/{id}/roster'],
    starters:['ESPN summary boxscore/rosters','Quintetos de parte oficial de partido cuando se publiquen'],
    efficiency:['ESPN Site teams/{id}/statistics.results',
      'ESPN Common v3 athletes/{id}/stats','ESPN summary leaders'],
    injuries:['ESPN Site basketball/{liga}/injuries por liga',
      'NBA official injury report PDF (solo NBA)','ESPN summary injuries'],
    schedule:['ESPN scoreboard histórico para ambos equipos'],
  },
  football:{
    rosters:['ESPN Site football/nfl/teams/{id}/roster'],
    qb:['ESPN NFL summary rosters y depthchart','NFL parte oficial de inactivos'],
    matchups:['ESPN NFL team statistics','ESPN NFL summary boxscore'],
    injuries:['ESPN football/nfl/injuries por liga','NFL parte de inactivos por club'],
    weather:['ESPN summary venue','Open-Meteo Forecast API'],
  },
  hockey:{
    rosters:['ESPN hockey/nhl roster','NHL API equipos y alineación'],
    goalies:['NHL API score y gamecenter','ESPN summary goalies (titularidad sin asumir)'],
    xg:['NHL estadísticas oficiales si se publican','Fuente externa xG validada si se conecta'],
    special:['NHL Power Play / Penalty Kill','ESPN estadísticas de equipos'],
    injuries:['ESPN hockey/nhl/injuries por liga','NHL roster/scratches gamecenter'],
  },
  baseball:{
    rosters:['MLB Stats API roster','ESPN baseball/mlb roster'],
    starters:['MLB Stats API schedule hydrate probablePitcher','MLB boxscore lineup'],
    bullpen:['MLB Stats API boxscore/game logs (últimas 72h)'],
    matchups:['MLB Stats API batter/pitcher splits','ESPN summary'],
    weather:['MLB schedule venue','Open-Meteo temperatura y viento'],
    injuries:['ESPN baseball/mlb/injuries por liga','MLB Stats API roster/IL'],
  },
  soccer:{
    rosters:['ESPN soccer/{liga}/teams/{id}/roster'],
    lineups:['ESPN soccer summary/rosters','Club o liga oficial (verificar)'],
    xg:['ESPN soccer team statistics cuando estén','Proveedor xG externo validado'],
    injuries:['ESPN summary injuries cuando estén','Club y liga oficial'],
    draw:['ESPN Core 1X2 con empate explícito','ESPN scoreboard odds'],
  },
  tennis:{
    players:['ESPN tennis athlete profiles','Torneo o circuito oficial'],
    surface:['ESPN torneo/sede','Calendario del circuito oficial'],
    serve:['ESPN athlete game logs','Estadísticas oficiales ATP/WTA'],
    fatigue:['ESPN calendario y últimos encuentros'],
    injuries:['Parte del torneo o atleta confirmado'],
  },
}
export const getResearchStepSources=(sport:string,key:string):string[]=>[
  ...(specialistSources[sport]?.[key]??commonSources[key]??[])].slice(0,5)

/** Missing observations are explicitly missing; never auto-credit a step
 * because a tool was called or another step had a valid source.
 */
export function auditSportChecklist(sport:string,
  observations:Readonly<Record<string,StepObservation>>,
  now=Date.now()):SportChecklist{
  if(!Number.isFinite(now))throw Error('Fecha de auditoría inválida')
  const requirements=definitions[sport]??[]
  const steps=requirements.map(requirement=>{
    const observed=observations[requirement.key]
    const state:StepState=observed?.state==='verified'||observed?.state==='partial'
      ?observed.state:'missing'
    return{...requirement,state,sources:getResearchStepSources(sport,requirement.key),
      detail:typeof observed?.detail==='string'&&observed.detail.trim()
        ?observed.detail.slice(0,220):'Sin evidencia individual comprobada'}
  })
  const verified=steps.filter(x=>x.state==='verified').length
  const partial=steps.filter(x=>x.state==='partial').length
  const missing=steps.filter(x=>x.state==='missing').length
  const criticalPending=steps.filter(x=>x.critical&&x.state!=='verified')
    .map(x=>x.title)
  const fullSteps=auditDeepProtocol(sport,observations)
  const fullVerified=fullSteps.filter(x=>x.state==='verified').length
  const fullPartial=fullSteps.filter(x=>x.state==='partial').length
  const fullMissing=fullSteps.filter(x=>x.state==='missing').length
  return{sport,checkedAt:new Date(now).toISOString(),steps,verified,partial,
    missing,criticalPending,complete:steps.length>0&&criticalPending.length===0,
    fullSteps,fullVerified,fullPartial,fullMissing,
    fullComplete:fullSteps.length>0&&fullVerified===fullSteps.length}
}
export const supportedChecklistSports=Object.keys(definitions)
