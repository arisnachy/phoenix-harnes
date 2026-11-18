/** Independent, source-attributed matchup intelligence. Not a predictive model.
 * Public endpoints are undocumented and may become unavailable. Each part is
 * bounded, optional and fails closed instead of inventing news or lineups.
 */
import { getFeed,sportsCatalog } from './sports.ts'
type ObjectRow=Record<string,unknown>
const obj=(v:unknown):ObjectRow=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as ObjectRow:{}
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[]
const str=(v:unknown,max=120)=>typeof v==='string'?v.replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max):''
const digits=(v:unknown)=>/^\d{1,20}$/u.test(String(v??''))?String(v):''
const safe=/^[a-z0-9][a-z0-9._-]{0,79}$/u
const nameKey=(x:string)=>x.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase().replace(/[^a-z0-9]/gu,'')
const get=(v:unknown,key:string)=>obj(v)[key]
/** Only direct, HTTPS ESPN links/images, never arbitrary publisher HTML. */
const safeEspnUrl=(raw:unknown,image=false):string|null=>{
  if(typeof raw!=='string')return null
  try{
    const u=new URL(raw)
    const host=u.hostname.toLowerCase()
    if(u.protocol!=='https:'||u.username||u.password)return null
    if(image?!(host==='espncdn.com'||host.endsWith('.espncdn.com')||
      host==='espn.com'||host.endsWith('.espn.com')):
      !(host==='espn.com'||host.endsWith('.espn.com')||
        host==='espn.com.do'||host.endsWith('.espn.com.do')))return null
    return u.toString()
  }catch{return null}
}
const numeric=(n:unknown)=>{
  if(typeof n!=='number'&&typeof n!=='string')return null
  if(typeof n==='string'&&!n.trim())return null
  const val=Number(n)
  return Number.isFinite(val)?val:null
}
export type DeepSportsContext={
  eventId:string;sport:string;league:string;scannedAt:string
  sources:Array<{name:string;status:'verified'|'unavailable';records:number}>
  teams:Array<{id:string;name:string;abbreviation:string;rosterSample:string[]}>
  headlines:Array<{headline:string;published:string;source:'ESPN News';articleUrl?:string|null;imageUrl?:string|null}>
  injuries:Array<{team:string;athlete:string;status:string;source:'ESPN Injuries'}>
  playerStats:Array<{athlete:string;stat:string;value:string;source:'ESPN Boxscore'}>
  independentFixtureVerified:boolean
  venue?:{name:string;city:string}
  officials?:Array<{name:string;role:string}>
  weather?:{status:'verified'|'unavailable'|'not-applicable';description:string}
  limitations:string[]
}
const sourceNote=(name:string,available:boolean,records:number)=>({
  name,status:available?'verified' as const:'unavailable' as const,records,
})
/** ESPN summary + news + injuries + two verified rosters, plus NHL/MLB official
 * fixture cross-check when supported. No arbitrary URLs or unsourced players.
 */
