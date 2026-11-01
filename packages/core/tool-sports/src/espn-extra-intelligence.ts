/**
 * Curated extended ESPN routes. All are unofficial and availability varies
 * across leagues. An entry in this catalog does not prove HTTP reachability.
 * No arbitrary URLs, CDN scraping, partner credentials or private fantasy APIs.
 */
export const extendedEspnRoutes={
  team_record:{root:'core',path:'/seasons/{season}/types/{seasonType}/teams/{teamId}/record'},
  team_statistics:{root:'core',path:'/seasons/{season}/types/{seasonType}/teams/{teamId}/statistics'},
  team_projection:{root:'core',path:'/seasons/{season}/teams/{teamId}/projection'},
  team_depth_chart:{root:'core',path:'/seasons/{season}/teams/{teamId}/depthcharts'},
  team_athletes:{root:'core',path:'/seasons/{season}/teams/{teamId}/athletes'},
  team_injuries:{root:'core',path:'/teams/{teamId}/injuries'},
  team_roster:{root:'site',path:'/teams/{teamId}/roster'},
  team_schedule:{root:'site',path:'/teams/{teamId}/schedule'},
  athlete_overview:{root:'web',path:'/athletes/{athleteId}/overview'},
  athlete_bio:{root:'web',path:'/athletes/{athleteId}/bio'},
  athlete_stats:{root:'web',path:'/athletes/{athleteId}/stats'},
  athlete_gamelog:{root:'web',path:'/athletes/{athleteId}/gamelog'},
  athlete_splits:{root:'web',path:'/athletes/{athleteId}/splits'},
  athlete_eventlog:{root:'core',path:'/seasons/{season}/athletes/{athleteId}/eventlog'},
  athlete_season_stats:{root:'core',path:'/seasons/{season}/types/{seasonType}/athletes/{athleteId}/statistics'},
  athlete_history:{root:'core',path:'/athletes/{athleteId}/statisticslog'},
  game_plays:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/plays'},
  game_team_linescores:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/competitors/{teamId}/linescores'},
  game_team_statistics:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/competitors/{teamId}/statistics'},
  game_roster:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/competitors/{teamId}/roster'},
  game_officials:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/officials'},
  game_powerindex:{root:'core',path:'/events/{eventId}/competitions/{competitionId}/powerindex/{teamId}'},
  season_teams:{root:'core',path:'/seasons/{season}/teams'},
  season_coaches:{root:'core',path:'/seasons/{season}/coaches'},
  season_weeks:{root:'core',path:'/seasons/{season}/types/{seasonType}/weeks'},
  week_events:{root:'core',path:'/seasons/{season}/types/{seasonType}/weeks/{week}/events'},
  week_talentpicks:{root:'core',path:'/seasons/{season}/types/{seasonType}/weeks/{week}/talentpicks'},
  season_leaders:{root:'core',path:'/seasons/{season}/types/{seasonType}/leaders'},
  standings:{root:'standings',path:'/standings'},
  team_news:{root:'site',path:'/news'},
  league_news:{root:'site',path:'/news'},
  league_injuries:{root:'site',path:'/injuries'},
  venues:{root:'core',path:'/venues'},
  transactions:{root:'core',path:'/transactions'},
  league_events:{root:'core',path:'/events'},
} as const
export type ExtendedEspnMode=keyof typeof extendedEspnRoutes
export type ExtendedEspnInput={
  mode:ExtendedEspnMode;sport:string;league:string;eventId?:string|undefined
  competitionId?:string|undefined;teamId?:string|undefined;athleteId?:string|undefined
  season?:number|undefined;seasonType?:number|undefined;week?:number|undefined;limit?:number|undefined
}
const digits=(raw:unknown,key:string):string=>{
  const value=String(raw??'')
  if(!/^\d{1,16}$/u.test(value))throw Error('ID ESPN inválido: '+key)
  return value
}
const number=(raw:unknown,key:string,min:number,max:number):string=>{
  if(typeof raw!=='number'||!Number.isSafeInteger(raw)||raw<min||raw>max)
    throw Error('Parámetro ESPN inválido: '+key)
  return String(raw)
}
const slug=(value:string,key:string):string=>{
  if(typeof value!=='string'||!/^[a-z0-9][a-z0-9._-]{0,45}$/u.test(value))
    throw Error('Slug ESPN inválido: '+key)
  return value
}
const roots={
  core:'https://sports.core.api.espn.com/v2/sports/',
  site:'https://site.api.espn.com/apis/site/v2/sports/',
  web:'https://site.web.api.espn.com/apis/common/v3/sports/',
  standings:'https://site.api.espn.com/apis/v2/sports/',
} as const
export function extendedEspnUrl(input:ExtendedEspnInput):string{
  const def=extendedEspnRoutes[input.mode]
  if(!def)throw Error('Modo ESPN extendido desconocido')
  const sport=slug(input.sport,'sport'),league=slug(input.league,'league')
  const vars:Record<string,string>={}
  for(const key of def.path.match(/\{([A-Za-z]+)\}/gu)??[]){
    const name=key.slice(1,-1)
    if(name==='season')vars[name]=number(input.season,name,1900,2100)
    else if(name==='seasonType')vars[name]=number(input.seasonType??2,name,0,4)
    else if(name==='week')vars[name]=number(input.week,name,1,65)
    else vars[name]=digits(input[name as keyof ExtendedEspnInput],name)
  }
  let path:string=def.path
  for(const [key,value] of Object.entries(vars))path=path.replace('{'+key+'}',value)
  const base=roots[def.root]+sport+(def.root==='core'?'/leagues/':'/')+league
  const url=new URL(base+path)
  if(input.mode==='team_news')url.searchParams.set('team',digits(input.teamId,'teamId'))
  if(input.mode==='team_schedule')url.searchParams.set('season',number(input.season,'season',1900,2100))
  if(input.mode==='athlete_splits')url.searchParams.set('season',number(input.season,'season',1900,2100))
  const defaultLimit=input.mode==='game_plays'?100:25
  if(input.limit!==undefined)url.searchParams.set('limit',number(input.limit,'limit',1,200))
  else if(def.root==='core')url.searchParams.set('limit',String(defaultLimit))
  return url.toString()
}
const compact=(raw:unknown,depth=0):unknown=>{
  if(depth>4)return '[truncated depth]'
  if(typeof raw==='string')return raw.slice(0,350)
  if(Array.isArray(raw))return raw.slice(0,6).map(v=>compact(v,depth+1))
  if(raw!==null&&typeof raw==='object'){
    const result:Record<string,unknown>={}
    for(const [key,value] of Object.entries(raw).slice(0,18))
      result[key]=compact(value,depth+1)
    return result
  }
  return raw
}
export async function readExtendedEspn(
  input:ExtendedEspnInput,getJSON:<T>(url:string)=>Promise<T>,
  now=Date.now(),
){
  const endpoint=extendedEspnUrl(input)
  const base={mode:input.mode,endpoint,checkedAt:new Date(now).toISOString(),
    source:'ESPN Site/Core/Web (no oficial, disponibilidad variable)',
    warning:'Las rutas del catálogo no están todas verificadas. Datos de pronosticadores, injuries o powerindex no prueban cuotas vigentes ni acierto propio.'}
  try{
    const data:unknown=await getJSON<unknown>(endpoint)
    const obj=data!==null&&typeof data==='object'&&!Array.isArray(data)
      ?data as Record<string,unknown>:{}
    const items=Array.isArray(obj.items)?obj.items:null
    const rows=items?.length??(Array.isArray(data)?data.length:Object.keys(obj).length?1:0)
    return {...base,status:rows>0?'data':'empty',count:typeof obj.count==='number'?obj.count:rows,
      snapshot:compact(items??data)}
  }catch(error){
    return {...base,status:'unavailable',count:0,snapshot:null,
      error:error instanceof Error?error.message.slice(0,200):'Error desconocido'}
  }
}
