/** Verifiable sports source catalog and point-in-time injury evidence.
 * This is NOT a prediction model or a claim that a speculative PDF exists.
 */
export const SPORTS_SOURCE_RESEARCH=Object.freeze([
  {id:'nba-official',sport:'nba',kind:'injuries',format:'html',reliability:'primary',historical:'published-reports',
    url:'https://official.nba.com/nba-injury-report-2026-27-season/'},
  {id:'nba-official-pdf',sport:'nba',kind:'injuries',format:'pdf',reliability:'primary',historical:'published-reports',
    url:'https://ak-static.cms.nba.com/referee/injury/Injury-Report_YYYY-MM-DD_HH_MMAM.pdf'},
  {id:'espn-nba-injuries',sport:'nba',kind:'injuries',format:'json',reliability:'secondary',historical:'capture-required',
    url:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries'},
  {id:'espn-nba-slate',sport:'nba',kind:'fixtures',format:'json',reliability:'secondary',historical:'capture-required',
    url:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD'},
  {id:'espn-nba-summary',sport:'nba',kind:'event-context',format:'json',reliability:'secondary',historical:'capture-required',
    url:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=EVENT_ID'},
  {id:'espn-nba-roster',sport:'nba',kind:'roster',format:'json',reliability:'secondary',historical:'capture-required',
    url:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/TEAM_ID/roster'},
  {id:'nhl-score',sport:'nhl',kind:'fixtures',format:'json',reliability:'primary',historical:'capture-required',
    url:'https://api-web.nhle.com/v1/score/YYYY-MM-DD'},
  {id:'mlb-schedule',sport:'mlb',kind:'starting-pitchers',format:'json',reliability:'primary',historical:'capture-required',
    url:'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=probablePitcher'},
  {id:'espn-nfl-slate',sport:'nfl',kind:'fixtures',format:'json',reliability:'secondary',historical:'capture-required',
    url:'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=YYYYMMDD'},
  {id:'espn-soccer-slate',sport:'soccer',kind:'fixtures',format:'json',reliability:'secondary',historical:'capture-required',
    url:'https://site.api.espn.com/apis/site/v2/sports/soccer/LEAGUE/scoreboard?dates=YYYYMMDD'},
])
const t=(s:string|null|undefined)=>s?Date.parse(s):Number.NaN
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const states:Record<string,string>={available:'available',active:'available',
  out:'out',inactive:'out',questionable:'questionable',
  doubtful:'doubtful',probable:'probable',daytoday:'questionable'}
export const normalizeAvailability=(s:string)=>states[norm(s)]??'unknown'
/** US Eastern wall clock. A generated URL is a candidate until fetched and parsed. */
export function nbaOfficialInjuryPdf(day:string,timeET:string):string{
  if(!/^\d{4}-\d{2}-\d{2}$/u.test(day)||
    !Number.isFinite(t(day+'T00:00:00Z'))||
    new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||
    !/^([01]\d|2[0-3]):(00|15|30|45)$/u.test(timeET))
    throw Error('Fecha u hora de reporte NBA inválidas')
  const [h,m]=timeET.split(':').map(Number)
  return 'https://ak-static.cms.nba.com/referee/injury/Injury-Report_'+day+
    '_'+String(h%12||12).padStart(2,'0')+'_'+String(m).padStart(2,'0')+
    (h>=12?'PM':'AM')+'.pdf'
}
export type InjurySnapshot={
  team:string;athlete:string;status:string;publishedAt:string;url:string
  capturedAt?:string|null;important?:boolean
}
export type SourceChange={
  team:string;athlete:string;previous:string;current:string
  publishedAt:string;important:boolean
}
export function auditInjuryTimeline(reports:readonly InjurySnapshot[],settings:{
  decisionAt:string;kickoffAt:string;mode:'prospective'|'reconstruction'
}){
  const cutoff=t(settings.decisionAt),kickoff=t(settings.kickoffAt)
  if(!Number.isFinite(cutoff)||!Number.isFinite(kickoff)||cutoff>=kickoff)
    throw Error('El corte de análisis debe anteceder al inicio')
  const seen=new Map<string,InjurySnapshot[]>()
  let excludedFuture=0,excludedUncaptured=0
  for(const s of reports){
    const published=t(s.publishedAt),captured=t(s.capturedAt)
    if(!Number.isFinite(published)||published>cutoff||published>=kickoff){
      excludedFuture++;continue
    }
    if(settings.mode==='prospective'&&(!Number.isFinite(captured)||
      captured<published||captured>cutoff)){
      excludedUncaptured++;continue
    }
    if(!s.team||!s.athlete||!s.url.startsWith('https://'))continue
    const key=norm(s.team)+'|'+norm(s.athlete)
    seen.set(key,[...(seen.get(key)??[]),s])
  }
  const changes:SourceChange[]=[],pending:Array<{
    team:string;athlete:string;status:string;important:boolean}>=[]
  for(const snapshots of seen.values()){
    snapshots.sort((a,b)=>t(a.publishedAt)-t(b.publishedAt))
    for(let i=1;i<snapshots.length;i++){
      const old=snapshots[i-1]!,current=snapshots[i]!
      const before=normalizeAvailability(old.status),after=normalizeAvailability(current.status)
      if(before!==after&&before!=='unknown'&&after!=='unknown')
        changes.push({team:current.team,athlete:current.athlete,
          previous:before,current:after,publishedAt:current.publishedAt,
          important:!!(current.important||old.important)})
    }
    const last=snapshots[snapshots.length-1]!,status=normalizeAvailability(last.status)
    if(['questionable','doubtful','unknown'].includes(status))
      pending.push({team:last.team,athlete:last.athlete,status,important:!!last.important})
  }
  return{mode:settings.mode,usable:reports.length-excludedFuture-excludedUncaptured,
    excludedFuture,excludedUncaptured,changes,pending,
    requiresReevaluation:changes.length>0||pending.length>0,
    warning:settings.mode==='reconstruction'?
      'Fuentes históricas encontradas después: NO prueba que PHOENIX las consultara a tiempo.':
      'Cambios observados a tiempo; revisar impacto, quintetos y precio sin inventar probabilidades.'}
}
export type HistoricalPick={
  eventKey:string;decisionAt:string;featuresThroughAt:string;kickoffAt:string
  outcomePublishedAt:string;result:'won'|'lost'|'push'
  modelProbability?:number|null;marketProbabilityNoVig?:number|null
}
/** Strict audit of ARCHIVED predictions, never recompute predictions using finals. */
export function auditCapturedBacktest(rows:readonly HistoricalPick[]){
  let eligible=0,rejected=0,wins=0,losses=0,pushes=0,modelN=0,marketN=0
  let modelBrier=0,marketBrier=0
  const ids=new Set<string>()
  for(const r of rows){
    const decision=t(r.decisionAt),kick=t(r.kickoffAt),
      features=t(r.featuresThroughAt),outcome=t(r.outcomePublishedAt)
    if(!r.eventKey||ids.has(r.eventKey)||![decision,kick,features,outcome]
      .every(Number.isFinite)||features>decision||decision>=kick||outcome<kick){
      rejected++;continue
    }
    ids.add(r.eventKey);eligible++
    if(r.result==='push'){pushes++;continue}
    if(r.result==='won')wins++;else if(r.result==='lost')losses++
    else{rejected++;eligible--;continue}
    const y=r.result==='won'?1:0
    if(typeof r.modelProbability==='number'&&r.modelProbability>0&&r.modelProbability<1){
      modelBrier+=(r.modelProbability-y)**2;modelN++
    }
    if(typeof r.marketProbabilityNoVig==='number'&&
      r.marketProbabilityNoVig>0&&r.marketProbabilityNoVig<1){
      marketBrier+=(r.marketProbabilityNoVig-y)**2;marketN++
    }
  }
  return{rows:rows.length,eligible,rejected,wins,losses,pushes,
    hitRate:wins+losses?wins/(wins+losses):null,
    modelBrier:modelN?Number((modelBrier/modelN).toFixed(6)):null,
    marketBrier:marketN?Number((marketBrier/marketN).toFixed(6)):null,
    modelSamples:modelN,marketSamples:marketN,calibrationValidated:false,
    warning:modelN<30?'Muestra insuficiente: no certificar modelo o rentabilidad.':
      'Brier descriptivo: se requiere holdout cronológico y comparación con baseline.'}
}
