/**
 * Provider-specific PUBLIC website reconnaissance, not bookmaker quote ingestion.
 * Read-only, fixed URL allowlist; no browser stealth, login, CAPTCHA bypass,
 * dynamic client scripts, region spoofing or arbitrary user-provided URLs.
 * ESPN may challenge automated clients; that is reported as blocked.
 */
export type PublicOddsProvider='ESPN'|'Oddschecker'|'ScoresAndOdds'
export type PageStatus='observed-team-mentions'|'page-accessible'|'not-found'|'blocked'|'unavailable'
export type OddsPageObservation={
  provider:PublicOddsProvider;url:string;status:PageStatus
  checkedAt:string;pageObservedAt:string;quoteUpdatedAt:null
  bookmakerVerified:false;eventVerified:false;priced:false
  htmlTitle:string|null;snippet:string|null
  markets:string[];detail:string
}
export type PublicOddsWebsiteReport={
  sportKey:string;requestedDate:string;home:string|null;away:string|null
  pages:OddsPageObservation[]
  bookmakerQuotes:number;bookmakerVerified:false
  warning:string
}
type Page={provider:PublicOddsProvider;url:string}
const sportsPages:Readonly<Record<string,string>>={
  basketball_nba:'nba',basketball_wnba:'wnba',
  americanfootball_nfl:'nfl',baseball_mlb:'mlb',icehockey_nhl:'nhl',
}
const soccerPages:Readonly<Record<string,string>>={
  soccer_epl:'premier-league',soccer_spain_la_liga:'la-liga-primera',
  soccer_mexico_ligamx:'mexican-primera-division',soccer_usa_mls:'mls',
  soccer_uefa_champs_league:'uefa-champions-league',
  soccer_italy_serie_a:'serie-a',soccer_germany_bundesliga:'bundesliga',
}
const validDay=(day:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(day)
  &&Number.isFinite(Date.parse(day+'T00:00:00Z'))
  &&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day
const today=(now:number)=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date(now))
/** Fixed, manually checked public navigation entry points; no string URL interpolation. */
export function publicOddsWebsitePages(sportKey:string):Page[]{
  if(!/^[a-z0-9_]{3,75}$/u.test(sportKey))throw Error('Liga no válida')
  const routes:Page[]=[{provider:'ESPN',url:'https://www.espn.com/sports-betting/odds'}]
  if(sportsPages[sportKey])routes.push({
    provider:'ESPN',url:'https://www.espn.com/'+sportsPages[sportKey]+'/odds',
  })
  const northAmerica=sportsPages[sportKey]
  if(northAmerica)routes.push({
    provider:'ScoresAndOdds',url:'https://www.scoresandodds.com/'+northAmerica+'/odds',
  })
  if(sportKey.startsWith('soccer_')){
    const slug=soccerPages[sportKey]
    routes.push({provider:'Oddschecker',url:'https://www.oddschecker.com/us/soccer'+
      (slug?'/'+slug:'')})
  }
  return routes
}
const decode=(text:string)=>text.replace(/&#(?:x([0-9a-f]+)|([0-9]+));|&(amp|lt|gt|quot|apos|nbsp);/giu,
  (raw:string,hex:string|undefined,dec:string|undefined,entity:string|undefined)=>{
    if(entity)return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '} as Record<string,string>)[entity.toLowerCase()]??raw
    const n=parseInt(hex??dec??'',hex?16:10)
    return Number.isFinite(n)&&n>=32&&n<=0x10ffff?String.fromCodePoint(n):' '
  })
const clean=(html:string):string=>decode(html
  .replace(/<(?:script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|svg|noscript)>/giu,' ')
  .replace(/<[^>]{0,3000}>/gu,' ').replace(/\s+/gu,' ').trim())
