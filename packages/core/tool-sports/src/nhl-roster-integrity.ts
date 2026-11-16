/** NHL club-roster + club-stats + ESPN injury reconciliation.
 * A roster spot is NOT availability. ESPN IDs are never joined to NHL IDs.
 * All output is sourced and point-in-time; missing != zero or healthy.
 */
import type {HockeyPlayer} from './nhl-evidence-research.ts'
import type {InjuryBackup,InjuryRecord} from './espn-injury-backup.ts'
export type NhlAvailability='reported-out'|'reported-doubtful'|
  'reported-questionable'|'reported-day-to-day'|'reported-probable'|
  'reported-injured-reserve'|'other-report'|'not-reported'|'feed-unavailable'|
  'ambiguous-report'|'report-after-snapshot'
export type NhlRosterPlayerAudit={
  playerId:string;team:string;name:string;role:HockeyPlayer['role'];
  seasonMetrics:Record<string,number|string>;
  seasonStatStatus:'matched'|'missing'|'foreign-namespace';
  availability:NhlAvailability;
  availabilitySource:string|null;availabilityPublishedAt:string|null;
  availabilityDetail:string|null;
  impactIfAbsent:'high'|'moderate'|'unquantified';
  /** ESPN report status is NOT a final game-day scratch or club confirmation. */
  officialInactiveConfirmed:false
}
export type NhlRosterSideAudit={
  players:NhlRosterPlayerAudit[];count:number;matchedStats:number;
  unmatchedInjuries:Array<{athlete:string;status:string;reason:string}>;
  reportedOut:number;reportedQuestionable:number;missingSeasonStats:number;
  statCoveragePct:number;injuryFeedStatus:InjuryBackup['status']|null
}
export type NhlFullRosterAudit={home:NhlRosterSideAudit;away:NhlRosterSideAudit;
  checkedAt:string;seasonStatSource:'NHL club-stats';injurySource:string|null;
  allPlayerStatsCovered:boolean;allAvailabilityConfirmed:false;
  notes:string[]}
