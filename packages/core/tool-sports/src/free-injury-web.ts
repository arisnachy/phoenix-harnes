/** Free, no-key web sources for injury cross-checking.
 * Conservative: a reachable page is NOT a game-day official injury decision.
 * Only same-row, unambiguous team + athlete + status pairs are observations.
 */
export type FreeInjuryFixture = {
  sport:string; league:string; home:string; away:string;
  date?:string; kickoff?:string
}
export type FreeInjuryPlayer = {
  team:string; athlete:string; status:string; reason:string;
  source:string; reportedAt:null
}
export type FreeInjurySource = {
  provider:string; url:string;
  state:'linked'|'matched'|'readable'|'unavailable'|'skipped';
  reportUrl:string|null; players:FreeInjuryPlayer[]; note:string
}
export const KEYLESS_INJURY_CATALOG=Object.freeze([
  {provider:'NBA oficial',sport:'basketball',league:'nba',
    url:'https://official.nba.com/nba-injury-report-2026-27-season/',kind:'official'},
  {provider:'Action Network',sport:'basketball',league:'nba',
    url:'https://www.actionnetwork.com/nba/injury-report',kind:'secondary'},
  {provider:'B4SK3T',sport:'basketball',league:'nba',
    url:'https://www.b4sk3t.com/injuries',kind:'secondary'},
  {provider:'FOX Sports NBA',sport:'basketball',league:'nba',
    url:'https://www.foxsports.com/nba/injuries',kind:'secondary'},
  {provider:'FOX Sports NHL',sport:'hockey',league:'nhl',
    url:'https://www.foxsports.com/nhl/injuries',kind:'secondary'},
  {provider:'FOX Sports NFL',sport:'football',league:'nfl',
    url:'https://www.foxsports.com/nfl/injuries',kind:'secondary'},
] as const)
const normalized=(value:string)=>value.normalize('NFD')
  .replace(/[\u0300-\u036f]/gu,'').toLowerCase().replace(/[^a-z0-9]/gu,'')
const unescapeHtml=(value:string)=>value
  .replace(/&nbsp;|&#160;/giu,' ').replace(/&amp;/giu,'&')
  .replace(/&quot;|&#34;/giu,'"').replace(/&#39;|&apos;/giu,"'")
  .replace(/&lt;/giu,'<').replace(/&gt;/giu,'>')
  .replace(/&#(\d+);/gu,(_,number:string)=>{
    const n=Number(number);return n>=32&&n<=0x10ffff?String.fromCodePoint(n):' '
  })
const strip=(html:string)=>unescapeHtml(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu,' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu,' ')
  .replace(/<[^>]+>/gu,' ').replace(/\s+/gu,' ').trim()).slice(0,180)
const textAndAlt=(cell:string)=>{
  const alt=[...cell.matchAll(/\balt=["']([^"']{2,160})["']/giu)]
    .map(m=>unescapeHtml(m[1]??'')).join(' ')
  return(strip(cell)+' '+alt).trim()
}
const classification=(value:string):string|null=>{
  const s=value.trim().replace(/\s+/gu,' ').toLowerCase()
  return /^(?:out|out for season|season-ending|inactive|dnp)$/u.test(s)?'Out':
    /^(?:doubtful)$/u.test(s)?'Doubtful':
    /^(?:questionable|game time decision|gtd)$/u.test(s)?'Questionable':
    /^(?:probable)$/u.test(s)?'Probable':
    /^(?:available|active)$/u.test(s)?'Available':
    /^(?:day-to-day|day to day)$/u.test(s)?'Day-to-Day':null
}
const playerName=(value:string):boolean=>value.length>=5&&value.length<80
  && !/\d/u.test(value)
  && /^(?:[\p{L}.'’\-]+\s+){1,4}[\p{L}.'’\-]+(?:\s+(?:Jr\.?|Sr\.?|II|III|IV))?$/iu.test(value)
const inTeam=(s:string,team:string)=>normalized(s).includes(normalized(team))
/** Extract only properly scoped table rows; an unmatched website cannot
 * prove that a player is healthy or that a listed player belongs to a team.
 */
export function parseKeylessInjuryRows(html:string,fixture:FreeInjuryFixture,
  source:string):FreeInjuryPlayer[]{
  const result:FreeInjuryPlayer[]=[],seen=new Set<string>()
  const rows=html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/giu)??[]
  for(const tr of rows.slice(0,800)){
    const cells=(tr.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/giu)??[])
      .map(c=>({visible:strip(c),all:textAndAlt(c)}))
    if(cells.length<3)continue
    const side=[fixture.home,fixture.away].filter(t=>cells.some(c=>inTeam(c.all,t)))
    if(side.length!==1)continue
    const team=side[0]!
    const statuses=cells.map((c,i)=>({status:classification(c.visible),i}))
      .filter((x):x is {status:string;i:number}=>x.status!==null)
    if(statuses.length!==1)continue
    const status=statuses[0]!
    // The name must be an independent, complete cell, not the whole row's
    // free text. Never infer it from the roster or news headline.
    // In FOX-like tables the injury column ("Right knee") can itself
    // resemble a two-word athlete name. Only consider columns BEFORE status,
    // prefer the nearest candidate to the explicit team cell and reject ties.
    const teamIndex=cells.findIndex(c=>inTeam(c.all,team))
    const names=cells.map((c,i)=>({name:c.visible,i}))
      .filter(c=>c.i<status.i&&!inTeam(cells[c.i]!.all,team)
        &&playerName(c.name)
        &&!/^(?:injury report|health report|player report)$/iu.test(c.name))
      .sort((a,b)=>Math.abs(a.i-teamIndex)-Math.abs(b.i-teamIndex))
    if(!names.length||(names.length>1&&
      Math.abs(names[0]!.i-teamIndex)===Math.abs(names[1]!.i-teamIndex)))
      continue
    const athlete=names[0]!.name
    const key=normalized(team)+'|'+normalized(athlete)
    if(seen.has(key))continue
    seen.add(key)
    const reason=cells.filter((c,i)=>i!==status.i&&c.visible!==athlete
      &&!inTeam(c.all,team)&&c.visible.length>2)
      .map(c=>c.visible).slice(0,2).join(' · ').slice(0,150)
    result.push({team,athlete,status:status.status,reason,source,reportedAt:null})
  }
  return result.slice(0,80)
}
const easternStamp=(timestamp:number)=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',
    minute:'2-digit',hourCycle:'h23'}).formatToParts(timestamp)
  const read=(kind:string)=>parts.find(x=>x.type===kind)?.value??''
  return read('year')+read('month')+read('day')+read('hour')+read('minute')
}
/** Locate a PDF linked on the real official listing. Never synthesize a
 * predictable-looking URL and label it verified without observing that link.
 */
