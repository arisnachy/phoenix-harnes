/** NHL specialist -> read-only A-Q evidence for PHOENIX / Kira.
 * Source material is obtained from the existing native NHL specialist; this
 * adapter never promotes rosters, odds or historical reports to approved picks.
 */
import { investigateNhl, type HockeyDossier } from './nhl-evidence-research.ts'
import { probeNhlOfficialStarters, type NhlStarterProbe } from './nhl-official-starters.ts'
import type { StepObservation } from './daily-specialist-checklist.ts'

type EvidenceState='verified'|'partial'|'missing'
type ModuleLetter='A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'|'M'|'N'|'O'|'P'|'Q'
const LETTERS='ABCDEFGHIJKLMNOPQ'.split('') as ModuleLetter[]
type Obj=Record<string,unknown>
const obj=(x:unknown):Obj|null=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Obj:null
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const str=(x:unknown):string=>typeof x==='string'?x:''
const eventId=(x:unknown):string=>/^\d{10}$/u.test(str(x))?str(x):''
const stamp=(x:unknown):number=>Date.parse(str(x))
const filled=(x:number|null|undefined):x is number=>typeof x==='number'&&Number.isFinite(x)
const observed=(value:unknown):EvidenceState=>value?'partial':'missing'

/** One observed or missing A-Q domain with explicit sources and gaps. */
export type NhlResearchModule={
  topic:string,state:EvidenceState,data:unknown,missing:string[],sourceUrls:string[]
}
/** Source-directed task for a missing NHL research field. */
export type NhlResearchTask={
  event_id:string,module:ModuleLetter,missing_fields:string[],route:string
}
/** Read-only gate: the research snapshot never approves a bet. */
export type NhlResearchGate={
  researchOnly:true,eligibleForTicket:false,quotedOddsLive:false
  modelCalibrated:false,expectedValue:null,recommendation:'investigate'
}
/** Immutable research context for one NHL event. */
export type NhlResearchGame={
  eventId:string,sport:'hockey',league:'nhl'
  home:{ id:string,abbrev:string,name:string },away:{ id:string,abbrev:string,name:string }
  scheduledUtc:string,snapshotCreatedUtc:string,snapshotState:string
  captureBeforeTipoff:boolean
  evidenceModules:Record<ModuleLetter,NhlResearchModule>
  checklistObservations:Record<string,StepObservation>
  missingResearch:NhlResearchTask[]
  sourceRecords:Array<{ url:string,status:'verified'|'missing'|'error',checkedAt:string }>
  gate:NhlResearchGate
}
/** Versioned, archived NHL handoff payload. */
export type NhlResearchHandoff={
  schema:'phoenix.nhl.read-model.v1',operational:false,referenceDate:string
  games:NhlResearchGame[]
  note:string
}
const RESEARCH_GATE:NhlResearchGate={
  researchOnly:true,eligibleForTicket:false,quotedOddsLive:false,
  modelCalibrated:false,expectedValue:null,recommendation:'investigate',
}
const sourceHints:Record<ModuleLetter,string>={
  A:'NHL official score date + gamecenter identity',
  B:'NHL club-schedule / official standings / gamecenter historical finals',
  C:'NHL club-schedule month / travel and back-to-back independently',
  D:'NHL gamecenter boxscore and team shots/goal-difference reports',
  E:'Official opponent strengths, date-limited historical fixtures',
  F:'Authorized 5v5 xG/xGA provider or derived documented shot-location model',
  G:'Official pregame starting goalies, not roster candidates',
  H:'Goalie prior-game save history; trusted GSAx source if licensed',
  I:'NHL roster, player game-log and on-ice splits',
  J:'Official club injury report / scratches / dated team announcement',
  K:'Verified lines and defensive pairings; never infer from roster alone',
  L:'NHL Stats REST powerplay + penaltykill both teams and season',
  M:'NHL gamecenter head-to-head and verified 5v5 matchups',
  N:'Dated team news and injury context corroboration',
  O:'Two-sided bookmaker NHL moneyline / 60min / totals with exact terms',
  P:'Time-split, out-of-sample calibrated NHL model with validation',
  Q:'Decision critic based on confirmed evidence, calibrated forecast and price',
}
const make=(topic:string,state:EvidenceState,data:unknown,missing:string[],
  urls:string[]=[]):NhlResearchModule=>({
  topic,state,data,missing:state==='verified'?[]:missing,sourceUrls:[...new Set(urls)],
})
/** Converts ONE genuine NHL dossier to the same 17-stage research grammar used
 * by NBA LAB. A module with one observed field is PARTIAL, not complete.
 * @param dossier Source-checked NHL dossier for one game.
 * @param starter Optional independent official pregame starting-goalie result.
 * @returns Seventeen research modules, missing-field tasks and a safe gate.
 */
