/** Bounded, source-attributed ESPN explorer. No raw payloads, arbitrary URLs or guessed statistics. */
import { getFeed, hasSportsPermission, sportsCatalog, discoverEspnLeagues } from './sports.ts'

type Row = Record<string, unknown>
type View = 'team'|'player'|'event'|'standings'|'news'|'leaders'|'search'
type Item = { label:string; value?:string; detail?:string; image?:string; href?:string; action?:{label:string;prompt:string} }
type Section = { heading:string; kind:'metrics'|'list'|'articles'; items:Item[] }
type Source = { name:string; status:'available'|'unavailable'; records:number }
export type EspnExplorerInput = {
  sport:string; league:string; view:View; teamId?:string; athleteId?:string;
  eventId?:string; season?:number; query?:string
}
export type EspnExplorerResult = {
  view:View; title:string; subtitle:string; source:string; checkedAt:string;
  sections:Section[]; sources:Source[]; limitations:string[];
  uiBlock:{component:'sports_espn_dashboard';version:1;props:{
    view:View;title:string;subtitle:string;source:string;checkedAt:string;
    image?:string;sections:Section[];note:string
  }}
}
const row=(x:unknown):Row=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Row:{}
const array=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const clean=(x:unknown,max=160):string=>(typeof x==='string'||typeof x==='number'?
  String(x).replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max):'')
