/** Daily, bounded sports research prefetch. Facts are not bookmaker prices or
 * confirmed starters. Seven-day retention does not mean seven-day freshness.
 */
import {createHash} from 'node:crypto'
import {mkdir,readFile,readdir,rename,rm,open,writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join,resolve} from 'node:path'

export type DailyNeed={sport:string;required:string[]}
export const dailyResearchNeeds:readonly DailyNeed[]=[
  {sport:'NBA/WNBA',required:['fixture','pace/efficiency','recent form','back-to-back',
    'official injury report','confirmed starters','market and price']},
  {sport:'NHL',required:['fixture','goalie confirmations','xG 5v5/GSAx',
    'PP/PK','rest/travel','injuries/scratches','market with OT rules']},
  {sport:'MLB',required:['fixture','probable starters','bullpen last 72h','lineups',
    'batter/pitcher matchups','injuries','weather/park','market']},
  {sport:'NFL',required:['fixture','starting QB','OL vs pass rush','EPA/efficiency',
    'official inactives','weather','rest','market rules']},
  {sport:'Soccer',required:['fixture and home/away','xG/xGA','form','travel/rest',
    'confirmed XI','injuries/suspensions','draw risk','90-minute market']},
  {sport:'ATP/WTA',required:['fixture and surface','serve/return','last matches',
    'injuries','fatigue/travel','format','match-winner market']},
]
const dayPattern=/^\d{4}-\d{2}-\d{2}$/u
const validDay=(day:string)=>dayPattern.test(day)&&
  Number.isFinite(Date.parse(day+'T00:00:00Z'))&&
  new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day
export const santoDomingoDay=(now=Date.now())=>
  new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now))
const iso=(at:number)=>new Date(at).toISOString()
const digest=(input:string)=>createHash('sha256').update(input).digest('hex').slice(0,32)
const home=(env:NodeJS.ProcessEnv)=>resolve(env.PHOENIX_SPORTS_DAILY_RESEARCH_HOME?.trim()||
  join(homedir(),'.phoenix','sports-daily-research'))
type Kind='fixture'|'history'|'roster'|'injuries'|'stats'
type Cached={url:string;provider:string;kind:Kind;fetchedAt:number;expiresAt:number;body:string}
type Store={schema:1;day:string;needs:readonly DailyNeed[];entries:Record<string,Cached>}
type Budget={used:number;minute:number;minuteCount:number;cooldownUntil:number;
  observedRemaining:number|null}
type Budgets={schema:1;day:string;buckets:Record<string,Budget>}
export type DailyCacheSummary={date:string;checkedAt:string;retentionDays:7;
  needs:readonly DailyNeed[];sources:Array<{provider:string;kind:Kind;
    fetchedAt:string;fresh:boolean;url:string}>;fresh:number;stale:number;
  apiSports:Array<{api:string;consumed:number;budget:number;remainingLocal:number}>;
  note:string}