export function buildNhlResearchHandoff(
  dossier:HockeyDossier,starter:NhlStarterProbe|null=null,
):NhlResearchHandoff{
  const fixture=dossier.fixture
  if(!eventId(fixture.id)||!Number.isFinite(stamp(fixture.date))||
    !Number.isFinite(stamp(dossier.checkedAt)))
    throw new Error('NHL handoff: invalid official game identity or timestamps')
  if(!fixture.home.id||!fixture.away.id||fixture.home.id===fixture.away.id||
    !fixture.home.abbrev||!fixture.away.abbrev)
    throw new Error('NHL handoff: both official teams required')
  const pregame=stamp(dossier.checkedAt)<stamp(fixture.date)&&
    ['FUT','PRE'].includes(fixture.state)
  const formH=dossier.form.home,formA=dossier.form.away
  const bothForm=!!formH&&!!formA
  const bothRosters=dossier.players.home.length>0&&dossier.players.away.length>0
  const goalieConfirmed=pregame&&starter?.state==='confirmed'&&
    Boolean(starter.homeGoalie)&&Boolean(starter.awayGoalie)&&
    stamp(starter.checkedAt)<=stamp(fixture.date)
  const candidates=dossier.goalieCandidates
  const anyGoalie=candidates.home.length>0&&candidates.away.length>0
  const pp=dossier.specialTeams
  const ppComplete=pp.complete&&[pp.home.powerPlayPct,pp.home.penaltyKillPct,
    pp.away.powerPlayPct,pp.away.penaltyKillPct].every(filled)
  const market=dossier.markets.filter(x=>x.verifiedEvent&&x.approved===false&&
    Number.isFinite(x.odds)&&x.odds>1).map(x=>({
      bookmaker:x.bookmaker,selection:x.selection,market:x.market,point:x.point,
      observedOdds:x.odds,observedAt:x.updatedAt,
      liveVerified:false,approved:false,
    }))
  const urls=dossier.sources.filter(x=>x.status==='verified').map(x=>x.url)
  const scoreUrl='https://api-web.nhle.com/v1/score/'+fixture.date.slice(0,10)
  const sportsUrl=['https://api.nhle.com/stats/rest/en/team/powerplay',
    'https://api.nhle.com/stats/rest/en/team/penaltykill']
  const modules:Record<ModuleLetter,NhlResearchModule>={
    A:make('Identidad del partido','verified',{
      fixture,recordedAt:dossier.checkedAt },[],[scoreUrl]),
    B:make('Forma 5/10/20 y clasificación',observed(bothForm),{
      standings:dossier.standings,home:formH,away:formA },
      ['20 partidos anteriores de ambos equipos y fuerza de los rivales'],urls),
    C:make('Descanso, local/visita y viajes',observed(bothForm),{
      homeRestHours:formH?.restHours??null,awayRestHours:formA?.restHours??null,
      homeGames:formH?.homeGames??null,awayGames:formA?.awayGames??null },
      ['Viaje, cambio horario, back-to-back y factor local verificables'],urls),
    D:make('Goles, diferencial y tiros',observed(bothForm),{
      homeLast10:formH?.last10??[],awayLast10:formA?.last10??[] },
      ['Tiros, chances y ritmo ajustados en ambos extremos'],urls),
    E:make('Calidad de rivales','missing',null,
      ['Strength of schedule a fecha y rating del rival']),
    F:make('xG, xGA y 5 contra 5','missing',null,
      ['xG 5v5 por ambos equipos, shot quality y fuente metodológica']),
    G:make('Porteros titulares',goalieConfirmed?'verified':observed(anyGoalie),{
      candidates,confirmed:goalieConfirmed?{
        home:starter?.homeGoalie,away:starter?.awayGoalie,
        source:starter?.url,checkedAt:starter?.checkedAt}:null,
      probeState:starter?.state??'not-checked' },
      ['Dos porteros titulares oficialmente confirmados antes del partido'],
      starter?[starter.url]:[]),
    H:make('Rendimiento de porteros',observed(anyGoalie),{
      candidates,requested:['SV%','GAA','last5','GSAx'] },
      ['SV% y GAA del mismo portero, muestras 5/10/20 y GSAx validado'],urls),
    I:make('Plantillas y forma individual',observed(bothRosters),{
      home:dossier.players.home,away:dossier.players.away },
      ['On-ice xG, lesiones cruzadas y rendimiento de líneas verificables'],urls),
    J:make('Lesiones, scratches, sanciones','missing',null,
      ['Partes oficiales de ambos equipos y lista final de scratches']),
    K:make('Líneas y parejas defensivas','missing',null,
      ['Líneas 1–4 y parejas D confirmadas, cambios y matchups']),
    L:make('Power play y penalty kill',ppComplete?'verified':'partial',
      pp,['PP y PK de ambos equipos con temporada, cobertura y contexto'],sportsUrl),
    M:make('Enfrentamientos y head-to-head',
      observed(dossier.possibleMatchups.length>0),{
        rosterOnlyMatchups:dossier.possibleMatchups },
      ['Cara a cara y emparejamientos reales: NO inferir del roster'],urls),
    N:make('Noticias y contexto','missing',null,
      ['Noticias con fecha de ambas franquicias y verificación adversarial']),
    O:make('Cuotas NHL y reglas de mercado',observed(market.length>0),market,
      ['Precios actuales con casa, mercado 60min/OT/SO y ambas caras cotejadas']),
    P:make('Predicción NHL calibrada','missing',null,
      ['Predicción independiente ML/puckline/total validada fuera de muestra']),
    Q:make('Decisión y control de ticket','missing',null,
      ['Evidencia crítica, estimación calibrada, cuotas y EV antes del pick']),
  }
  const taskQueue=LETTERS.flatMap(letter=>
    modules[letter].missing.map(missing=>({
      event_id:fixture.id,module:letter,missing_fields:[missing],
      route:sourceHints[letter],
    })))
  const observation:Record<string,StepObservation>={}
  const put=(key:string,letter:ModuleLetter)=>{
    const mod=modules[letter]
    observation[key]={ state:mod.state,detail:(mod.topic+
      ': '+(mod.missing.join('; ')||'evidencia observada')).slice(0,500) }
  }
  for(const [key,letter] of [
    ['fixture','A'],['form','B'],['schedule','C'],['efficiency','F'],
    ['goalies','G'],['rosters','I'],['injuries','J'],
    ['lines','K'],['special','L'],['market','O'],
    ['H01','A'],['H02','B'],['H03','D'],['H04','C'],['H05','F'],
    ['H06','G'],['H07','H'],['H08','G'],['H09','K'],
    ['H10','C'],['H11','J'],['H12','O'],
  ] as Array<[string,ModuleLetter]>)put(key,letter)
  const game:NhlResearchGame={
    eventId:fixture.id,sport:'hockey',league:'nhl',
    home:fixture.home,away:fixture.away,scheduledUtc:fixture.date,
    snapshotCreatedUtc:dossier.checkedAt,snapshotState:fixture.state,
    captureBeforeTipoff:pregame,
    evidenceModules:modules,checklistObservations:observation,
    missingResearch:taskQueue,
    sourceRecords:dossier.sources.map(x=>({
      url:x.url,status:x.status,checkedAt:x.checkedAt })),
    gate:{...RESEARCH_GATE },
  }
  return{ schema:'phoenix.nhl.read-model.v1',operational:false,
    referenceDate:fixture.date.slice(0,10),games:[game],
    note:'Fuentes observadas y brechas para la investigación nativa de Kira; '+
      'no implica porteros confirmados, xG/GSAx, EV ni pick aprobado.' }
}
/** Strict read-only importer: historical snapshots cannot become live prices or
 * autonomous ticket approvals, even if the outer JSON claims otherwise.
 * @param value Previously exported NHL research JSON.
 * @returns Checked archive records, never live betting instructions.
 */