const txt=(x:unknown,max=160)=>clean(x,max)
const id=(x:unknown)=>/^\d{1,18}$/u.test(String(x??''))?String(x):''
const slug=(x:unknown)=>typeof x==='string'&&/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(x)
const cover=(x:unknown):string|undefined=>{
  const value=txt(x,500)
  if(!value)return undefined
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&
    u.hostname==='a.espncdn.com'?value:undefined}catch{return undefined}
}
const newsLink=(x:unknown):string|undefined=>{
  const href=txt(x,500)
  try{
    const u=new URL(href)
    return u.protocol==='https:'&&!u.username&&!u.password&&
      ['www.espn.com','espn.com'].includes(u.hostname)&&u.pathname.length>1?href:undefined
  }catch{return undefined}
}
const img=(x:unknown):string|undefined=>{
  if(Array.isArray(x))return img(x[0])
  const a=row(x)
  return cover(x)||cover(a.href)||cover(a.url)||cover(a.logo)
    ||cover(row(array(a.images)[0]).url)||cover(row(array(a.logos)[0]).href)
}
const label=(x:unknown)=>txt(row(x).displayName||row(x).fullName||row(x).name||x)
const item=(labelText:unknown,value?:unknown,detail?:unknown,image?:unknown):Item|null=>{
  const title=txt(labelText,180);if(!title)return null
  const v=txt(value,180),d=txt(detail,240),photo=img(image)
  return {label:title,...(v?{value:v}:{}),...(d?{detail:d}:{}),...(photo?{image:photo}:{})}
}
const section=(heading:string,kind:Section['kind'],values:Array<Item|null>,max=16):Section|null=>{
  const seen=new Set<string>(),items:Item[]=[]
  for(const value of values){if(!value)continue
    const key=value.label+'|'+(value.value??'')
    if(seen.has(key))continue
    seen.add(key);items.push(value)
    if(items.length>=max)break
  }
  return items.length?{heading,kind,items}:null
}
/** Ref-only lists, page metadata and 200 {} are not source evidence. */
const nonempty=(v:unknown,depth=0):boolean=>{
  if(v===null||v===undefined||depth>10)return false
  if(Array.isArray(v))return v.slice(0,24).some(x=>nonempty(x,depth+1))
  if(typeof v==='object')return Object.entries(row(v))
    .filter(([k])=>!['$ref','count','pageIndex','pageCount','pageSize','timestamp'].includes(k))
    .some(([,x])=>nonempty(x,depth+1))
  return typeof v==='string'?v.trim().length>0:true
}
const cache=new Map<string,{until:number;value:unknown}>()
const saveCache=(url:string,value:unknown,ttl:number)=>{
  cache.delete(url)
  if(cache.size>=160)cache.delete(cache.keys().next().value??'')
  cache.set(url,{until:Date.now()+ttl,value})
}
/** Cache successes and negative results; never cache indefinitely and bound total memory. */
async function read(url:string,fetcher:typeof fetch,ttlMs:number):Promise<unknown>{
  const cached=cache.get(url)
  if(cached&&cached.until>Date.now())return cached.value
  try{
    const response=await getFeed<unknown>(url,fetcher)
    if(!nonempty(response))throw Error('ESPN devolvió datos vacíos')
    saveCache(url,response,ttlMs)
    return response
  }catch(error){
    saveCache(url,null,30_000)
    throw error
  }
}
const source=(name:string,data:unknown,records=nonempty(data)?1:0):Source=>({
  name,status:records>0?'available':'unavailable',records
})
const valid=(v:EspnExplorerInput):void=>{
  if(!Object.hasOwn(sportsCatalog,v.sport)||!slug(v.sport)||!slug(v.league))
    throw Error('Deporte o liga inválido')
  if(!['team','player','event','standings','news','leaders','search'].includes(v.view))
    throw Error('Vista ESPN inválida')
  if(v.teamId!==undefined&&!id(v.teamId)||v.athleteId!==undefined&&!id(v.athleteId)
     ||v.eventId!==undefined&&!id(v.eventId))throw Error('Identificador ESPN inválido')
  const requirement=v.view==='team'?'teamId':v.view==='player'?'athleteId':v.view==='event'?'eventId':null
  if(requirement&&!id(v[requirement]))throw Error('Falta un ID real para la vista solicitada')
  if(v.season!==undefined&&(!Number.isInteger(v.season)||v.season<1900||v.season>2200))
    throw Error('Temporada inválida')
  if(v.view==='search'&&(!v.query||v.query.trim().length<2||v.query.length>80))
    throw Error('Busca al menos dos caracteres y un máximo de 80')
}
/** Discover validated stats by category, not by taking unrelated numbers from the payload. */
function metrics(data:unknown,max=18):Item[]{
  const values:Item[]=[],queue:Array<{node:unknown;depth:number}>=[{node:data,depth:0}]
  let seen=0
  while(queue.length&&seen++<180&&values.length<max){
    const next=queue.shift()!;const v=row(next.node)
    if(!Object.keys(v).length)continue
    const cats=array(v.stats).length?array(v.stats):array(v.statistics)
    for(const s of cats.slice(0,24)){
      const stat=row(s)
      const label=stat.displayName??stat.label??stat.name??stat.abbreviation
      const value=stat.displayValue??stat.value
      if(label!==undefined&&value!==undefined&&!Array.isArray(value)&&
        typeof value!=='object'){const x=item(label,value);if(x)values.push(x)}
    }
    const labels=array(v.labels).length?array(v.labels):array(v.displayNames)
    const nums=array(v.stats)
    if(labels.length&&labels.length===nums.length&&nums.every(x=>typeof x!=='object')){
      labels.slice(0,18).forEach((name,i)=>{const x=item(name,nums[i]);if(x)values.push(x)})
    }
    if(next.depth>=4)continue
    for(const k of ['categories','statistics','stats','splits','records','items','seasonTypes']){
      const field=v[k]
      if(Array.isArray(field)){
        for(const child of field.slice(0,15))if(child!==null&&typeof child==='object')queue.push({node:child,depth:next.depth+1})
      }else if(field!==null&&typeof field==='object')queue.push({node:field,depth:next.depth+1})
    }
  }
  return values.slice(0,max)
}
function stories(data:unknown):Item[]{
  const d=row(data),articles=array(d.articles).length?array(d.articles):
    array(d.items)
  return articles.slice(0,20).map(article=>{
    const a=row(article),base=item(a.headline??a.title,
      a.published??a.lastModified??a.publishedAt,
      a.description??a.story,
      array(a.images)[0])
    const url=newsLink(row(row(a.links).web).href??a.link)
    return base&&url?{...base,href:url}:base
  }).filter((x):x is Item=>x!==null)
}
function roster(data:unknown,sport:string,league:string):Item[]{
  const groups=array(row(data).athletes),individuals=groups.flatMap(g=>{
    const r=row(g);return array(r.items).length?array(r.items):[g]
  })
  return individuals.slice(0,65).map(a=>{
    const p=row(a),person=row(p.athlete),x=Object.keys(person).length?person:p
    const base=item(x.displayName??x.fullName??x.name,
      row(x.position).displayName??row(x.position).abbreviation,
      x.jersey?('#'+txt(x.jersey,8)):'',
      x.headshot)
    const athleteId=id(x.id)
    return base&&athleteId?{...base,action:{label:'Estadísticas del jugador',
      prompt:'Kira, consulta sports_chat_espn_explore con view=player, sport='+sport+
        ', league='+league+', athleteId='+athleteId+'. Muestra su ficha, estadísticas, gamelog y splits.'}}:base
  }).filter((x):x is Item=>x!==null)
}

