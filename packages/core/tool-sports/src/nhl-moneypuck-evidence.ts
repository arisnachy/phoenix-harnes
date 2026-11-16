/**
 * Opt-in MoneyPuck CSV evidence, never a sportsbook or a starter-confirmation feed.
 * Public downloads are permitted for non-commercial usage with attribution.
 * Commercial use requires permission: https://moneypuck.com/data.htm
 *
 * No HTML crawling, no inferred zeroes, no post-decision data in backtests.
 */
export type NhlAdvancedTeam = {
  games:number; xGoalsFor:number; xGoalsAgainst:number; xGoalsPct:number|null;
  corsiPct:number|null; fenwickPct:number|null
}
export type NhlAdvancedGoalie = {
  playerId:string; games:number; xGoalsAgainst:number; goalsAgainst:number;
  gsaX:number; highDangerGoals:number|null; highDangerShots:number|null
}
export type NhlMoneyPuckEvidence = {
  status:'verified'|'disabled'|'stale'|'missing'|'error'
  reason:string; source:'MoneyPuck'; updatedAt:string|null
  urls:string[]; attribution:'Data: MoneyPuck.com'
  teams:{home:NhlAdvancedTeam|null;away:NhlAdvancedTeam|null}
  goalies:{home:NhlAdvancedGoalie[];away:NhlAdvancedGoalie[]}
}
type Row=Record<string,string>
const ORIGIN='https://moneypuck.com/moneypuck/playerData/seasonSummary/'
const MAX_AGE=48*60*60_000
const MAX_CSV=350_000
const MAX_ROWS=15_000
const clean=(s:string)=>s.replace(/^\uFEFF/u,'').trim()
const numeric=(s:unknown,min=0,max=10_000):number|null=>{
  if(typeof s!=='string'||!s.trim())return null
  const n=Number(s)
  return Number.isFinite(n)&&n>=min&&n<=max?n:null
}
const rounded=(n:number)=>Number(n.toFixed(3))
const pct=(v:unknown):number|null=>{
  const n=numeric(v,0,100)
  return n===null?null:rounded(n>1?n/100:n)
}
/** RFC4180 quote handling with caps: parse only supplied/downloaded CSV, not web HTML. */
export function parseMoneyPuckCsv(csv:string):Row[]{
  if(csv.length>MAX_CSV||csv.length<8)throw Error('MoneyPuck CSV: tamaño inválido')
  const cells:string[][]=[]
  let row:string[]=[],field='',quoted=false
  for(let i=0;i<csv.length;i++){
    const c=csv[i]!
    if(c==='"'){
      if(quoted&&csv[i+1]==='"'){field+='"';i++}
      else quoted=!quoted
    }else if(c===','&&!quoted){row.push(field);field=''}
    else if((c==='\n'||c==='\r')&&!quoted){
      if(c==='\r'&&csv[i+1]==='\n')i++
      row.push(field);field=''
      if(row.some(v=>v.length))cells.push(row)
      row=[]
      if(cells.length>MAX_ROWS)throw Error('MoneyPuck CSV: demasiadas filas')
    }else field+=c
  }
  if(quoted)throw Error('MoneyPuck CSV: comillas sin cerrar')
  row.push(field)
  if(row.some(v=>v.length))cells.push(row)
  const header=cells.shift()?.map(clean)??[]
  if(!header.includes('situation')||header.length<4||new Set(header).size!==header.length)
    throw Error('MoneyPuck CSV: columnas requeridas ausentes')
  return cells.filter(x=>x.length===header.length).map(x=>
    Object.fromEntries(header.map((key,i)=>[key,clean(x[i]??'')])))
}
export function parseMoneyPuckAdvanced(
  teamsCsv:string,goaliesCsv:string,args:{
    homeAbbrev:string;awayAbbrev:string;homeGoalieIds:readonly string[];
    awayGoalieIds:readonly string[];
  },
):Pick<NhlMoneyPuckEvidence,'teams'|'goalies'>{
  const teams=parseMoneyPuckCsv(teamsCsv),goalies=parseMoneyPuckCsv(goaliesCsv)
  const team=(abbr:string):NhlAdvancedTeam|null=>{
    if(!/^[A-Z]{2,4}$/u.test(abbr))return null
    const matching=teams.filter(x=>x.team===abbr&&x.situation==='5on5')
    if(matching.length!==1)return null
    const r=matching[0]!,games=numeric(r.games_played,1,100)!
    const forX=numeric(r.xGoalsFor),againstX=numeric(r.xGoalsAgainst)
    if(!games||forX===null||againstX===null)return null
    return{games,xGoalsFor:rounded(forX),xGoalsAgainst:rounded(againstX),
      xGoalsPct:pct(r.xGoalsPercentage),corsiPct:pct(r.corsiPercentage),
      fenwickPct:pct(r.fenwickPercentage)}
  }
  const byIds=(ids:readonly string[]):NhlAdvancedGoalie[]=>{
    const allowed=new Set(ids.filter(x=>/^\d{7,9}$/u.test(x)))
    const out:NhlAdvancedGoalie[]=[]
    for(const id of allowed){
      const rows=goalies.filter(r=>r.playerId===id&&r.situation==='all')
      if(rows.length!==1)continue
      const r=rows[0]!,games=numeric(r.games_played,1,100)
      const xg=numeric(r.xGoals??r.xGoalsAgainst)
      const ga=numeric(r.goals??r.goalsAgainst)
      if(games===null||xg===null||ga===null)continue
      out.push({playerId:id,games,xGoalsAgainst:rounded(xg),
        goalsAgainst:rounded(ga),gsaX:rounded(xg-ga),
        highDangerGoals:numeric(r.highDangerGoals),
        highDangerShots:numeric(r.highDangerShots)})
    }
    return out
  }
  return{teams:{home:team(args.homeAbbrev),away:team(args.awayAbbrev)},
    goalies:{home:byIds(args.homeGoalieIds),away:byIds(args.awayGoalieIds)}}
}
const blank=(status:NhlMoneyPuckEvidence['status'],reason:string,urls:string[]=[],
  updatedAt:string|null=null):NhlMoneyPuckEvidence=>({
  status,reason,source:'MoneyPuck',attribution:'Data: MoneyPuck.com',updatedAt,urls,
  teams:{home:null,away:null},goalies:{home:[],away:[]},
})
const cache=new Map<string,{checked:number;updatedAt:string;teams:string;goalies:string}>()
async function download(url:string,fetcher:typeof fetch,limit:number):Promise<string>{
  const response=await fetcher(url,{signal:AbortSignal.timeout(4_000),
    headers:{Accept:'text/plain,text/csv'}})
  if(!response.ok)throw Error('HTTP '+response.status+' @ '+url)
  const raw=await response.text()
  if(raw.length>limit||raw.length<8||/^\s*</u.test(raw))
    throw Error('Respuesta no CSV o tamaño inesperado @ '+url)
  return raw
}
/**
 * Default OFF until the operator declares eligible non-commercial usage.
 * Parallel 90KB/67KB CSV downloads, once per 15-minute in-memory cache.
 * CSV publication time must be before decision and before faceoff.
 */