const norm=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9 ]/gu,' ').replace(/\s+/gu,' ').trim()
const significant=(v:string)=>{
  const all=norm(v).split(' ').filter(Boolean)
  // Full names are preferred; fallback nicknames must be distinctive.
  const last=all.at(-1)??''
  return [...new Set([norm(v),...(last.length>=5?[last]:[])])].filter(x=>x.length>=5)
}
export function websiteTeamExcerpt(visible:string,home:string,away:string):string|null{
  const display=visible.replace(/\s+/gu,' ').trim()
  const lowered=norm(display)
  const candidatesA=significant(home),candidatesB=significant(away)
  if(!candidatesA.length||!candidatesB.length)return null
  // Search within a small window; a generic mention elsewhere on the page
  // MUST NOT become a verified fixture. Text is only a research excerpt.
  for(const a of candidatesA){
    let index=lowered.indexOf(a)
    while(index!==-1){
      for(const b of candidatesB){
        const start=Math.max(0,index-650),end=Math.min(lowered.length,index+900)
        const peer=lowered.slice(start,end).indexOf(b)
        if(peer!==-1){
          return display.slice(Math.max(0,index-120),Math.min(display.length,index+580))
            .slice(0,700)
        }
      }
      index=lowered.indexOf(a,index+Math.max(1,a.length))
    }
  }
  return null
}
const isBlocked=(html:string)=>/just a moment|verify that you(?:\s+are|['’]re) not a robot|are you a human|captcha|cloudflare challenge|enable javascript and then reload the page/iu.test(html)
  ||(/<title[^>]*>[^<]*access denied/iu.test(html))
const hosts:Readonly<Record<PublicOddsProvider,string>>={
  ESPN:'www.espn.com',Oddschecker:'www.oddschecker.com',
  ScoresAndOdds:'www.scoresandodds.com',
}
const cache=new Map<string,{expires:number;work:Promise<OddsPageObservation>}>()
export async function readPublicOddsWebsitePage(
  page:Page,home:string|null,away:string|null,fetcher:typeof fetch=fetch,now=Date.now(),
):Promise<OddsPageObservation>{
  const uri=new URL(page.url)
  if(uri.protocol!=='https:'||uri.hostname!==hosts[page.provider]||uri.port||
    uri.username||uri.password||uri.search||uri.hash||uri.pathname.length>140)
    throw Error('Página de cuotas no autorizada')
  const checkedAt=new Date(now).toISOString()
  const base={provider:page.provider,url:uri.toString(),checkedAt,pageObservedAt:checkedAt,
    quoteUpdatedAt:null,bookmakerVerified:false as const,eventVerified:false as const,priced:false as const}
  const work=async():Promise<OddsPageObservation>=>{
    try{
      const response=await fetcher(uri.toString(),{headers:{accept:'text/html'},
        redirect:'error',signal:AbortSignal.timeout(7000)})
      if([401,403,429].includes(response.status))
        return {...base,status:'blocked',htmlTitle:null,snippet:null,markets:[],
          detail:'Acceso restringido HTTP '+response.status+'; no intentar eludir protecciones'}
      if(!response.ok)throw Error('HTTP '+response.status)
      const kind=response.headers.get('content-type')??''
      if(!/text\/html|application\/xhtml\+xml/iu.test(kind))
        throw Error('La página no devolvió HTML público verificable')
      if(Number(response.headers.get('content-length')??0)>1_500_000)
        throw Error('Página demasiado grande')
      const html=await response.text()
      if(html.length>1_500_000)throw Error('Página demasiado grande')
      if(isBlocked(html))return {...base,status:'blocked',htmlTitle:null,snippet:null,
        markets:[],detail:'Verificación humana/JavaScript requerida; usar navegación autorizada'}
      const titleMatch=/<title[^>]*>([\s\S]{0,200}?)<\/title>/iu.exec(html)
      const htmlTitle=titleMatch?clean(titleMatch[1]!).slice(0,120):null
      const visible=clean(html).slice(0,400_000)
      if(visible.length<80)throw Error('HTML sin texto utilizable; quizá renderizado dinámico')
      const excerpt=home&&away?websiteTeamExcerpt(visible,home,away):null
      const terms=['moneyline','spread','total','1x2','draw','handicap','over/under']
        .filter(x=>new RegExp('\\b'+x.replace('/','\\/')+'\\b','iu').test(visible)).slice(0,7)
      const status:PageStatus=excerpt?'observed-team-mentions':home&&away?'not-found':'page-accessible'
      return {...base,status,htmlTitle,snippet:excerpt,markets:terms,
        detail:excerpt?'Ambos equipos mencionados cerca en HTML; horario, mercado, precio, casa y vigencia NO confirmados':
          home&&away?'No aparecen ambos equipos cercanos; no prueba que el evento no exista':
            'Sitio accesible; ninguna oferta individual de casa ha sido comprobada'}
    }catch(error){
      return {...base,status:'unavailable',htmlTitle:null,snippet:null,markets:[],
        detail:'Acceso no confirmado: '+String(error instanceof Error?error.message:error).slice(0,160)}
    }
  }
  if(fetcher!==fetch)return work()
  // The same league page can be queried for different fixtures. Never reuse
  // a previous team's excerpt as evidence for another matchup.
  const cacheKey=[uri.toString(),norm(home??''),norm(away??'')].join('|')
  const cached=cache.get(cacheKey)
  if(cached&&cached.expires>now)return cached.work
  if(cache.size>30)cache.clear()
  const value=work()
  cache.set(cacheKey,{expires:now+5*60_000,work:value})
  return value
}
export async function researchPublicOddsWebsites(input:{
  sportKey:string;date?:string;home?:string;away?:string
},fetcher:typeof fetch=fetch,now=Date.now()):Promise<PublicOddsWebsiteReport>{
  const date=input.date??today(now)
  if(!validDay(date))throw Error('Fecha inválida')
  const home=input.home?.trim()??null,away=input.away?.trim()??null
  if(Boolean(home)!==Boolean(away))throw Error('Se necesitan ambos equipos para cotejar')
  if((home&&home.length>85)||(away&&away.length>85))throw Error('Nombre de equipo demasiado largo')
  const pages=publicOddsWebsitePages(input.sportKey)
  const reports=await Promise.all(pages.map(page=>
    readPublicOddsWebsitePage(page,home,away,fetcher,now)))
  return {sportKey:input.sportKey,requestedDate:date,home,away,pages:reports,
    bookmakerQuotes:0,bookmakerVerified:false,
    warning:'Las páginas son referencias de investigación, NO cotizaciones elegibles. Ninguna cifra de HTML se transforma en cuota sin identidad de ambos equipos, fecha/hora del evento, casa, mercado, período, precio y marca temporal de la casa. No eludir geobloqueos, CAPTCHA ni paywalls. Ante falta de precios, presentar borrador CONDICIONAL y finalizar la respuesta, sin repetir notas de progreso.'}
}