export function discoverNbaOfficialReport(html:string,day:string,now:number,
  kickoff?:string):string|null{
  if(!/^\d{4}-\d{2}-\d{2}$/u.test(day))return null
  const cutoff=Math.min(now,Number.isFinite(Date.parse(kickoff??''))?
    Date.parse(kickoff!)-1:now)
  const stamp=easternStamp(cutoff),target=day.replaceAll('-','')
  const hrefs=[...html.matchAll(/\bhref=["']([^"'<>]{1,350})["']/giu)]
  const options=hrefs.flatMap(match=>{
    try{
      const raw=unescapeHtml(match[1]??'')
      const url=new URL(raw,'https://official.nba.com/')
      if(url.hostname!=='ak-static.cms.nba.com'||
        !url.pathname.startsWith('/referee/injury/'))return []
      const m=url.pathname.match(/Injury-Report_(\d{4})-(\d{2})-(\d{2})_(\d{2})_(\d{2})(AM|PM)\.pdf$/iu)
      if(!m)return []
      const hour=Number(m[4]),minute=Number(m[5])
      if(hour<1||hour>12||minute>59)return []
      const h24=(hour%12)+(m[6]!.toUpperCase()==='PM'?12:0)
      const publication=m[1]!+m[2]!+m[3]!+
        String(h24).padStart(2,'0')+m[5]!
      return publication.startsWith(target)&&publication<=stamp?
        [{publication,url:url.href}]:[]
    }catch{return []}
  })
  options.sort((a,b)=>b.publication.localeCompare(a.publication))
  return options[0]?.url??null
}
const liveCache=new Map<string,{until:number;request:Promise<string>}>()
async function readPage(url:string,fetcher:typeof fetch,now:number):Promise<string>{
  if(fetcher===fetch){
    const cached=liveCache.get(url)
    if(cached&&cached.until>now)return cached.request
  }
  const request=(async()=>{
    const res=await fetcher(url,{signal:AbortSignal.timeout(2_800),
      headers:{Accept:'text/html,application/xhtml+xml'}})
    if(!res.ok)throw Error('HTTP '+res.status)
    const type=res.headers.get('content-type')
    if(type&&!/text\/html|application\/xhtml\+xml/iu.test(type))
      throw Error('Respuesta no HTML')
    return(await res.text()).slice(0,2_000_000)
  })()
  if(fetcher===fetch){
    if(liveCache.size>12)liveCache.clear()
    liveCache.set(url,{until:now+90_000,request})
  }
  try{return await request}catch(error){
    if(fetcher===fetch)liveCache.delete(url)
    throw error
  }
}
/** Time-bound independent public checks for the exact pregame fixture.
 * After kickoff, live pages cannot reconstruct a historical pregame report.
 */
export async function inspectKeylessInjurySources(
  fixture:FreeInjuryFixture,fetcher:typeof fetch=fetch,now=Date.now(),
):Promise<FreeInjurySource[]>{
  const candidates=KEYLESS_INJURY_CATALOG.filter(x=>
    x.sport===fixture.sport&&x.league===fixture.league)
  if(!candidates.length)return []
  if(fixture.kickoff&&Date.parse(fixture.kickoff)<=now)
    return candidates.map(s=>({provider:s.provider,url:s.url,state:'skipped' as const,
      reportUrl:null,players:[],note:'Partido iniciado: no usar páginas actuales para reconstruir bajas previas'}))
  return Promise.all(candidates.map(async s=>{
    try{
      const html=await readPage(s.url,fetcher,now)
      if(s.kind==='official'){
        const reportUrl=discoverNbaOfficialReport(html,fixture.date??'',
          now,fixture.kickoff)
        return{provider:s.provider,url:s.url,
          state:reportUrl?'linked' as const:'readable' as const,
          reportUrl,players:[],
          note:reportUrl?'PDF oficial fechado descubierto; contenido NO interpretado':
            'Índice consultado sin PDF fechado comprobable para este partido'}
      }
      const players=parseKeylessInjuryRows(html,fixture,s.url)
      return{provider:s.provider,url:s.url,
        state:players.length?'matched' as const:'readable' as const,
        reportUrl:null,players,note:players.length?
          'Filas con equipo, jugador y estado cotejados; fuente secundaria, no lista oficial de inactivos':
          'Página consultada sin filas individuales vinculables a ambos equipos'}
    }catch(error){
      return{provider:s.provider,url:s.url,state:'unavailable' as const,
        reportUrl:null,players:[],note:(error instanceof Error?
          error.message:String(error)).slice(0,120)}
    }
  }))
}
