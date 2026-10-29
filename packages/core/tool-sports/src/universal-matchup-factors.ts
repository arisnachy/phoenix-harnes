/** Universal, evidence-first matchup factors. Descriptive evidence is not a calibrated prediction.
 * All provider paths are fixed-host/validated; missing data never becomes a favorable signal.
 */
import { getFeed, hasSportsPermission, sportsCatalog, discoverEspnLeagues, marketOdds } from './sports.ts'
import { investigateEventDeep } from './sports-deep-context.ts'
import { compareBettingMarkets } from './sports-market-intelligence.ts'

type Obj=Record<string,unknown>
const obj=(x:unknown):Obj=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Obj:{}
const list=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const str=(x:unknown,max=110):string=>typeof x==='string'||typeof x==='number'?
  String(x).replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max):''
const id=(x:unknown):string=>/^\d{1,18}$/u.test(String(x??''))?String(x):''
const num=(x:unknown):number|null=>{
  if(typeof x!=='number'&&typeof x!=='string')return null
  const s=String(x)
  return /^\d{1,4}(?:\.\d+)?$/u.test(s)&&Number.isFinite(Number(s))?Number(s):null
}
const geo=(value:unknown,max:number):number|null=>{
  if(typeof value!=='number'&&typeof value!=='string')return null
  const n=Number(value)
  return String(value).trim()!==''&&Number.isFinite(n)&&Math.abs(n)<=max?n:null
}
const validDate=(date:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(date)&&
  Number.isFinite(Date.parse(date+'T00:00:00Z'))&&
  new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date
const norm=(x:string)=>x.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const mean=(vals:number[]):number|null=>vals.length?
  Number((vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2)):null
const round=(x:number)=>Number(x.toFixed(2))
type Side={id:string;name:string;homeAway:string;score:number|null;lines:number[]|null}
type Game={id:string;date:string;state:string;venueId:string;venueName:string;
  latitude:number|null;longitude:number|null;roof:string;home:Side;away:Side}
type RecordGame={id:string;date:string;opponent:string;scored:number;allowed:number;
  homeAway:string;venueId:string;inningsFor:number[]|null;inningsAgainst:number[]|null}
export type UniversalMatchupInput={
  sport:string;league:string;eventId:string;date:string;lookbackDays?:number;includeOdds?:boolean
}
type Fact={label:string;value?:string;detail?:string}
type Section={heading:string;kind:'metrics'|'list'|'articles';items:Fact[]}
type Coverage={source:string;status:'verified'|'unavailable';records:number}
const side=(x:unknown):Side=>{
  const c=obj(x),team=obj(c.team)
  const innings=list(c.linescores).map(z=>num(obj(z).value??obj(z).displayValue))
  return {id:id(team.id??c.id),name:str(team.displayName??team.name,120),
    homeAway:str(c.homeAway,10),score:num(c.score),
    lines:innings.length&&innings.every(n=>n!==null)?innings as number[]:null}
}
function game(x:unknown):Game|null{
  const r=obj(x),comp=obj(list(r.competitions)[0]),competitors=list(comp.competitors)
  const home=side(competitors.find(c=>obj(c).homeAway==='home'))
  const away=side(competitors.find(c=>obj(c).homeAway==='away'))
  const key=id(r.id),date=str(r.date??comp.date,40)
  if(!key||!home.id||!away.id||home.id===away.id||!Number.isFinite(Date.parse(date)))return null
  const venue=obj(comp.venue),coordinates=obj(venue.coordinates),location=obj(venue.location)
  return {id:key,date,state:str(obj(obj(r.status).type).state,15),
    venueId:id(venue.id),venueName:str(venue.fullName,100),
    latitude:geo(coordinates.latitude??coordinates.lat??location.latitude??location.lat,90),
    longitude:geo(coordinates.longitude??coordinates.long??location.longitude??location.lon,180),
    roof:str(venue.roofType??venue.roof,60),home,away}
}
const recent=(games:Game[],teamId:string,start:number):RecordGame[]=>games.flatMap(g=>{
  if(g.state!=='post'||Date.parse(g.date)>=start)return []
  const mine=g.home.id===teamId?g.home:g.away.id===teamId?g.away:null
  const other=mine===g.home?g.away:g.home
  return mine&&mine.score!==null&&other.score!==null?[{
    id:g.id,date:g.date,opponent:other.name,scored:mine.score,allowed:other.score,
    homeAway:mine.homeAway,venueId:g.venueId,
    inningsFor:mine.lines,inningsAgainst:other.lines,
  }]:[]
}).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,10)
const summary=(rows:RecordGame[])=>({
  games:rows.length,wins:rows.filter(r=>r.scored>r.allowed).length,
  losses:rows.filter(r=>r.scored<r.allowed).length,
  draws:rows.filter(r=>r.scored===r.allowed).length,
  scoredPerGame:mean(rows.map(r=>r.scored)),allowedPerGame:mean(rows.map(r=>r.allowed)),
  margin:mean(rows.map(r=>r.scored-r.allowed)),
})
const inningAverage=(records:RecordGame[],period:number,kind:'inningsFor'|'inningsAgainst')=>{
  const values=records.flatMap(r=>r[kind]&&r[kind].length>=period?
    [r[kind].slice(0,period).reduce((a,b)=>a+b,0)]:[])
  return {games:values.length,average:mean(values)}
}
const matchupTypes:Record<string,string[]>={
  baseball:['Abridor oficial y sus últimas salidas','Uso y fatiga del bullpen','Alineación confirmada','Factor del parque y viento'],
  basketball:['Minutos y rotaciones confirmadas','Eficiencia ajustada por rival','Lesiones y carga de partidos','Ritmo y eficiencia de posesiones'],
  football:['QB y lesiones de línea','Presión y protección','Eficiencia por jugada','Viento y precipitaciones'],
  hockey:['Portero confirmado y forma reciente','Expected goals, tiros y calidad','Special teams y descanso'],
  soccer:['Once confirmado','xG y xGA ajustados','Estilo, calendario y localía','Doble oportunidad y mercados de goles'],
  tennis:['Superficie y adaptación','Puntos de servicio y devolución','Fatiga y antecedentes en esa superficie'],
  mma:['Estilos de combate y alcance','Lesiones y pesaje','Rondas y método de victoria'],
}
const marketKey:Record<string,string>={
  'baseball|mlb':'baseball_mlb','basketball|nba':'basketball_nba','basketball|wnba':'basketball_wnba',
  'football|nfl':'americanfootball_nfl','hockey|nhl':'icehockey_nhl',
  'soccer|eng.1':'soccer_epl','soccer|esp.1':'soccer_spain_la_liga',
  'soccer|mex.1':'soccer_mexico_ligamx','soccer|usa.1':'soccer_usa_mls',
}
const stat=(label:string,value:unknown,detail?:string):Fact=>({
  label,value:value===null||value===undefined?'No disponible':String(value),
  ...(detail?{detail}:{}),
})
/** Investigate a verified event across recent results, head-to-head, venue, period splits,
 * roster/news/injury context and strictly joined bookmaker quotes when accessible.
 * No probability of winning, EV or bet edge is calculated without calibrated models.
 */