type Source={provider:string;kind:Kind;ttlMs:number;quota?:'football'|'hockey'|'nfl'|'bigballs'}
const classify=(url:URL):Source|null=>{
  const h=url.hostname,p=url.pathname
  if(h==='site.api.espn.com'&&p.startsWith('/apis/site/v2/sports/')&&
    (p.endsWith('/scoreboard')||p.endsWith('/summary')))
    return{provider:'ESPN',kind:'fixture',ttlMs:4*60_000}
  if(h==='statsapi.mlb.com'&&p==='/api/v1/schedule')
    return{provider:'MLB StatsAPI',kind:'fixture',ttlMs:10*60_000}
  if(h==='api-web.nhle.com'&&p.startsWith('/v1/score/'))
    return{provider:'NHL Web API',kind:'fixture',ttlMs:4*60_000}
  if(h==='www.thesportsdb.com'&&p.startsWith('/api/v1/json/123/')&&
    /(?:eventsday|searchplayers|lookupteam)\.php$/u.test(p))
    return{provider:'TheSportsDB',kind:p.includes('eventsday')?'fixture':'roster',
      ttlMs:p.includes('eventsday')?20*60_000:6*3_600_000}
  const api=h==='v3.football.api-sports.io'?'football':
    h==='v1.hockey.api-sports.io'?'hockey':
    h==='v1.american-football.api-sports.io'?'nfl':null
  if(api&&/^\/(?:fixtures|games|injuries|teams(?:\/statistics)?|players|standings)(?:\/|$)/u.test(p)){
    const kind:Kind=p.includes('injuries')?'injuries':
      /players|teams/u.test(p)?'roster':'fixture'
    return{provider:'API-Sports '+api,kind,
      ttlMs:kind==='injuries'?8*60_000:kind==='roster'?3*3_600_000:15*60_000,
      quota:api}
  }
  if(h==='api.bigballsdata.com'&&/^\/v1\/(?:matches|standings|injuries|nhl\/leaders)/u.test(p))
    return{provider:'Big Balls Sports Data',kind:p.includes('injuries')?'injuries':'stats',
      ttlMs:p.includes('injuries')?5*60_000:20*60_000,quota:'bigballs'}
  return null
}
const empty=(date:string):Store=>({schema:1,day:date,needs:dailyResearchNeeds,entries:{}})
const emptyBudgets=(day:string):Budgets=>({schema:1,day,buckets:{}})
async function read<T>(path:string,fallback:T):Promise<T>{
  try {return JSON.parse(await readFile(path,'utf8')) as T}
  catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')return fallback
    throw error
  }
}
async function atomic(path:string,data:unknown){
  const temp=path+'.'+process.pid+'.'+digest(String(Math.random()))+'.tmp'
  try{await writeFile(temp,JSON.stringify(data),{mode:0o600});await rename(temp,path)}
  finally{await rm(temp,{force:true}).catch(()=>undefined)}
}
async function lock<T>(root:string,action:()=>Promise<T>):Promise<T>{
  await mkdir(root,{recursive:true,mode:0o700})
  const path=join(root,'.write-lock')
  for(let attempt=0;attempt<24;attempt++){
    try{
      const handle=await open(path,'wx',0o600)
      try{return await action()}
      finally{await handle.close();await rm(path,{force:true})}
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error
      // A previous terminated process may leave an abandoned lock.
      if(attempt===12){
        const {stat}=await import('node:fs/promises')
        const info=await stat(path).catch(()=>null)
        if(info&&Date.now()-info.mtimeMs>30_000)
          await rm(path,{force:true}).catch(()=>undefined)
      }
      await new Promise(done=>setTimeout(done,50))
    }
  }
  throw Error('Caché deportivo ocupado; no se gastó cuota adicional')
}
async function purge(root:string,now:number){
  await mkdir(root,{recursive:true,mode:0o700})
  const files=await readdir(root)
  const cutoff=now-7*86_400_000
  await Promise.all(files.map(async file=>{
    const match=/^(?:research|quota)-(\d{4}-\d{2}-\d{2})\.json$/u.exec(file)
    if(match&&validDay(match[1]!)&&Date.parse(match[1]+'T00:00:00Z')<cutoff)
      await rm(join(root,file),{force:true})
  }))
}
const policy=(env:NodeJS.ProcessEnv,source:NonNullable<Source['quota']>)=>{
  const raw=source==='bigballs'?
    env.PHOENIX_SPORTS_BIGBALLS_DAY_BUDGET:env.PHOENIX_SPORTS_API_SPORTS_DAY_BUDGET
  const value=raw===undefined?(source==='bigballs'?200:80):Number(raw)
  if(!Number.isInteger(value)||value<1||value>(source==='bigballs'?1000:99))
    throw Error('Presupuesto API deportivo inválido')
  return{perDay:value,perMinute:source==='bigballs'?70:9}
}
const utcDay=(now:number)=>iso(now).slice(0,10)
async function quotaUpdate(root:string,day:string,key:string,
  source:NonNullable<Source['quota']>,env:NodeJS.ProcessEnv,now:number,
  response?:Response):Promise<void>{
  await lock(root,async()=>{
    const file=join(root,'quota-'+day+'.json')
    const data=await read(file,emptyBudgets(day))
    const entry=data.buckets[key]??{used:0,minute:-1,minuteCount:0,
      cooldownUntil:0,observedRemaining:null}
    const minute=Math.floor(now/60_000)
    if(entry.minute!==minute){entry.minute=minute;entry.minuteCount=0}
    if(!response){
      const max=policy(env,source)
      if(entry.cooldownUntil>now||entry.used>=max.perDay||
        entry.minuteCount>=max.perMinute||entry.observedRemaining===0)
        throw Error('Cuota reservada/agotada ('+source+'), utilizar fuente alternativa')
      entry.used++
      entry.minuteCount++
    }else{
      const remaining=response.headers.get('x-ratelimit-requests-remaining')
      if(remaining!==null&&/^\d+$/u.test(remaining))
        entry.observedRemaining=Number(remaining)
      if(response.status===429||response.status===403||response.status===401){
        const seconds=Number(response.headers.get('retry-after'))
        entry.cooldownUntil=now+(Number.isFinite(seconds)&&seconds>0?
          Math.min(30*60_000,seconds*1000):15*60_000)
      }
    }
    data.buckets[key]=entry
    await atomic(file,data)
  })
}
const active=new Map<string,Promise<Response>>()
function authFingerprint(init?:RequestInit):string{
  const headers=new Headers(init?.headers)
  const token=headers.get('x-apisports-key')||headers.get('authorization')||''
  return token?digest(token):'public'
}
async function cachedRequest(url:string,init:RequestInit|undefined,
  fetcher:typeof fetch,now:number,env:NodeJS.ProcessEnv):Promise<Response>{
  const parsed=new URL(url)
  const source=classify(parsed)
  if(!source||(init?.method&&init.method.toUpperCase()!=='GET'))
    return fetcher(url,init)
  const root=home(env),day=utcDay(now),key=digest(url+'|'+authFingerprint(init))
  await purge(root,now)
  const storeFile=join(root,'research-'+day+'.json')
  const previous=await read(storeFile,empty(day))
  const cached=previous.entries[key]
  if(cached&&cached.expiresAt>now){
    return new Response(cached.body,{status:200,headers:{'content-type':'application/json'}})
  }
  const operation=root+'|'+key
  const existing=active.get(operation)
  if(existing)return (await existing).clone()
  const task=(async()=>{
    const quota=source.quota
    const scope=quota?quota+'|'+authFingerprint(init):''
    if(quota){
      if(authFingerprint(init)==='public')
        throw Error('Falta credencial de '+source.provider)
      await quotaUpdate(root,day,scope,quota,env,now)
    }
    let response:Response
    try{response=await fetcher(url,init)}
    catch(error){throw error}
    if(quota)await quotaUpdate(root,day,scope,quota,env,now,response)
    if(!response.ok)return response
    const type=response.headers.get('content-type')??''
    // JSON payloads only; never persist HTML challenges, personal data or URLs with tokens.
    if(type&& !/json|text\/plain/iu.test(type))return response
    const body=await response.clone().text()
    if(Buffer.byteLength(body)>750_000)return response
    let data:unknown
    try{data=JSON.parse(body)}
    catch{return response}
    if(quota&&data&&typeof data==='object'&&
      Object.keys((data as {errors?:Record<string,unknown>}).errors??{}).length>0)
      return response
    await lock(root,async()=>{
      const latest=await read(storeFile,empty(day))
      latest.entries[key]={url,provider:source.provider,kind:source.kind,
        fetchedAt:now,expiresAt:now+source.ttlMs,body}
      // Hard cap: 750KB per reply and 10MB per day; evict oldest first.
      const ordered=Object.entries(latest.entries).sort((a,b)=>
        b[1].fetchedAt-a[1].fetchedAt)
      const bounded:Record<string,Cached>={}
      let bytes=0
      for(const [id,item] of ordered){
        const size=Buffer.byteLength(item.body)
        if(bytes+size>10_000_000)continue
        bounded[id]=item;bytes+=size
      }
      latest.entries=bounded
      await atomic(storeFile,latest)
    }).catch(()=>undefined) // Fetch success survives a noncritical cache write failure.
    return response
  })()
  active.set(operation,task)
  try{return (await task).clone()}
  finally{active.delete(operation)}
}
/** Shared transport for the ticket's pregame *research only*. Price discovery
 * continues through an uncached fetch to preserve bookmaker freshness.
 */