export async function fetchNhlMoneyPuckEvidence(args:{
  season:string;homeAbbrev:string;awayAbbrev:string;
  homeGoalieIds:readonly string[];awayGoalieIds:readonly string[];
  kickoff:string;decisionAt:number;enabled?:boolean
},fetcher:typeof fetch=fetch):Promise<NhlMoneyPuckEvidence>{
  if(args.enabled!==true)return blank('disabled',
    'MoneyPuck no habilitado: requiere uso no comercial autorizado o licencia')
  const year=/^(20\d{2})(?:20\d{2})?$/u.exec(args.season)?.[1]
  const kickoff=Date.parse(args.kickoff)
  if(!year||!Number.isFinite(kickoff)||!Number.isFinite(args.decisionAt)||
    args.decisionAt>=kickoff)return blank('missing','Temporada o corte pregame inválido')
  const stampUrl=ORIGIN+'update_date.txt'
  const base=ORIGIN+year+'/regular/'
  const urls=[stampUrl,base+'teams.csv',base+'goalies.csv']
  try{
    let row=cache.get(year)
    if(!row||args.decisionAt-row.checked>=15*60_000||args.decisionAt<row.checked){
      const raw=await download(stampUrl,fetcher,128)
      const updatedAt=new Date(Date.parse(raw.trim().replace(' ','T'))).toISOString()
      const updated=Date.parse(updatedAt)
      if(!Number.isFinite(updated))return blank('error','Sello de exportación inválido',urls)
      // Crucial: a file fetched today may contain results from after a historic pick.
      if(updated>args.decisionAt||updated>=kickoff)return blank('missing',
        'CSV contiene fecha posterior al corte; prohíbe leakage retrospectivo',urls,updatedAt)
      if(args.decisionAt-updated>MAX_AGE)return blank('stale',
        'MoneyPuck supera 48 horas de antigüedad',urls,updatedAt)
      const [teams,goalies]=await Promise.all([
        download(base+'teams.csv',fetcher,MAX_CSV),
        download(base+'goalies.csv',fetcher,MAX_CSV),
      ])
      row={checked:args.decisionAt,updatedAt,teams,goalies}
      cache.set(year,row)
    }
    const advanced=parseMoneyPuckAdvanced(row.teams,row.goalies,args)
    if(!advanced.teams.home||!advanced.teams.away)
      return {...blank('missing','CSV sin las dos filas 5v5 verificadas',urls,row.updatedAt),
        ...advanced}
    return{...blank('verified','5v5 y GSAx extraídos sin inferir titulares',urls,row.updatedAt),
      ...advanced}
  }catch(e){
    return blank('error','MoneyPuck: '+String(e instanceof Error?e.message:e).slice(0,140),urls)
  }
}