export async function auditUniversalMatchup(
  input:UniversalMatchupInput,fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,
){
  if(!Object.hasOwn(sportsCatalog,input.sport)
     ||!/^[a-z][a-z-]{1,35}$/u.test(input.sport)
     ||!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(input.league)
     ||!id(input.eventId)||!validDate(input.date))throw Error('Deporte, liga, evento o fecha inválidos')
  const days=input.lookbackDays??14
  if(!Number.isInteger(days)||days<3||days>28)throw Error('Historial: entre 3 y 28 días')
  if(!hasSportsPermission('espn',env))throw Error('ESPN está deshabilitado')
  if(!sportsCatalog[input.sport]?.includes(input.league)
    &&!(await discoverEspnLeagues(input.sport,env,fetcher)).includes(input.league))
    throw Error('Liga no confirmada por ESPN')
  const root='https://site.api.espn.com/apis/site/v2/sports/'+input.sport+'/'+input.league+'/'
  const scoreboard=(day:string)=>getFeed<{events?:unknown[]}>(root+'scoreboard?dates='+day.replaceAll('-',''),fetcher)
  const today=await scoreboard(input.date)
  const current=list(today.events).map(game).find(g=>g?.id===input.eventId)
  if(!current)throw Error('El ID de partido no coincide con la cartelera ESPN del día')
  const kickoff=Date.parse(current.date)
  const anchor=Date.parse(input.date+'T12:00:00Z')
  const historicalDays=Array.from({length:days},(_,i)=>
    new Date(anchor-(i+1)*86_400_000).toISOString().slice(0,10))
  const forecastRequest=current.latitude!==null&&current.longitude!==null&&
    current.state==='pre'&&kickoff>=now&&kickoff-now<15*86_400_000&&
    env.PHOENIX_SPORTS_WEATHER_DISABLED!=='1'?
    getFeed<unknown>('https://api.open-meteo.com/v1/forecast?latitude='+current.latitude+
      '&longitude='+current.longitude+
      '&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,is_day,precipitation_probability'+
      '&timezone=UTC&forecast_days=16',fetcher).catch(()=>null):Promise.resolve(null)
  const [history,context,mlbSchedule,odds,weatherData]=await Promise.all([
    Promise.allSettled(historicalDays.map(scoreboard)),
    investigateEventDeep(input.sport,input.league,input.eventId,fetcher,now,env)
      .then(value=>value).catch(()=>null),
    input.sport==='baseball'&&input.league==='mlb'&&hasSportsPermission('mlb',env)?
      getFeed<unknown>('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date='+
        input.date+'&hydrate=probablePitcher',fetcher).catch(()=>null):Promise.resolve(null),
    input.includeOdds!==false&&marketKey[input.sport+'|'+input.league]?
      marketOdds(marketKey[input.sport+'|'+input.league]!,
        'h2h,totals,spreads',env,fetcher).catch(()=>[]):Promise.resolve([]),
    forecastRequest,
  ])
  const hours=obj(obj(weatherData).hourly)
  const times=list(hours.time)
  const ix=times.findIndex(t=>typeof t==='string'&&
    Math.abs(Date.parse(t.endsWith('Z')?t:t+'Z')-kickoff)<=1_800_000)
  const weather=ix>=0?{
    source:'Open-Meteo · modelo de pronóstico (CC BY 4.0)',
    validAt:String(times[ix])+'Z',
    temperatureC:geo(list(hours.temperature_2m)[ix],100),
    windKmh:geo(list(hours.wind_speed_10m)[ix],300),
    windDirectionDeg:geo(list(hours.wind_direction_10m)[ix],360),
    precipitationProbability:geo(list(hours.precipitation_probability)[ix],100),
    dayNight:list(hours.is_day)[ix]===1?'Día':list(hours.is_day)[ix]===0?'Noche':'Sin verificar',
    note:'Pronóstico aproximado en coordenadas verificadas; no demuestra ventaja ofensiva ni dirección respecto del campo.',
  }:null
  const stored=new Map<string,Game>()
  history.forEach(job=>{
    if(job.status!=='fulfilled')return
    for(const raw of list(job.value.events)){
      const parsed=game(raw)
      if(parsed&&parsed.state==='post'&&Date.parse(parsed.date)<kickoff)
        stored.set(parsed.id,parsed)
    }
  })
  const all=[...stored.values()]
  const home=recent(all,current.home.id,kickoff),away=recent(all,current.away.id,kickoff)
  const homeForm=summary(home),awayForm=summary(away)
  const h2h=all.filter(g=>g.home.id===current.home.id&&g.away.id===current.away.id||
    g.home.id===current.away.id&&g.away.id===current.home.id)
    .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,5)
  const venueGames=current.venueId?
    {home:home.filter(r=>r.venueId===current.venueId),
      away:away.filter(r=>r.venueId===current.venueId)}:null
  const periods=input.sport==='baseball'?[3,5,9].map(innings=>{
    const hf=inningAverage(home,innings,'inningsFor')
    const ha=inningAverage(home,innings,'inningsAgainst')
    const af=inningAverage(away,innings,'inningsFor')
    const aa=inningAverage(away,innings,'inningsAgainst')
    const sufficient=[hf,ha,af,aa].every(v=>v.games>=3&&v.average!==null)
    return {innings,homeScored:hf,homeAllowed:ha,awayScored:af,awayAllowed:aa,
      exploratoryTotal:sufficient?round(((hf.average!+aa.average!)/2)+
        ((af.average!+ha.average!)/2)):null,
      interpretation:sufficient?'Media simple de ataque/defensa en muestras históricas; NO pronóstico calibrado':
        'Sin al menos tres juegos completos por equipo y período',
    }
  }):[]
  const matchOfficial=(name:string,other:string)=>norm(name)===norm(other)
  const mlbGames=list(obj(mlbSchedule).dates).flatMap(d=>list(obj(d).games))
  const scheduleGame=mlbGames.find(entry=>{
    const teams=obj(obj(entry).teams)
    const h=str(obj(obj(teams.home).team).name),a=str(obj(obj(teams.away).team).name)
    return matchOfficial(h,current.home.name)&&matchOfficial(a,current.away.name)
  })
  const mlbTeams=obj(obj(scheduleGame).teams)
  const pitcherRows=[{side:'Local',record:obj(mlbTeams.home)},{side:'Visitante',record:obj(mlbTeams.away)}]
    .flatMap(x=>{
      const p=obj(x.record.probablePitcher)
      return id(p.id)&&str(p.fullName)?[{team:x.side,id:id(p.id),name:str(p.fullName)}]:[]
    })
  const logs=await Promise.allSettled(pitcherRows.map(async p=>{
    const season=input.date.slice(0,4)
    const response=await getFeed<unknown>('https://statsapi.mlb.com/api/v1/people/'+p.id+
      '/stats?stats=gameLog&group=pitching&season='+season,fetcher)
    const splits=list(obj(list(obj(response).stats)[0]).splits)
    const outings=splits.flatMap(s=>{
      const st=obj(obj(s).stat),day=str(obj(s).date,25)
      const isStart=num(st.gamesStarted)===1
      const earned=num(st.earnedRuns),outs=str(st.inningsPitched,12)
      return isStart&&validDate(day)&&day<input.date&&earned!==null?
        [{date:day,earnedRuns:earned,inningsPitched:outs,strikeouts:num(st.strikeOuts)}]:[]
    }).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5)
    return {...p,outings}
  }))
  const starters=logs.flatMap((v,i)=>v.status==='fulfilled'?[v.value]:
    pitcherRows[i]?[{...pitcherRows[i]!,outings:[]}]:[])
  const key=marketKey[input.sport+'|'+input.league]
  const matchingOdds=odds.filter(q=>
    norm(q.home)===norm(current.home.name)&&norm(q.away)===norm(current.away.name)&&
    Number.isFinite(Date.parse(q.timeIso??q.time))&&
    Math.abs(Date.parse(q.timeIso??q.time)-kickoff)<4*3_600_000)
  const markets=compareBettingMarkets(matchingOdds,now).markets.slice(0,7)
  const availability:Coverage[]=[
    {source:'ESPN: cartelera y equipos',status:'verified',records:1},
    {source:'ESPN: históricos diarios',status:history.some(h=>h.status==='fulfilled')?'verified':'unavailable',
      records:history.filter(h=>h.status==='fulfilled').length},
    {source:'ESPN: enfrentamientos directos',status:h2h.length?'verified':'unavailable',records:h2h.length},
    {source:'ESPN: sede identificada',status:current.venueId?'verified':'unavailable',records:current.venueId?1:0},
    {source:'Open-Meteo: pronóstico próximo con coordenadas del estadio',
      status:weather?'verified':'unavailable',records:weather?1:0},
    {source:'ESPN: contexto de lesiones, plantillas y noticias',
      status:context?'verified':'unavailable',records:context?.sources.filter(s=>s.status==='verified').length??0},
    {source:'MLB StatsAPI: abridores probables',status:starters.length?'verified':'unavailable',
      records:starters.length},
    {source:'Casas: mercado vigente y evento reconciliado',
      status:markets.length?'verified':'unavailable',records:markets.length},
  ]
  const sections:Section[]=[]
  const put=(heading:string,kind:Section['kind'],items:Fact[])=>{
    if(items.length&&sections.length<8)sections.push({heading,kind,items:items.slice(0,14)})
  }
  put('Forma reciente y descanso','metrics',[
    stat(current.home.name,homeForm.games?homeForm.wins+'V · '+homeForm.losses+'D · '+homeForm.draws+'E':'Sin muestra',
      'Puntos/carreras por juego: '+String(homeForm.scoredPerGame??'N/D')+
      ' · recibidos: '+String(homeForm.allowedPerGame??'N/D')),
    stat(current.away.name,awayForm.games?awayForm.wins+'V · '+awayForm.losses+'D · '+awayForm.draws+'E':'Sin muestra',
      'Puntos/carreras por juego: '+String(awayForm.scoredPerGame??'N/D')+
      ' · recibidos: '+String(awayForm.allowedPerGame??'N/D')),
    stat('Descanso local (horas)',home[0]?round((kickoff-Date.parse(home[0].date))/3_600_000):null),
    stat('Descanso visitante (horas)',away[0]?round((kickoff-Date.parse(away[0].date))/3_600_000):null),
  ])
  put('Últimos resultados','list',[
    ...home.slice(0,4).map(r=>stat(current.home.name+' vs '+r.opponent,
      r.scored+'-'+r.allowed,r.date.slice(0,10))),
    ...away.slice(0,4).map(r=>stat(current.away.name+' vs '+r.opponent,
      r.scored+'-'+r.allowed,r.date.slice(0,10))),
  ])
  put('Enfrentamientos directos verificados','list',h2h.map(g=>stat(
    g.home.name+' vs '+g.away.name,g.home.score+'-'+g.away.score,g.date.slice(0,10))))
  put('Localía y estadio','metrics',[
    stat('Estadio',current.venueName||null),
    ...(current.roof?[stat('Techo',current.roof)]:[]),
    ...(weather?[stat('Tiempo previsto',weather.dayNight+' · '+
      String(weather.temperatureC??'?')+'°C · '+String(weather.windKmh??'?')+' km/h',
      'Viento '+String(weather.windDirectionDeg??'?')+'° · lluvia '+
      String(weather.precipitationProbability??'?')+'% · modelo Open-Meteo (no ventaja causal)')]:[]),
    stat('Partidos previos local en esta sede',venueGames?.home.length??null),
    stat('Partidos previos visitante en esta sede',venueGames?.away.length??null),
    ...(venueGames?.home.length?[stat('Balance local en sede',
      summary(venueGames.home).wins+'V / '+summary(venueGames.home).losses+'D')]:[]),
  ])
  if(periods.length)put('MLB · carreras por tramos de innings','metrics',periods.map(p=>stat(
    'Primeras '+p.innings+' entradas · total',p.exploratoryTotal===null?'Sin estimación válida':
      String(p.exploratoryTotal)+' (referencia exploratoria)',
    'Muestras local: '+p.homeScored.games+' · visitante: '+p.awayScored.games+
      ' · '+p.interpretation)))
  if(starters.length)put('MLB · abridores probables','list',starters.map(p=>stat(
    p.name,p.team+' · '+p.outings.length+' aperturas con registros',
    p.outings.slice(0,3).map(o=>o.date+' '+o.inningsPitched+' IP / '+o.earnedRuns+' CL').join(' · ')||
    'Últimas aperturas no verificadas')))
  if(context)put('Plantillas, bajas y noticias','list',[
    ...context.injuries.slice(0,5).map(i=>stat(i.athlete,i.status,i.team)),
    ...context.headlines.slice(0,5).map(n=>stat(n.headline,n.published,'ESPN News')),
    ...context.teams.slice(0,2).map(t=>stat('Plantilla '+t.name,
      t.rosterSample.length+' nombres recuperados','No confirma alineación titular')),
  ])
  if(markets.length)put('Mercados observados · sin promesa de acierto','list',
    markets.flatMap(m=>m.selections.slice(0,3).map(s=>stat(
      m.market+' · '+s.name,s.price.toFixed(2)+' · '+m.bookmaker,
      s.noVigShare===null?'Sin probabilidad depurada comparable':
        'Cuota sin margen del mercado '+(100*s.noVigShare).toFixed(1)+'% · NO modelo propio'))))
  const missing=[
    ...(home.length<5||away.length<5?['Muestra inferior a 5 partidos por equipo']:[]),
    ...(h2h.length===0?['Sin enfrentamientos directos comprobados en la ventana']:[]),
    ...(!current.venueId?['Sede sin identificador verificable para calcular antecedentes']:[]),
    ...(context?.limitations??['Lesiones, plantillas y noticias no contrastadas']),
    ...(input.sport==='baseball'&&!starters.length?['Abridores probables no confirmados por MLB StatsAPI']:[]),
    ...(input.sport==='baseball'&&periods.some(x=>x.exploratoryTotal===null)?
      ['Tramos de 3/5/9 innings: datos por entrada insuficientes, no extrapolar']:[]),
    ...(!markets.length?['Mercado de apuestas actual no encontrado o sin correspondencia segura con ESPN']:[]),
    ...(!weather?['Pronóstico de viento, lluvia y temperatura no disponible: faltan coordenadas ESPN, fuente o cobertura temporal']:[]),
    'Sin orientación de campo, techo confirmado y un modelo validado no se atribuyen efectos causales del viento, sol ni temperatura',
    ...(matchupTypes[input.sport]??['Métricas específicas del deporte y ritmo de juego']).map(x=>
      'A verificar con fuente especializada: '+x),
    'No hay modelo de probabilidades calibrado ni validación histórica fuera de muestra; no estimar EV o ventaja matemática',
  ]
  if(!sections.length)put('Disponibilidad','list',[stat('Sin datos suficientes',
    'No se pudieron verificar indicadores adicionales')])
  const checkedAt=new Date(now).toISOString()
  return{
    eventId:input.eventId,date:current.date,phase:current.state,
    sport:input.sport,league:input.league,
    home:{id:current.home.id,name:current.home.name,form:homeForm,lastGames:home},
    away:{id:current.away.id,name:current.away.name,form:awayForm,lastGames:away},
    headToHead:h2h.map(g=>({eventId:g.id,date:g.date,home:g.home.name,away:g.away.name,
      homeScore:g.home.score,awayScore:g.away.score})),
    stadium:{id:current.venueId,name:current.venueName,roof:current.roof,
      homeAtVenue:venueGames?.home.length??null,awayAtVenue:venueGames?.away.length??null},
    weather,
    mlb:{innings:periods,probableStarters:starters},
    rosterNewsInjuries:context?{sources:context.sources,injuries:context.injuries,
      headlines:context.headlines,rosters:context.teams}:null,
    marketComparisons:markets,marketSportKey:key??null,coverage:availability,
    limitations:missing,source:'ESPN Site API + MLB StatsAPI + mercados públicos observados',
    checkedAt,predictionCalibrated:false,
    uiBlock:{component:'sports_espn_dashboard' as const,version:1 as const,props:{
      view:'event' as const,title:current.away.name+' vs '+current.home.name,
      subtitle:input.league.toUpperCase()+' · factores contrastados · '+input.date,
      source:'ESPN · MLB StatsAPI · casas (solo si verificadas)',checkedAt,sections,
      note:'Señales descriptivas, no probabilidades de victoria calibradas. '+
        availability.filter(x=>x.status==='verified').length+'/'+availability.length+
        ' fuentes con evidencia; faltantes: '+missing.length+'.',
    }},
  }
}