export function readNhlResearchHandoff(value:unknown):NhlResearchGame[]{
  const root=obj(value)
  if(!root||root.schema!=='phoenix.nhl.read-model.v1'||root.operational!==false)
    throw new Error('NHL handoff: invalid read-only schema')
  const games=arr(root.games)
  if(!games.length||games.length>64)throw new Error('NHL handoff: invalid game count')
  const seen=new Set<string>(),out:NhlResearchGame[]=[]
  for(const item of games){
    const g=obj(item),gate=obj(g?.gate),modules=obj(g?.evidenceModules)
    const id=eventId(g?.eventId)
    const home=obj(g?.home),away=obj(g?.away)
    if(!g||!gate||!modules||!home||!away||!id||seen.has(id)||
      !str(home.id)||!str(away.id)||str(home.id)===str(away.id))
      throw new Error('NHL handoff: duplicate or invalid fixture')
    if(g.sport!=='hockey'||g.league!=='nhl'||
      gate.researchOnly!==true||gate.eligibleForTicket!==false||
      gate.quotedOddsLive!==false||gate.modelCalibrated!==false||
      gate.expectedValue!==null||gate.recommendation!=='investigate')
      throw new Error('NHL handoff: attempted historical-to-operational elevation')
    const checked=stamp(g.snapshotCreatedUtc),start=stamp(g.scheduledUtc)
    if(!Number.isFinite(checked)||!Number.isFinite(start))
      throw new Error('NHL handoff: invalid timestamps')
    for(const letter of LETTERS){
      const m=obj(modules[letter])
      if(!m||!['verified','partial','missing'].includes(str(m.state))||
        !Array.isArray(m.missing)||!Array.isArray(m.sourceUrls))
        throw new Error('NHL handoff: incomplete A-Q evidence')
    }
    if(['P','Q'].some(k=>obj(modules[k])?.state!=='missing')||
      obj(modules.O)?.state==='verified')
      throw new Error('NHL handoff: uncalibrated forecast or historical odds elevated')
    seen.add(id)
    const steps=obj(g.checklistObservations)??{}
    const obs:Record<string,StepObservation>={}
    for(const [key,raw] of Object.entries(steps)){
      const s=obj(raw)
      if(!s||!['verified','partial','missing'].includes(str(s.state)))
        throw new Error('NHL handoff: invalid checklist state')
      obs[key]={ state:s.state as EvidenceState,detail:str(s.detail).slice(0,500) }
    }
    const tasks=arr(g.missingResearch).map((raw)=>{
      const t=obj(raw)
      if(!t||!LETTERS.includes(str(t.module) as ModuleLetter))
        throw new Error('NHL handoff: invalid research queue')
      return{ event_id:id,module:t.module as ModuleLetter,
        missing_fields:arr(t.missing_fields).map(str).filter(Boolean),
        route:str(t.route) }
    })
    out.push({
      eventId:id,sport:'hockey',league:'nhl',
      home:{ id:str(home.id),abbrev:str(home.abbrev),name:str(home.name) },
      away:{ id:str(away.id),abbrev:str(away.abbrev),name:str(away.name) },
      scheduledUtc:str(g.scheduledUtc),snapshotCreatedUtc:str(g.snapshotCreatedUtc),
      snapshotState:str(g.snapshotState),
      captureBeforeTipoff:checked<start&&
        ['FUT','PRE'].includes(str(g.snapshotState))&&g.captureBeforeTipoff===true,
      evidenceModules:modules as Record<ModuleLetter,NhlResearchModule>,
      checklistObservations:obs,missingResearch:tasks,
      sourceRecords:arr(g.sourceRecords).flatMap((x)=>{
        const r=obj(x)
        return r&&['verified','missing','error'].includes(str(r.status))?[{
          url:str(r.url),status:r.status as 'verified'|'missing'|'error',
          checkedAt:str(r.checkedAt)}]:[]
      }),gate:{...RESEARCH_GATE },
    })
  }
  return out
}
/** Native acquisition. The pregame specialist itself crosschecks NHL game ID
 * against the dated slate, and the official goalie probe is independent.
 * @param date NHL local calendar day for the official score endpoint.
 * @param gameId Official ten-digit NHL game identifier.
 * @param fetcher Injected HTTP client for live research or offline tests.
 * @param now Research timestamp in Unix milliseconds.
 * @returns Evidence collected by the native NHL specialist, read-only.
 */
export async function collectNhlResearchHandoff(
  date:string,gameId:string,fetcher:typeof fetch=fetch,now=Date.now(),
):Promise<NhlResearchHandoff>{
  const dossier=await investigateNhl(date,gameId,fetcher,now,[],8)
  const f=dossier.fixture
  const starter=await probeNhlOfficialStarters({
    gameId:f.id,homeAbbrev:f.home.abbrev,
    awayAbbrev:f.away.abbrev,kickoff:f.date,
  },fetcher,now)
  return buildNhlResearchHandoff(dossier,starter)
}
