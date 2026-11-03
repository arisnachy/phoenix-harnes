/** PHOENIX Basketball Intelligence — verified pregame fixtures for NBA and WNBA. */
import {getFeed,hasSportsPermission} from './sports.ts'
export type BasketballLeague='nba'|'wnba'
export type BasketballSource={url:string;observedAt:string;status:'verified'|'empty'|'error';reason?:string}
export type BasketballFixture={league:BasketballLeague;eventId:string;start:string;
  status:'pre'|'in'|'post'|'unknown';phase:string;venue:string;
  home:{id:string;name:string;record:string|null};away:{id:string;name:string;record:string|null}}
export const record=(v:unknown):Record<string,unknown>=>
  v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
export const values=(v:unknown):unknown[]=>Array.isArray(v)?v:[]
export const label=(v:unknown,max=110):string=>(typeof v==='string'||typeof v==='number'
  ?String(v).replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max):'')
export const id=(v:unknown):string=>/^\d{1,18}$/u.test(String(v??''))?String(v):''
export const dateOk=(v:string):boolean=>/^\d{4}-\d{2}-\d{2}$/u.test(v)&&
  Number.isFinite(Date.parse(v+'T00:00:00Z'))&&
  new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v
export const teamKey=(v:string):string=>v.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
export async function basketballRead<T>(url:string,fetcher:typeof fetch,
  sources:BasketballSource[],now:number):Promise<T|null>{
  try{const data=await getFeed<T>(url,fetcher)
    sources.push({url,observedAt:new Date(now).toISOString(),status:data==null?'empty':'verified'})
    return data
  }catch(err){sources.push({url,observedAt:new Date(now).toISOString(),status:'error',
    reason:(err instanceof Error?err.message:'Fuente no disponible').slice(0,140)})
    return null}
}
export function parseBasketballFixture(raw:unknown,league:BasketballLeague):BasketballFixture|null{
  const e=record(raw),comp=record(values(e.competitions)[0]),athletes=values(comp.competitors).map(record)
  const side=(name:'home'|'away')=>{
    const r=athletes.find(v=>v.homeAway===name),t=record(r?.team)
    const teamId=id(t.id??r?.id),teamName=label(t.displayName??t.name)
    const recordText=values(r?.records).map(v=>label(record(v).summary,30))
      .find(v=>/^\d+-\d+$/u.test(v))??null
    return teamId&&teamName?{id:teamId,name:teamName,record:recordText}:null
  }
  const home=side('home'),away=side('away'),eventId=id(e.id)
  const start=label(e.date,45)
  const type=record(record(e.status).type),state=label(type.state,16)
  const venue=record(comp.venue)
  if(!home||!away||!eventId||!Number.isFinite(Date.parse(start)))return null
  return{league,eventId,start,status:state==='pre'?'pre':state==='in'?'in':
    state==='post'?'post':'unknown',
    phase:label(record(e.season).type??record(e.season).slug,40)||'sin confirmar',
    venue:label(venue.fullName??venue.name)||'Sede sin verificar',home,away}
}
export async function basketballSlate(league:BasketballLeague,date:string,
  fetcher:typeof fetch=fetch,now=Date.now(),env:NodeJS.ProcessEnv=process.env):
  Promise<{league:BasketballLeague;date:string;games:BasketballFixture[];
    sources:BasketballSource[];offseason:boolean}>{
  if(league!=='nba'&&league!=='wnba')throw Error('Liga basketball no permitida')
  if(!dateOk(date))throw Error('Fecha de baloncesto inválida')
  if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado')
  const sources:BasketballSource[]=[]
  const url='https://site.api.espn.com/apis/site/v2/sports/basketball/'+league+
    '/scoreboard?dates='+date.replaceAll('-','')
  const data=await basketballRead<{events?:unknown[]}>(url,fetcher,sources,now)
  const games=values(data?.events).flatMap(v=>{
    const g=parseBasketballFixture(v,league);return g?[g]:[]})
  const dedup=new Map(games.map(g=>[g.eventId,g]))
  return{league,date,games:[...dedup.values()],sources,offseason:!!data&&!games.length}
}
/** 48 NBA regulation minutes vs 40 WNBA; neither includes overtime. */
export const regulationMinutes=(league:BasketballLeague)=>league==='nba'?48:40
/** Official regulation-only points total/spread; overtime is an explicit caller choice. */
export function settleBasketballScore(home:number,away:number,
  market:{kind:'total';pick:'over'|'under';line:number}|
    {kind:'spread';team:'home'|'away';line:number}|
    {kind:'moneyline';team:'home'|'away'},period:'regulation'|'including_ot'):
  {status:'win'|'push'|'loss';period:'regulation'|'including_ot';note:string}{
  if(!Number.isSafeInteger(home)||!Number.isSafeInteger(away)||home<0||away<0||
    home>500||away>500)throw Error('Marcador inválido')
  if(market.kind!=='moneyline'&&(!Number.isFinite(market.line)||
    Math.abs(market.line)>500||Math.abs(market.line*2-Math.round(market.line*2))>1e-9))
    throw Error('Línea de puntos inválida')
  if(period!=='regulation'&&period!=='including_ot')throw Error('Período no verificable')
  const diff=market.kind==='total'?(market.pick==='over'?home+away-market.line:market.line-home-away):
    market.kind==='spread'?(market.team==='home'?home-away+market.line:away-home+market.line):
      market.team==='home'?home-away:away-home
  const status=diff>1e-9?'win':diff< -1e-9?'loss':'push'
  return{status,period,note:'Verificar reglamento de casa, DNP, abandonos, OT, stat corrections y períodos.'}
}