/** Injury status appears on some roster rows; it is not a starter confirmation. */
function rosterInjuries(data:unknown):Item[]{
  return array(row(data).athletes).flatMap(group=>{
    const g=row(group);return array(g.items).length?array(g.items):[group]
  }).flatMap(value=>{
    const athlete=row(value),injuries=array(athlete.injuries)
    return injuries.slice(0,2).map(v=>{
      const i=row(v),status=txt(i.status??row(i.type).description,100)
      return status?item(athlete.displayName??athlete.fullName,status,i.date):null
    })
  }).filter((x):x is Item=>x!==null).slice(0,20)
}

function standings(data:unknown):Item[]{
  const nodes:unknown[]=[data],out:Item[]=[]
  while(nodes.length&&out.length<35){
    const current=row(nodes.shift())
    for(const s of array(current.entries).slice(0,35)){
      const e=row(s),team=row(e.team),stats=array(e.stats)
      const record=stats.map(k=>row(k)).find(k=>k.name==='overall'||k.type==='total'||k.type==='overall')
      const result=item(team.displayName??team.name,
        record?.displayValue??row(array(e.records)[0]).summary,
        stats.slice(0,8).map(s=>row(s)).filter(s=>['wins','losses','points','pointDifferential','streak'].includes(txt(s.name,60)))
          .map(s=>txt(s.abbreviation||s.name,35)+' '+txt(s.displayValue||s.value,25)).join(' · '),
        team.logos)
      if(result)out.push(result)
    }
    for(const child of array(current.children).slice(0,24))nodes.push(child)
    if(current.standings&&typeof current.standings==='object')nodes.push(current.standings)
  }
  return out.slice(0,30)
}
function gamelog(data:unknown):Item[]{
  const root=row(data),out:Item[]=[],q:unknown[]=[data];let seen=0
  while(q.length&&seen++<80&&out.length<14){
    const d=row(q.shift())
    const labs=array(d.labels)
    for(const e of array(d.events).slice(0,12)){
      const g=row(e),values=array(g.stats),known=row(row(root.events)[txt(g.eventId,30)])
      const description=values.length&&labs.length===values.length?
        labs.slice(0,5).map((x,i)=>txt(x,20)+': '+txt(values[i],22)).join(' · '):''
      const v=item(known.shortName??known.name??g.displayName??g.eventId,
        description,g.gameDate??known.date)
      if(v)out.push(v)
    }
    for(const k of ['seasonTypes','categories','tables'])q.push(...array(d[k]).slice(0,12))
  }
  return out
}
function summaryFacts(data:unknown):{heading:string;items:Item[];image?:string}{
  const d=row(data),h=row(d.header),comp=row(array(h.competitions)[0])
  const competitors=array(comp.competitors)
  const teams=competitors.slice(0,4).map(x=>{
    const c=row(x),t=row(c.team)
    const final=row(row(h.status).type).state==='post'||row(row(comp.status).type).state==='post'
    const markedWinner=final&&c.winner===true
    return item(t.displayName??t.name,c.score!==undefined?
      ((markedWinner?'Ganador · ':'Marcador: ')+txt(c.score,25)):c.homeAway,
      array(c.records).map(r=>txt(row(r).summary,45)).filter(Boolean).join(' · '),t.logo??t.logos)
  }).filter((x):x is Item=>x!==null)
  const venue=row(comp.venue)
  const evidence=(field:string,value:unknown):Item|null=>{
    const verified=txt(value,180)
    return verified?item(field,verified):null
  }
  const facts=[evidence('Estado',row(row(h.status).type).description??row(h.status).displayClock),
    evidence('Sede',venue.fullName),evidence('Fecha',comp.date??h.date),
    ...teams].filter((x):x is Item=>x!==null)
  return {heading:'Partido y participantes',items:facts}
}
function eventLeaders(data:unknown):Item[]{
  const d=row(data),bs=row(d.boxscore)
  return array(bs.players).flatMap(group=>array(row(group).statistics).flatMap(s=>{
    const st=row(s),names=array(st.labels)
    return array(st.athletes).slice(0,5).map(athlete=>{
      const a=row(athlete),p=row(a.athlete),values=array(a.stats)
      return item(p.displayName,
        names.slice(0,4).map((name,i)=>txt(name,22)+': '+txt(values[i],24)).join(' · '),
        row(row(group).team).displayName,p.headshot)
    })
  })).filter((x):x is Item=>x!==null).slice(0,18)
}
function searchResults(data:unknown,sport:string,league:string):Item[]{
  const d=row(data),groups=array(d.results)
  const hits=groups.flatMap(g=>array(row(g).items).map(hit=>({
    hit,category:txt(row(g).type??row(g).name,40).toLowerCase(),
  })))
  return hits.slice(0,30).map(({hit,category})=>{
    const x=row(hit),result=item(x.displayName??x.name??x.title,
      x.subtitle??x.type,x.description,x.image??x.logo)
    const entityId=id(x.id)
    const kind=txt(x.type,35).toLowerCase()||category
    const player=/athlete|player|jugador/u.test(kind),team=/team|equipo|club/u.test(kind)
    if(!result)return null
    if(!entityId||!player&&!team)return result
    const view=player?'player':'team'
    return {...result,value:result.value??('ID ESPN: '+entityId),
      action:{label:player?'Ficha y estadísticas':'Perfil del equipo',
        prompt:'Kira, consulta sports_chat_espn_explore con sport='+sport+', league='+league+
          ', view='+view+', '+(player?'athleteId':'teamId')+'='+entityId+
          '. Usa exclusivamente hechos verificados por ESPN.'}}
  }).filter((x):x is Item=>x!==null)
}
/** Explores one ESPN entity with bounded optional evidence and a reusable adaptive UI.
 * Each route is constructed internally; references/redirects never become fetch URLs.
 */