const obj=(x:unknown):Record<string,unknown>=>x&&typeof x==='object'&&!Array.isArray(x)?
  x as Record<string,unknown>:{}
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const normalized=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const number=(x:unknown,signed=false):number|null=>{
  if(typeof x!=='number'&&typeof x!=='string')return null
  if(typeof x==='string'&&!x.trim())return null
  const n=Number(x)
  return Number.isFinite(n)&&(signed||n>=0)&&Math.abs(n)<=100_000?n:null
}
const pct=(x:unknown):number|null=>{
  const n=number(x)
  if(n===null)return null
  const v=n>1?n/100:n
  return v<=1?Number(v.toFixed(5)):null
}
const metricKeys={
  skater:['gamesPlayed','goals','assists','points','plusMinus','penaltyMinutes',
    'powerPlayGoals','shorthandedGoals','gameWinningGoals','overtimeGoals','shots',
    'shootingPctg','avgTimeOnIcePerGame','avgShiftsPerGame','faceoffWinPctg'],
  goalie:['gamesPlayed','gamesStarted','wins','losses','overtimeLosses',
    'goalsAgainstAverage','savePctg','shotsAgainst','saves','goalsAgainst',
    'shutouts','timeOnIce','goals','assists','points'],
} as const
const aliases:Record<string,string[]>={
  savePctg:['savePctg','savePercentage','savePct'],
  goalsAgainstAverage:['goalsAgainstAverage','goalsAgainstAvg'],
}
function metrics(source:Record<string,unknown>,role:HockeyPlayer['role']){
  const result:Record<string,number|string>={}
  for(const key of role==='goalie'?metricKeys.goalie:metricKeys.skater){
    const values=aliases[key]??[key]
    const value=values.map(k=>source[k]).find(x=>x!==undefined&&x!==null)
    if(value===undefined)continue
    if(key==='shootingPctg'||key==='savePctg'||key==='faceoffWinPctg'){
      const n=pct(value)
      if(n!==null)result[key]=n
    }else if(key==='avgTimeOnIcePerGame'&&typeof value==='string'&&
      /^\d{1,2}:\d{2}$/u.test(value))result[key]=value
    else{
      const n=number(value,key==='plusMinus')
      if(n!==null)result[key]=n
    }
  }
  return result
}
const availability=(value:string):NhlAvailability=>{
  const x=value.toLowerCase().replace(/[-_]/gu,' ')
  if(/injured reserve|long.term|\bltir\b|\bir\b/iu.test(x))return'reported-injured-reserve'
  if(/out|inactive|suspended|ruled out/iu.test(x))return'reported-out'
  if(/doubtful/iu.test(x))return'reported-doubtful'
  if(/questionable|game.time decision/iu.test(x))return'reported-questionable'
  if(/day.to.day|day to day/iu.test(x))return'reported-day-to-day'
  if(/probable/iu.test(x))return'reported-probable'
  return'other-report'
}
const impact=(p:Record<string,number|string>,role:HockeyPlayer['role'])=>{
  if(role==='goalie'){
    // Games started is observed workload; never predict that the goalie starts.
    return typeof p.gamesStarted==='number'&&p.gamesStarted>=5?
      'high' as const:'unquantified' as const
  }
  const games=typeof p.gamesPlayed==='number'?p.gamesPlayed:0
  const pts=typeof p.points==='number'?p.points:0
  const ppg=games>0?pts/games:0
  const toi=typeof p.avgTimeOnIcePerGame==='number'?p.avgTimeOnIcePerGame:0
  return ppg>=0.8||toi>=1200?'high' as const:
    ppg>=0.4||toi>=900?'moderate' as const:'unquantified' as const
}
function side(roster:readonly HockeyPlayer[],payload:unknown,
  injury:InjuryBackup['home']|null,feed:InjuryBackup|null,
  now:number,kickoff:string):NhlRosterSideAudit{
  const data=obj(payload)
  const skaters=arr(data.skaters).map(obj)
  const goalies=arr(data.goalies).map(obj)
  const validIds=new Set(roster.filter(p=>p.idProvider==='NHL').map(p=>p.id))
  const indexed=new Map<string,Record<string,unknown>>()
  for(const record of [...skaters,...goalies]){
    const id=String(record.playerId??'')
    if(validIds.has(id)&&!indexed.has(id))indexed.set(id,record)
  }
  const asof=Number.isFinite(Date.parse(kickoff))?
    Math.min(now,Date.parse(kickoff)):now
  const feedTime=Date.parse(feed?.feedUpdatedAt??'')
  const feedValid=!!feed&&['verified','partial'].includes(feed.status)&&
    Number.isFinite(feedTime)&&feedTime<=asof
  const injuries:InjuryRecord[]=feedValid?injury?.injuries??[]:[]
  const byName=new Map<string,InjuryRecord[]>()
  for(const record of injuries){
    const t=Date.parse(record.reportedAt??'')
    if(record.reportedAt&&(!Number.isFinite(t)||t>asof))continue
    const key=normalized(record.athlete)
    byName.set(key,[...(byName.get(key)??[]),record])
  }
  const players=roster.map(p=>{
    const record=p.idProvider==='NHL'?indexed.get(p.id):undefined
    const seasonMetrics=record?metrics(record,p.role):{}
    const list=byName.get(normalized(p.name))??[]
    // An athlete appearing more than once with inconsistent statuses is
    // ambiguous, NOT one confidently ruled out.
    const unique=[...new Set(list.map(x=>x.status.toLowerCase()))]
    let state:NhlAvailability=feedValid?'not-reported':'feed-unavailable'
    if(list.length&&unique.length>1)state='ambiguous-report'
    else if(list.length)state=availability(list[0]!.status)
    const reportedAt=list[0]?.reportedAt??null
    return{
      playerId:p.id,team:p.team,name:p.name,role:p.role,
      seasonMetrics,seasonStatStatus:p.idProvider!=='NHL'?
        'foreign-namespace' as const:record?'matched' as const:'missing' as const,
      availability:state,
      availabilitySource:list[0]?.source??null,
      availabilityPublishedAt:reportedAt,
      availabilityDetail:list[0]?.details??null,
      impactIfAbsent:impact(seasonMetrics,p.role),
      officialInactiveConfirmed:false as const,
    }
  })
  const matchedNames=new Set(players.map(p=>normalized(p.name)))
  const unmatchedInjuries=injuries.filter(x=>!matchedNames.has(normalized(x.athlete)))
    .map(x=>({athlete:x.athlete,status:x.status,
      reason:'Sin coincidencia exacta en roster NHL del mismo equipo; ID ESPN es diferente'}))
  const matchedStats=players.filter(p=>p.seasonStatStatus==='matched').length
  const reportedOut=players.filter(p=>['reported-out','reported-injured-reserve']
    .includes(p.availability)).length
  const reportedQuestionable=players.filter(p=>[
    'reported-questionable','reported-doubtful','reported-day-to-day'
  ].includes(p.availability)).length
  return{players,count:players.length,matchedStats,unmatchedInjuries,
    reportedOut,reportedQuestionable,missingSeasonStats:players.length-matchedStats,
    statCoveragePct:players.length?Number((matchedStats/players.length*100).toFixed(1)):0,
    injuryFeedStatus:feed?.status??null}
}
export function buildNhlFullRosterAudit(
  roster:{home:readonly HockeyPlayer[];away:readonly HockeyPlayer[]},
  seasonStats:{home:unknown;away:unknown},
  injury:InjuryBackup|null=null,now=Date.now(),
  kickoff='9999-01-01T00:00:00Z',
):NhlFullRosterAudit{
  const home=side(roster.home,seasonStats.home,injury?.home??null,injury,now,kickoff)
  const away=side(roster.away,seasonStats.away,injury?.away??null,injury,now,kickoff)
  return{home,away,checkedAt:new Date(now).toISOString(),
    seasonStatSource:'NHL club-stats',
    injurySource:injury?.source??null,
    allPlayerStatsCovered:home.count>0&&away.count>0&&
      home.missingSeasonStats===0&&away.missingSeasonStats===0,
    allAvailabilityConfirmed:false,
    notes:[
      'Roster NHL no demuestra que el jugador esté vestido ni disponible.',
      'ESPN injury status es reporte secundario, no scratches oficiales ni portero titular.',
      'No encontrado en ESPN NO equivale a sano; sin stats de temporada NO equivale a cero.',
      'Métricas del club son acumulados de la temporada al momento de consulta, no archivo histórico punto-en-tiempo.',
    ]}
}

