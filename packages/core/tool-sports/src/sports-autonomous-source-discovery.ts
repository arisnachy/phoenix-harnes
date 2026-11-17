/** Kira-triggered, topic-specific OPEN article discovery, not a trusted report.
 * Query GDELT's fixed public index. No arbitrary URL fetch, paywall bypass,
 * invented publisher allowlist, odds scraping or claimed article verification.
 */
export type AutonomousNewsHit={
  title:string;publisher:string;articleUrl:string;indexedAt:string|null;
  status:'indexed-only';source:'GDELT DOC 2.0'
}
export type AutonomousNewsFinding={
  status:'observed'|'empty'|'unavailable';question:string;
  queriedAt:string;queryUrl:string|null;articles:AutonomousNewsHit[];
  source:'GDELT DOC 2.0';limitation:string
}
const clean=(input:string,max:number)=>input.replace(/[^\p{L}\p{N}\s.'-]/gu,' ')
  .replace(/\s+/gu,' ').trim().slice(0,max)
const safeUrl=(raw:unknown):string|null=>{
  if(typeof raw!=='string')return null
  try{
    const u=new URL(raw)
    return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.includes('.')?
      u.toString():null
  }catch{return null}
}
const seen=(raw:unknown):string|null=>{
  if(typeof raw!=='string')return null
  const date=/^\d{8}T\d{6}Z$/u.test(raw)?
    raw.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/u,
      '$1-$2-$3T$4:$5:$6Z'):raw
  const time=Date.parse(date)
  return Number.isFinite(time)?new Date(time).toISOString():null
}
const quoted=(value:string)=>'"'+clean(value,70)+'"'
/** Search independently chosen athlete/injury/lineup/tactical questions across
 * publishers GDELT indexes, not only the preconfigured ESPN/portal list.
 * @param teams - ESPN-verified participants used to anchor the topic.
 * @param question - Kira's missing fact; may name a specific player.
 * @param fetcher - Abortable HTTP function for testable GDELT metadata reads.
 * @param now - Research time; do not return articles indexed in the future.
 * @returns Discovered metadata only. Call further read tools for actual proof.
 */
export async function discoverAutonomousSportsSources(
  teams:{home:string;away:string},question:string,
  fetcher:typeof fetch=fetch,now=Date.now(),
):Promise<AutonomousNewsFinding>{
  const home=clean(teams.home,70),away=clean(teams.away,70)
  const issue=clean(question,110)
  if(home.length<3||away.length<3||issue.length<4)
    throw Error('Necesito los dos rivales reales y la pregunta deportiva a resolver')
  const endpoint=new URL('https://api.gdeltproject.org/api/v2/doc/doc')
  // Search for a distinct question in coverage of EITHER participant. Requiring
  // both team names would hide player-specific injury or lineup reports.
  endpoint.searchParams.set('query','('+quoted(home)+' OR '+quoted(away)+
    ') AND ('+issue+')')
  endpoint.searchParams.set('mode','ArtList')
  endpoint.searchParams.set('format','json')
  endpoint.searchParams.set('sort','DateDesc')
  endpoint.searchParams.set('timespan','7d')
  endpoint.searchParams.set('maxrecords','35')
  const target=endpoint.toString()
  const common={question:issue,queriedAt:new Date(now).toISOString(),
    queryUrl:target,source:'GDELT DOC 2.0' as const,
    limitation:'Índice de noticias, no artículos leídos. Ningún titular confirma '+
      'bajas, quintetos, QB, porteros, cuotas o resultado. Abrir y contrastar '+
      'la noticia original con otra fuente autorizada antes de decidir.'}
  try{
    const response=await fetcher(target,{headers:{Accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(9_000)})
    if(!response.ok)return{...common,status:'unavailable',articles:[],
      limitation:common.limitation+' HTTP '+response.status}
    const raw=await response.text()
    if(raw.length>600_000)throw Error('Índice excesivo')
    const parsed=JSON.parse(raw) as {articles?:unknown}
    if(!Array.isArray(parsed.articles))throw Error('Índice sin artículos')
    const encountered=new Set<string>()
    const articles:AutonomousNewsHit[]=[]
    for(const item of parsed.articles.slice(0,35)){
      if(!item||typeof item!=='object'||Array.isArray(item))continue
      const row=item as Record<string,unknown>
      const title=typeof row.title==='string'?clean(row.title,220):''
      const articleUrl=safeUrl(row.url)
      const indexedAt=seen(row.seendate)
      const publisher=typeof row.domain==='string'?clean(row.domain,90):''
      if(!articleUrl||!title||!publisher||!indexedAt||
        Date.parse(indexedAt)>now+60_000||Date.parse(indexedAt)<now-8*86_400_000||
        encountered.has(articleUrl))continue
      encountered.add(articleUrl)
      articles.push({title,publisher,articleUrl,indexedAt,
        status:'indexed-only',source:'GDELT DOC 2.0'})
      if(articles.length>=12)break
    }
    return{...common,status:articles.length?'observed':'empty',articles}
  }catch(error){
    return{...common,status:'unavailable',articles:[],
      limitation:common.limitation+' Error de índice: '+
        String(error instanceof Error?error.message:error).slice(0,140)}
  }
}

/** Research targets, NOT verified facts. This plan is used when the local
 * specialist or ESPN feed cannot close an important pregame question.
 * The assistant must open and corroborate articles with its available browser.
 */
export type IndependentResearchTarget={
  provider:string;url:string;purpose:string;status:'not-read'
}
export type IndependentResearchPlan={
  queries:string[];targets:IndependentResearchTarget[];
  mustOpenOriginals:true;fallbackRequired:true;
  evidenceRule:string
}
export function planIndependentSportsFallback(input:{
  home:string;away:string;league:string;date:string;question:string
}):IndependentResearchPlan{
  const home=clean(input.home,70),away=clean(input.away,70)
  const league=clean(input.league,30).toLowerCase()
  const date=/^\d{4}-\d{2}-\d{2}$/u.test(input.date)?input.date:''
  const question=clean(input.question,105)
  const topic=question||'lesiones titulares y disponibilidad'
  const queries=[
    '"'+home+'" "'+away+'" '+date+' '+topic+' official',
    '"'+home+'" '+date+' '+topic+' lineup',
    '"'+away+'" '+date+' '+topic+' lineup',
  ].map(x=>x.trim()).filter(x=>x.length>=8)
  const target=(provider:string,url:string,purpose:string):IndependentResearchTarget=>({
    provider,url,purpose,status:'not-read'
  })
  const targets:IndependentResearchTarget[]=[]
  if(league==='nhl'||league==='hockey'){
    targets.push(target('NHL oficial','https://www.nhl.com/news',
      'Parte oficial de lesiones; buscar por ambos equipos y fecha'))
    if(date>='2026-10-01'&&date<='2027-06-30')
      targets.push(target('NHL alineaciones',
        'https://www.nhl.com/news/nhl-lineup-projections-2026-27-season',
        'Artículo oficial 2026-27 con líneas, porteros y scratches; comprobar fecha y estado'))
    if(date)targets.push(target('Daily Faceoff',
      'https://www.dailyfaceoff.com/starting-goalies/'+date,
      'Comprobar confirmado versus probable, hora y fuente del portero'))
  }else if(league==='nba'||league==='basketball'){
    targets.push(target('NBA oficial','https://official.nba.com/',
      'Informe oficial de lesiones, verificando la fecha del PDF'))
    targets.push(target('NBA noticias','https://www.nba.com/news',
      'Actualizaciones de quintetos, baja y cuerpo técnico'))
  }else if(league==='wnba'){
    targets.push(target('WNBA oficial','https://www.wnba.com/',
      'Noticias, jugadoras disponibles y titulares de la competición'))
  }else if(league==='mlb'||league==='baseball'){
    targets.push(target('MLB alineaciones','https://www.mlb.com/starting-lineups',
      'Abridores y orden ofensivo; distinguir probable de confirmado'))
    targets.push(target('MLB noticias','https://www.mlb.com/news',
      'Reportes oficiales de lesión y bullpen'))
  }else if(league==='mens-college-basketball'||league==='ncaab'){
    targets.push(target('NCAA oficial','https://www.ncaa.com/scoreboard/basketball-men/d1',
      'Cruce universitario, fecha y acceso a equipos y lesiones'))
  }
  return {queries,targets,mustOpenOriginals:true,fallbackRequired:true,
    evidenceRule:'Los enlaces y consultas NO certifican hechos. Abrir páginas originales, '+
      'cotejar atleta, equipo, fecha, titularidad y segundo proveedor. '+
      'Un candidato o titular de prensa no es un confirmado. Si no se lee, mantener pendiente.'}
}