export async function exploreEspn(
  input:EspnExplorerInput,fetcher:typeof fetch=fetch,
  env:NodeJS.ProcessEnv=process.env,now=Date.now(),
):Promise<EspnExplorerResult>{
  valid(input)
  if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado por el operador')
  if(!sportsCatalog[input.sport]?.includes(input.league)
     &&!(await discoverEspnLeagues(input.sport,env,fetcher)).includes(input.league))
    throw Error('La liga no figura en el catálogo de ESPN')
  const {sport,league,view}=input
  const site='https://site.api.espn.com/apis/site/v2/sports/'+sport+'/'+league+'/'
  const web='https://site.web.api.espn.com/apis/common/v3/sports/'+sport+'/'+league+'/'
  const core='https://sports.core.api.espn.com/v2/sports/'+sport+'/leagues/'+league+'/'
  const qs=input.season?'?season='+input.season:''
  const jobs:Array<{name:string;url:string;ttl:number}>=[]
  const add=(name:string,url:string,ttl=300_000)=>jobs.push({name,url,ttl})
  if(view==='team'){
    add('Perfil del equipo',site+'teams/'+input.teamId)
    add('Plantilla',site+'teams/'+input.teamId+'/roster',900_000)
    add('Calendario del equipo',site+'teams/'+input.teamId+'/schedule',600_000)
    add('Noticias del equipo',site+'teams/'+input.teamId+'/news',300_000)
    add('Estadísticas del equipo',site+'teams/'+input.teamId+'/statistics',1_800_000)
    add('Récord del equipo',site+'teams/'+input.teamId+'/record',900_000)
    add('Movimientos del equipo',site+'teams/'+input.teamId+'/transactions',1_800_000)
  }else if(view==='player'){
    add('Perfil del jugador',core+'athletes/'+input.athleteId,86_400_000)
    add('Resumen del jugador',web+'athletes/'+input.athleteId+'/overview')
    add('Estadísticas de temporada',web+'athletes/'+input.athleteId+'/stats'+qs,3_600_000)
    add('Partido a partido',web+'athletes/'+input.athleteId+'/gamelog'+qs,1_800_000)
    add('Estadísticas situacionales',web+'athletes/'+input.athleteId+'/splits'+qs,3_600_000)
  }else if(view==='event'){
    add('Resumen del evento',site+'summary?event='+input.eventId,30_000)
    add('Probabilidades ESPN Core',core+'events/'+input.eventId+'/competitions/'+input.eventId+'/probabilities',60_000)
    add('Cuotas ESPN Core',core+'events/'+input.eventId+'/competitions/'+input.eventId+'/odds',60_000)
    add('Jugadas ESPN Core',core+'events/'+input.eventId+'/competitions/'+input.eventId+'/plays?limit=40',30_000)
  }else if(view==='standings'){
    add('Clasificación ESPN','https://site.api.espn.com/apis/v2/sports/'+sport+'/'+league+'/standings'+qs,900_000)
  }else if(view==='news'){
    add('Noticias ESPN',site+'news?limit=25',300_000)
  }else if(view==='leaders'){
    add('Líderes de liga',web+'statistics/byathlete'+qs,1_800_000)
    add('Estadísticas generales',site+'statistics',1_800_000)
  }else if(view==='search'){
    add('Buscador ESPN','https://site.web.api.espn.com/apis/search/v2?query='+encodeURIComponent(input.query!.trim())+'&limit=20',300_000)
  }
  const settled=await Promise.allSettled(jobs.map(j=>read(j.url,fetcher,j.ttl)))
  const data=new Map<string,unknown>(),sources:Source[]=[]
  settled.forEach((result,i)=>{
    const name=jobs[i]!.name
    const value=result.status==='fulfilled'?result.value:null
    data.set(name,value);sources.push(source(name,value))
  })
  const blocks:Section[]=[],put=(b:Section|null)=>{if(b&&blocks.length<8)blocks.push(b)}
  let title='ESPN · '+league.toUpperCase()
  let subtitle=({team:'Equipo',player:'Jugador',event:'Encuentro',standings:'Clasificación',
    news:'Noticias',leaders:'Líderes estadísticos',search:'Resultados de búsqueda'} satisfies Record<View,string>)[view]
  let image:string|undefined
  if(view==='team'){
    const t=row(row(data.get('Perfil del equipo')).team)
    const v=Object.keys(t).length?t:row(data.get('Perfil del equipo'))
    title=label(v)||title; image=img(v.logos??v.logo)
    put(section('Perfil','metrics',[item('Abreviatura',v.abbreviation),item('Ciudad',v.location),
      item('Nombre',v.name),item('Color oficial',v.color)]))
    put(section('Rendimiento de temporada','metrics',[
      ...metrics(data.get('Estadísticas del equipo'),10),
      ...metrics(data.get('Récord del equipo'),8),
    ]))
    put(section('Plantilla verificada','list',roster(data.get('Plantilla'),sport,league),24))
    put(section('Disponibilidad reportada en plantilla','list',rosterInjuries(data.get('Plantilla'))))
    const schedule=row(data.get('Calendario del equipo'))
    put(section('Próximos encuentros y resultados','list',
      array(schedule.events).slice(0,16).map(g=>{const e=row(g)
        const base=item(e.shortName??e.name,e.date,row(row(e.status).type).description)
        const eventId=id(e.id)
        return base&&eventId?{...base,action:{label:'Detalle del encuentro',
          prompt:'Kira, consulta sports_chat_espn_explore con view=event, sport='+sport+
            ', league='+league+', eventId='+eventId+'. Muestra estadísticas y hechos comprobados.'}}:base})))
    put(section('Noticias del equipo','articles',stories(data.get('Noticias del equipo'))))
    const tx=data.get('Movimientos del equipo')
    put(section('Movimientos oficiales','list',array(row(tx).transactions).slice(0,12).map(m=>{
      const e=row(m);return item(e.description??e.type,e.date)
    })))
  }else if(view==='player'){
    const p=row(data.get('Perfil del jugador')),ov=row(data.get('Resumen del jugador'))
    const bio=Object.keys(p).length?p:row(ov.athlete)
    title=label(bio)||title;image=img(bio.headshot??row(ov.athlete).headshot)
    put(section('Perfil','metrics',[item('Posición',row(bio.position).displayName),
      item('Equipo',row(bio.team).displayName),item('Edad',bio.age),
      item('Dorsal',bio.jersey),item('Altura',bio.displayHeight),item('Peso',bio.displayWeight)]))
    put(section('Estadísticas de temporada','metrics',metrics(data.get('Estadísticas de temporada'))))
    put(section('Registro partido por partido','list',gamelog(data.get('Partido a partido'))))
    put(section('Splits y rendimiento situacional','metrics',metrics(data.get('Estadísticas situacionales'))))
    const playerOverview=row(data.get('Resumen del jugador'))
    put(section('Noticias del deportista','articles',stories(playerOverview.news??playerOverview)))
  }else if(view==='event'){
    const overview=data.get('Resumen del evento'),match=summaryFacts(overview)
    title=txt(row(row(overview).header).shortName)||title
    put(section('Encuentro y marcador','list',match.items))
    put(section('Líderes del boxscore','list',eventLeaders(overview)))
    const plays=array(row(overview).plays)
    put(section('Jugadas publicadas','list',plays.slice(-18).reverse().map(x=>{
      const p=row(x);return item(p.text??p.description, p.clock?txt(row(p.clock).displayValue):undefined)
    })))
    // Core odds/probabilities frequently return only $ref pointers; they are
    // deliberately not interpreted as current prices or pregame predictions.
    const odds=row(data.get('Cuotas ESPN Core'))
    const provider=label(row(odds.provider))
    if(provider){
      const overUnder=odds.overUnder
      put(section('Cuotas publicadas por ESPN','metrics',[item('Proveedor',provider),
        item('Línea total (no precio)',overUnder)]))
    }
  }else if(view==='standings'){
    put(section('Tabla por conferencia / división','list',standings(data.get('Clasificación ESPN')),30))
  }else if(view==='news'){
    put(section('Últimos titulares','articles',stories(data.get('Noticias ESPN')),20))
  }else if(view==='leaders'){
    const leader=data.get('Líderes de liga')??data.get('Estadísticas generales')
    put(section('Líderes y estadísticas publicadas','metrics',metrics(leader,18)))
    const entries=array(row(leader).athletes)
    put(section('Jugadores destacados','list',entries.slice(0,20).map(p=>{
      const a=row(p);return item(a.displayName??row(a.athlete).displayName,
        a.displayValue??a.value,undefined,a.headshot)
    })))
  }else if(view==='search'){
    subtitle='Resultados para '+txt(input.query,80)
    put(section('Entidades encontradas','list',searchResults(data.get('Buscador ESPN'),sport,league),20))
  }
  const limitations=[
    'Solo se muestran campos que el proveedor devolvió; un HTTP 200 vacío no valida una estadística.',
    'ESPN no garantiza cobertura de todas las ligas, temporadas, jugadores ni mercados.',
    'Las cuotas de Core no se confunden con probabilidades de ESPN ni con precios vigentes de una casa.',
    'Plantillas y noticias no confirman titulares, porteros, lesiones actualizadas o alineaciones.',
  ]
  if(blocks.length===0)put(section('Disponibilidad','list',[item('Sin información verificable',
    'La ruta no aportó datos suficientes para esta vista. Prueba otra liga, temporada o fuente.')]))
  const checkedAt=new Date(now).toISOString()
  const note=sources.filter(s=>s.status==='available').length+' de '+sources.length+
    ' fuentes con datos · Las cifras y las imágenes proceden de ESPN; disponibilidad variable.'
  return{view,title,subtitle,source:'ESPN Site / Core / Common v3',checkedAt,
    sections:blocks,sources,limitations,
    uiBlock:{component:'sports_espn_dashboard',version:1,props:{
      view,title,subtitle,source:'ESPN Site / Core / Common v3',checkedAt,
      ...(image?{image}:{}),sections:blocks,note,
    }},
  }
}