export function dailyResearchFetcher(fetcher:typeof fetch=fetch,
  env:NodeJS.ProcessEnv=process.env,clock:()=>number=Date.now):typeof fetch{
  return (input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url
    return cachedRequest(url,init,fetcher,clock(),env)
  }
}
type PrefetchTarget={provider:string;url:string;headers?:Record<string,string>;
  sport:string;kind:'free'|'quota'}
/** Known, bounded daily discovery. Never prefetch per-athlete/market/odds feeds. */
export function dailyPreloadTargets(date:string,env:NodeJS.ProcessEnv):PrefetchTarget[]{
  if(!validDay(date))throw Error('Fecha diaria inválida')
  const dt=date.replaceAll('-','')
  const list:PrefetchTarget[]=[
    ...[['basketball','nba'],['basketball','wnba'],['hockey','nhl'],
      ['football','nfl'],['baseball','mlb'],['soccer','eng.1'],
      ['soccer','esp.1'],['soccer','usa.1'],['soccer','mex.1'],
      ['tennis','atp'],['tennis','wta']].map(([s,l])=>({
        provider:'ESPN',sport:s!,kind:'free' as const,
        url:'https://site.api.espn.com/apis/site/v2/sports/'+s+'/'+l+
          '/scoreboard?dates='+dt,
      })),
    {provider:'NHL Web API',sport:'hockey',kind:'free',
      url:'https://api-web.nhle.com/v1/score/'+date},
    {provider:'MLB StatsAPI',sport:'baseball',kind:'free',
      url:'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date='+date},
    ...['Soccer','Ice Hockey','Basketball'].map(s=>({
      provider:'TheSportsDB',sport:s,kind:'free' as const,
      url:'https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d='+
        date+'&s='+encodeURIComponent(s),
    })),
  ]
  // Match the exact API-Football fixture URLs used by the specialist backup.
  // Four league-level reads use far fewer requests than one read per ticket leg.
  if(env.PHOENIX_API_FOOTBALL_KEY?.trim()){
    for(const [league,leagueId] of [['eng.1',39],['esp.1',140],
      ['usa.1',253],['mex.1',262]] as const){
      const year=Number(date.slice(0,4)),month=Number(date.slice(5,7))
      const season=['usa.1','mex.1'].includes(league)?year:
        year-(month<7?1:0)
      list.push({provider:'API-Sports Football',sport:'soccer',kind:'quota',
        url:'https://v3.football.api-sports.io/fixtures?league='+leagueId+
          '&season='+season+'&date='+date,
        headers:{'x-apisports-key':env.PHOENIX_API_FOOTBALL_KEY!}})
    }
  }
  for(const [key,provider,sport,url] of [
    ['PHOENIX_API_HOCKEY_KEY','API-Sports Hockey','hockey',
      'https://v1.hockey.api-sports.io/games?date='+date],
    ['PHOENIX_API_NFL_KEY','API-Sports NFL','football',
      'https://v1.american-football.api-sports.io/games?date='+date],
  ] as const){
    if(env[key]?.trim())list.push({provider,sport,kind:'quota',url,
      headers:{'x-apisports-key':env[key]!}})
  }
  if(env.PHOENIX_BIGBALLS_API_KEY?.trim())
    list.push({provider:'Big Balls Sports Data',sport:'hockey',kind:'quota',
      url:'https://api.bigballsdata.com/v1/matches?sport=ice_hockey&league=nhl&limit=30',
      headers:{Authorization:'Bearer '+env.PHOENIX_BIGBALLS_API_KEY}})
  return list
}
export type DailyPreloadResult={date:string;checkedAt:string;attempted:number;
  fresh:number;failed:number;rows:Array<{provider:string;sport:string;
    status:'cached'|'empty'|'unavailable';detail:string}>;cache:DailyCacheSummary}