/** Reconcile a fetched ESPN report without re-fetching club stats or NHL IDs. */
export function reconcileNhlRosterAvailability(
  base:NhlFullRosterAudit,report:InjuryBackup|null,now:number,kickoff:string,
):NhlFullRosterAudit{
  const sides=['home','away'] as const
  const asof=Math.min(now,Date.parse(kickoff))
  const feedAt=Date.parse(report?.feedUpdatedAt??'')
  const valid=!!report&&['verified','partial'].includes(report.status)&&
    Number.isFinite(asof)&&Number.isFinite(feedAt)&&feedAt<=asof
  const result={...base,checkedAt:new Date(now).toISOString(),
    injurySource:report?.source??null,
    notes:[...base.notes]}
  for(const key of sides){
    const prior=base[key],records=valid?(report?.[key].injuries??[]):[]
    const matchedNames=new Set<string>()
    const players=prior.players.map(p=>{
      const matches=records.filter(x=>normalized(x.athlete)===normalized(p.name)&&
        (!x.reportedAt||Date.parse(x.reportedAt)<=asof))
      const statuses=[...new Set(matches.map(x=>x.status.toLowerCase()))]
      const match=matches[0]
      if(match)matchedNames.add(normalized(p.name))
      const state:NhlAvailability=!valid?'feed-unavailable':!matches.length?
        'not-reported':statuses.length>1?'ambiguous-report':
        availability(match!.status)
      return{...p,availability:state,
        availabilitySource:match?.source??null,
        availabilityPublishedAt:match?.reportedAt??null,
        availabilityDetail:match?.details??null,
      }
    })
    const unmatchedInjuries=records.filter(x=>
      !matchedNames.has(normalized(x.athlete))).map(x=>({
        athlete:x.athlete,status:x.status,
        reason:'Nombre o fecha sin correspondencia segura en este roster NHL',
      }))
    result[key]={...prior,players,unmatchedInjuries,
      reportedOut:players.filter(p=>['reported-out','reported-injured-reserve']
        .includes(p.availability)).length,
      reportedQuestionable:players.filter(p=>[
        'reported-questionable','reported-doubtful','reported-day-to-day',
      ].includes(p.availability)).length,
      injuryFeedStatus:report?.status??null}
  }
  if(!valid)result.notes.push('Reporte ESPN no publicado o no vigente antes del corte: no confirmar bajas')
  if(result.home.unmatchedInjuries.length||result.away.unmatchedInjuries.length)
    result.notes.push('Reportes sin coincidencia por nombre: no convertir en bajas del roster')
  return result
}