export async function investigateEventDeep(
  sport:string,league:string,eventId:string,fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,
):Promise<DeepSportsContext>{
  if(!Object.hasOwn(sportsCatalog,sport)||!sportsCatalog[sport]?.includes(league)
    ||!safe.test(sport)||!safe.test(league)||!digits(eventId))
    throw Error('Deporte, liga o evento no verificable')
  if(env.PHOENIX_SPORTS_ESPN_DISABLED==='1')throw Error('ESPN deshabilitado')
  const root='https://site.api.espn.com/apis/site/v2/sports/'+sport+'/'+league+'/'
  const [summaryResult,newsResult,injuryResult]=await Promise.allSettled([
    getFeed<unknown>(root+'summary?event='+eventId,fetcher),
    getFeed<unknown>(root+'news?limit=30',fetcher),
    getFeed<unknown>(root+'injuries',fetcher),
  ])
  const summary=summaryResult.status==='fulfilled'?obj(summaryResult.value):{}
  const header=obj(summary.header)
  const comp=obj(arr(header.competitions)[0])
  const venueRow=obj(get(summary.gameInfo,'venue')??comp.venue)
  const venue={
    name:str(venueRow.fullName??venueRow.name,115),
    city:str(get(venueRow.address,'city')??venueRow.city,95),
  }
  const officialRows=arr(get(summary.gameInfo,'officials')).length?
    arr(get(summary.gameInfo,'officials')):arr(comp.officials)
  const officials=officialRows.slice(0,8).flatMap(raw=>{
    const row=obj(raw)
    const name=str(row.fullName??row.displayName??get(row.official,'displayName'),100)
    return name?[{name,role:str(row.position??row.role,65)}]:[]
  })
  const venuePoint=obj(venueRow.location)
  const latitude=numeric(venuePoint.latitude??venuePoint.lat??venueRow.latitude)
  const longitude=numeric(venuePoint.longitude??venuePoint.lon??
    venuePoint.lng??venueRow.longitude)
  const date=str(comp.date??header.date,40)
  const competitors=arr(comp.competitors)
  const teams=competitors.slice(0,2).map(team=>{
    const r=obj(team),t=obj(r.team),id=digits(t.id??r.id)
    return{id,name:str(t.displayName??t.name,110),
      abbreviation:str(t.abbreviation,8),rosterSample:[] as string[]}
  }).filter(t=>t.id&&t.name)
  const teamIDs=new Set(teams.map(t=>t.id))
  const rosterResults=await Promise.allSettled(teams.map(t=>
    getFeed<unknown>(root+'teams/'+t.id+'/roster',fetcher)))
  let rosterCount=0
  // Match the athlete ID (when supplied) AND the CURRENT roster under the
  // verified ESPN team ID. A league injury feed can retain old team membership.
  const verifiedAthletes=new Map<string,Set<string>>()
  const verifiedNames=new Map<string,Set<string>>()
  teams.forEach((team,i)=>{
    const rr=rosterResults[i]
    if(rr?.status!=='fulfilled')return
    const values=arr(get(rr.value,'athletes'))
    const athletes=values.flatMap(g=>{
      const nested=arr(get(g,'items'))
      return nested.length?nested:[g]
    })
    const names=athletes.map(a=>str(get(a,'displayName')??get(a,'name'),90))
      .filter(Boolean)
    verifiedAthletes.set(team.id,new Set(athletes.map(a=>digits(get(a,'id')??get(get(a,'athlete'),'id'))).filter(Boolean)))
    verifiedNames.set(team.id,new Set(names.map(nameKey)))
    team.rosterSample=names.slice(0,12)
    rosterCount+=names.length
  })
  const news=newsResult.status==='fulfilled'?arr(get(newsResult.value,'articles')):[]
  const mentions=teams.map(t=>nameKey(t.name))
  const headlineRows=news.flatMap(article=>{
    const a=obj(article),headline=str(a.headline,180),description=str(a.description,400)
    const text=nameKey(headline+' '+description)
    if(!headline||!mentions.some(team=>team&&text.includes(team)))return []
    return[{headline,published:str(a.published,45),source:'ESPN News' as const,
      articleUrl:safeEspnUrl(get(a.links,'web')?get(get(a.links,'web'),'href'):a.link),
      imageUrl:safeEspnUrl(get(arr(a.images)[0],'url')??get(arr(a.images)[0],'href'),true)}]
  }).slice(0,8)
  // Forecast only for a future, outdoor, coordinate-verified venue. Do not
  // geocode an ambiguous team city, apply an outside forecast to indoor games,
  // or claim historical conditions from the current forecast.
  let weather:{status:'verified'|'unavailable'|'not-applicable';description:string}={
    status:'unavailable',description:'Ubicación exacta y previsión de la hora sin cotejar'}
  const indoor=venueRow.indoor===true||sport==='basketball'||sport==='hockey'
  if(indoor){
    weather={status:'not-applicable',description:'Recinto cubierto; clima exterior no aplicado al modelo'}
  }else if(latitude!==null&&longitude!==null&&Math.abs(latitude)<=90&&
    Math.abs(longitude)<=180&&Number.isFinite(Date.parse(date))){
    const start=Date.parse(date)
    if(start>now&&start-now<=15*86_400_000){
      try{
        const wx=new URL('https://api.open-meteo.com/v1/forecast')
        wx.searchParams.set('latitude',latitude.toFixed(5))
        wx.searchParams.set('longitude',longitude.toFixed(5))
        wx.searchParams.set('hourly','temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability')
        wx.searchParams.set('forecast_days','16')
        wx.searchParams.set('timezone','UTC')
        const forecast=obj(await getFeed<unknown>(wx.toString(),fetcher))
        const hourly=obj(forecast.hourly)
        const times=arr(hourly.time).map(x=>str(x,20))
        const hour=new Date(start).toISOString().slice(0,13)
        const index=times.findIndex(x=>x.startsWith(hour))
        const temp=numeric(arr(hourly.temperature_2m)[index])
        const wind=numeric(arr(hourly.wind_speed_10m)[index])
        const rain=numeric(arr(hourly.precipitation_probability)[index])
        if(index>=0&&temp!==null&&wind!==null&&rain!==null){
          weather={status:'verified',
            description:'Pronóstico Open-Meteo para la sede y hora: '+
              temp.toFixed(1)+' °C; viento '+wind.toFixed(1)+
              ' km/h; prob. precipitación '+rain.toFixed(0)+'% (no observación real)'}
        }
      }catch{ /* Un fallo meteorológico nunca fabrica un pronóstico. */ }
    }
  }
  const injuryGroups=injuryResult.status==='fulfilled'
    ?arr(get(injuryResult.value,'injuries')):[]
  const injuryRows=injuryGroups.flatMap(group=>{
    const g=obj(group),team=obj(g.team),id=digits(team.id??g.id)
    const matched=teams.find(t=>t.id===id)
    if(!matched||!teamIDs.has(id))return []
    const items=arr(g.injuries).length?arr(g.injuries):arr(g.items)
    return items.flatMap(item=>{
      const v=obj(item),a=obj(v.athlete),athlete=str(a.displayName??v.displayName,90)
      const athleteId=digits(a.id??v.athleteId)
      const ids=verifiedAthletes.get(id),names=verifiedNames.get(id)
      // An athlete with a conflicting ID is NEVER accepted on a name match.
      const belongs=athleteId?ids?.has(athleteId)===true:
        athlete.length>0&&names?.has(nameKey(athlete))===true
      const status=str(v.status??v.type??v.description,110)
      return athlete&&status&&belongs?[{team:matched.name,athlete,status,source:'ESPN Injuries' as const}]:[]
    })
  }).slice(0,16)
  const boxscore=obj(summary.boxscore)
  const boxPlayers=arr(boxscore.players)
  const playerStats=boxPlayers.flatMap(group=>arr(get(group,'statistics')).flatMap(s=>{
    const row=obj(s),labels=arr(row.labels),athletes=arr(row.athletes)
    return athletes.slice(0,5).flatMap(a=>{
      const v=obj(a),athlete=str(get(v.athlete,'displayName'),95)
      const stats=arr(v.stats)
      return athlete&&labels.length>0&&stats.length>0?
        [{athlete,stat:str(labels[0],60),value:str(stats[0],40),
          source:'ESPN Boxscore' as const}]:[]
    })
  })).slice(0,12)
  let independentFixtureVerified=false
  let crossCheckStatus:'verified'|'unavailable'='unavailable'
  if(/^\d{4}-\d{2}-\d{2}/u.test(date)&&teams.length===2){
    const day=date.slice(0,10)
    try{
      if(sport==='hockey'&&league==='nhl'){
        const scores=await getFeed<unknown>('https://api-web.nhle.com/v1/score/'+day,fetcher)
        const teamCodes=teams.map(t=>t.abbreviation.toUpperCase())
        independentFixtureVerified=teamCodes.every(Boolean)&&
          arr(get(scores,'games')).some(game=>{
            const g=obj(game),h=str(get(g.homeTeam,'abbrev')),a=str(get(g.awayTeam,'abbrev'))
            return teamCodes.includes(h)&&teamCodes.includes(a)
          })
      }else if(sport==='baseball'&&league==='mlb'){
        const schedule=await getFeed<unknown>(
          'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date='+day+
          '&hydrate=probablePitcher',fetcher)
        const dates=arr(get(schedule,'dates'))
        independentFixtureVerified=dates.some(entry=>arr(get(entry,'games')).some(game=>{
          const t=obj(get(game,'teams'))
          const home=str(get(get(t.home,'team'),'name')),away=str(get(get(t.away,'team'),'name'))
          const actual=teams.map(team=>nameKey(team.name))
          return actual.includes(nameKey(home))&&actual.includes(nameKey(away))
        }))
      }
      crossCheckStatus=independentFixtureVerified?'verified':'unavailable'
    }catch{crossCheckStatus='unavailable'}
  }
  const sources=[
    sourceNote('ESPN match summary',summaryResult.status==='fulfilled'&&teams.length===2,teams.length),
    sourceNote('ESPN team rosters',rosterCount>0,rosterCount),
    sourceNote('ESPN league news tied to teams',headlineRows.length>0,headlineRows.length),
    sourceNote('ESPN injuries tied to confirmed team IDs',injuryRows.length>0,injuryRows.length),
    sourceNote('ESPN individual boxscore statistics',playerStats.length>0,playerStats.length),
    {name:sport==='hockey'?'NHL public API':sport==='baseball'?'MLB StatsAPI':
      'External league fixture cross-check not available',status:crossCheckStatus,records:independentFixtureVerified?1:0},
  ]
  return{eventId,sport,league,scannedAt:new Date(now).toISOString(),sources,teams,
    headlines:headlineRows,injuries:injuryRows,playerStats,independentFixtureVerified,
    venue,officials,weather,
    limitations:[
      'Un informe médico de liga vacío no demuestra que los jugadores estén sanos.',
      'Plantilla disponible no confirma titulares, minutos, portero titular ni alineación final.',
      'Noticias de equipo son contexto; deben cotejarse antes de atribuir una baja o impacto.',
      'Lesiones sin coincidencia con la plantilla actual del equipo se descartan; no se atribuyen por noticia ni solo por ID de equipo.',
      'Las estadísticas del boxscore son históricas; no predicen el próximo partido.',
      'Sin modelos calibrados ni precios de mercado verificables no hay probabilidad ni valor esperado comprobado.',
      'Árbitros nombrados no demuestran favoritismo; falta rendimiento histórico ajustado por equipos y contexto.',
      'Sede confirmada no implica que exista una estadística histórica local/visitante en ese estadio.',
    ]}
}