/** Performs preflight in small batches. One HTTP call per whitelisted route;
 * server-only credential headers, no bookmaker prices or live lineups.
 */
export async function preloadDailyResearch(date:string,
  env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch,
  now=Date.now()):Promise<DailyPreloadResult>{
  const plan=dailyPreloadTargets(date,env)
  const cached=dailyResearchFetcher(fetcher,env,()=>now)
  const rows:DailyPreloadResult['rows']=[]
  for(let i=0;i<plan.length;i+=3){
    const group=await Promise.all(plan.slice(i,i+3).map(async target=>{
      try{
        const res=await cached(target.url,{headers:target.headers,
          signal:AbortSignal.timeout(8_000)})
        if(!res.ok)throw Error('HTTP '+res.status)
        const json=await res.json() as {events?:unknown[];dates?:unknown[];
          games?:unknown[];response?:unknown[];data?:unknown[]}
        const events=Array.isArray(json.events)?json.events:
          Array.isArray(json.response)?json.response:
          Array.isArray(json.games)?json.games:
          Array.isArray(json.data)?json.data:
          Array.isArray(json.dates)?json.dates:[]
        return{provider:target.provider,sport:target.sport,
          status:(events.length?'cached':'empty') as 'cached'|'empty',
          detail:events.length+' registros; calendario/estadísticas, NO titulares o cuotas'}
      }catch(e){return{provider:target.provider,sport:target.sport,
        status:'unavailable' as const,detail:(e instanceof Error?e.message:String(e)).slice(0,110)}}
    }))
    rows.push(...group)
  }
  const cache=await dailyResearchStatus(date,env,now)
  return{date,checkedAt:iso(now),attempted:plan.length,
    fresh:rows.filter(x=>x.status==='cached').length,
    failed:rows.filter(x=>x.status==='unavailable').length,rows,cache}
}
export async function dailyResearchStatus(date:string,
  env:NodeJS.ProcessEnv=process.env,now=Date.now()):Promise<DailyCacheSummary>{
  if(!validDay(date))throw Error('Fecha diaria inválida')
  const root=home(env),day=utcDay(now)
  await purge(root,now)
  const data=await read(join(root,'research-'+day+'.json'),empty(day))
  const quotas=await read(join(root,'quota-'+day+'.json'),emptyBudgets(day))
  const entries=Object.values(data.entries).filter(x=>x&&typeof x.url==='string')
  const sources=entries.map(x=>({provider:x.provider,kind:x.kind,
    fetchedAt:iso(x.fetchedAt),fresh:x.expiresAt>now,url:x.url}))
  const totals:Record<string,number>={}
  for(const [key,row] of Object.entries(quotas.buckets)){
    const group=key.split('|')[0]!
    totals[group]=Math.max(totals[group]??0,row.used)
  }
  return{date,checkedAt:iso(now),retentionDays:7,needs:dailyResearchNeeds,
    sources,fresh:sources.filter(x=>x.fresh).length,
    stale:sources.filter(x=>!x.fresh).length,
    apiSports:Object.entries(totals).map(([api,consumed])=>{
      const budget=policy(env,api==='bigballs'?'bigballs':'football').perDay
      return{api,consumed,budget,remainingLocal:Math.max(0,budget-consumed)}
    }),
    note:'Cache conserva como máximo siete días, pero cada dato tiene vencimiento '+
      'de minutos u horas. No guarda cuotas apostables. Fuentes adicionales pueden '+
      'consultarse libremente según permisos, límites y disponibilidad.'}
}
