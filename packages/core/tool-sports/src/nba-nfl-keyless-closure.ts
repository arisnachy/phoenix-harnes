/** No-key ESPN + official NBA/NFL reference coverage for each pregame leg.
 * Public feed reachability is NOT proof of a player being active or starting.
 * No odds, probabilities or confirmed lineups are manufactured here.
 */
export type TwoSport='nba'|'nfl'
export type PublicSource={
  id:string;url:string;kind:'automated-json'|'automated-csv'|'official-reference';
  covers:string[];limitation:string
}
const base=(league:TwoSport)=>'https://site.api.espn.com/apis/site/v2/sports/'+
  (league==='nba'?'basketball/nba':'football/nfl')
export const nbaNflPublicSources:readonly PublicSource[]=[
  {id:'espn-nba-injuries',url:base('nba')+'/injuries',kind:'automated-json',
    covers:['injury status','published report'],limitation:'Puede ir detrás del parte oficial; no confirma el quinteto'},
  {id:'espn-nba-scoreboard',url:base('nba')+'/scoreboard',kind:'automated-json',
    covers:['oponentes','horario','marcador'],limitation:'No certifica bajas'},
  {id:'espn-nba-depth',url:base('nba')+'/teams/{teamId}/depthcharts',kind:'automated-json',
    covers:['rotación proyectada'],limitation:'Depth chart no confirma cinco titulares'},
  {id:'espn-nba-summary',url:base('nba')+'/summary?event={eventId}',kind:'automated-json',
    covers:['boxscore','estadísticas','titulares cuando consten explícitos'],
    limitation:'Si el partido no inició, su ausencia de titulares no prueba disponibilidad'},
  {id:'espn-nba-player',url:'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{athleteId}/gamelog',kind:'automated-json',
    covers:['partidos y estadísticas individuales'],limitation:'Historial no demuestra minutos próximos'},
  {id:'nba-live-scoreboard',url:'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json',kind:'automated-json',
    covers:['calendario','marcador'],limitation:'CDN puede responder 403; no es fuente de lesiones'},
  {id:'nba-live-boxscore',url:'https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{nbaGameId}.json',kind:'automated-json',
    covers:['jugadores presentes','titulares de partido iniciado'],
    limitation:'Solo después de publicación y con ID NBA, nunca reutilizar ID ESPN'},
  {id:'nba-official-injuries',url:'https://official.nba.com/nba-injury-report-2026-27-season/',
    kind:'official-reference',covers:['participación probable','fuente oficial y actualización'],
    limitation:'Enlace oficial de PDF; esta integración no presume haber leído el último PDF'},
  {id:'espn-nfl-injuries',url:base('nfl')+'/injuries',kind:'automated-json',
    covers:['prácticas','estados de lesión'],limitation:'No sustituye lista oficial de inactivos'},
  {id:'espn-nfl-scoreboard',url:base('nfl')+'/scoreboard',kind:'automated-json',
    covers:['oponentes','récord','resultado'],limitation:'Un récord similar no justifica escoger ganador'},
  {id:'espn-nfl-depth',url:base('nfl')+'/teams/{teamId}/depthcharts',kind:'automated-json',
    covers:['QB proyectado','profundidad ofensiva y defensiva'],
    limitation:'QB1 de un depth chart NO está confirmado como titular'},
  {id:'espn-nfl-summary',url:base('nfl')+'/summary?event={eventId}',kind:'automated-json',
    covers:['snapshots','boxscore','QB y starters cuando consten explícitos'],
    limitation:'Un boxscore antiguo no confirma titularidad en el juego futuro'},
  {id:'nflverse-injuries',url:'https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_{season}.csv',
    kind:'automated-csv',covers:['informe semanal','segunda fuente de lesiones'],
    limitation:'CSV ya integrado en PHOENIX; no identifica inactivos definitivos'},
  {id:'nfl-official-injuries',url:'https://www.nfl.com/injuries/',kind:'official-reference',
    covers:['parte de entrenamientos','estados del juego'],
    limitation:'Referencia humana; el reporte de práctica NO confirma inactivos'},
] as const
export type DepthPreview={
  teamId:string;url:string;state:'observed'|'empty'|'unavailable'|'schema-mismatch';
  potentialNames:string[];candidateQB:string|null;confirmedStarters:false;
  httpStatus:number|null;checkedAt:string;detail:string
}
type JsonRow=Record<string,unknown>
const row=(v:unknown):JsonRow=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as JsonRow:{}
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[]
const txt=(v:unknown,max=90)=>typeof v==='string'?v.trim().slice(0,max):''
const validId=(v:string)=>/^\d{1,12}$/u.test(v)
const projection=(payload:unknown,league:TwoSport)=>{
  const found=new Map<string,{name:string;position:string;rank:number}>()
  let visited=0
  const walk=(value:unknown,position='',level=0):void=>{
    if(level>7||++visited>2500)return
    if(Array.isArray(value)){for(const item of value.slice(0,80))walk(item,position,level+1);return}
    if(value===null||typeof value!=='object')return
    const v=row(value)
    const athlete=row(v.athlete)
    const pos=txt(row(v.position).abbreviation??v.position??v.abbreviation)||
      position
    const candidate=Object.keys(athlete).length?athlete:v
    const name=txt(candidate.displayName??candidate.fullName??candidate.name)
    const rank=Number(v.rank??v.depth??v.order??0)
    if(name&&((league==='nfl'&&pos.toUpperCase()==='QB')||
      (league==='nba'&&['PG','SG','SF','PF','C','G','F'].includes(pos.toUpperCase())))){
      if(!found.has(name))found.set(name,{name,position:pos,rank:Number.isFinite(rank)?rank:0})
    }
    for(const key of ['depthchart','depthcharts','positions','athletes','items','entries','players','groups','children','roster']){
      if(v[key]!==undefined)walk(v[key],pos,level+1)
    }
  }
  walk(payload)
  return [...found.values()].sort((a,b)=>(a.rank||999)-(b.rank||999))
}
export function inspectDepthPayload(payload:unknown,league:TwoSport,teamId:string){
  const p=row(payload),id=txt(row(p.team).id??p.teamId??p.id)
  if(id&&validId(id)&&id!==teamId)
    return{state:'schema-mismatch' as const,names:[] as string[],qb:null as string|null,
      detail:'Respuesta corresponde a otro equipo'}
  const players=projection(payload,league)
  return{state:players.length?'observed' as const:'empty' as const,
    names:players.slice(0,16).map(x=>x.name),
    qb:league==='nfl'?players.find(x=>x.position.toUpperCase()==='QB')?.name??null:null,
    detail:players.length?'Depth chart proyectado; NO titulares confirmados':
      'El esquema consultado no contiene proyecciones verificables'}
}
/** Two targeted calls, bounded payload and timeout. 403/429/500 do not become data. */
export async function readNbaNflDepthPreviews(
  league:TwoSport,teamIds:readonly[string,string],
  fetcher:typeof fetch=fetch,now=Date.now(),
):Promise<[DepthPreview,DepthPreview]>{
  const read=async(teamId:string):Promise<DepthPreview>=>{
    const url=validId(teamId)?base(league)+'/teams/'+teamId+'/depthcharts':''
    const common={teamId,url,checkedAt:new Date(now).toISOString(),confirmedStarters:false as const}
    if(!url)return{...common,state:'unavailable' as const,potentialNames:[],
      candidateQB:null,httpStatus:null,detail:'ID ESPN de equipo no validado'}
    try{
      const response=await fetcher(url,{headers:{accept:'application/json'},
        signal:AbortSignal.timeout(4500)})
      if(!response.ok)return{...common,state:'unavailable' as const,potentialNames:[],
        candidateQB:null,httpStatus:response.status,detail:'ESPN HTTP '+response.status}
      if(Number(response.headers.get('content-length')||0)>1_500_000)
        return{...common,state:'unavailable' as const,potentialNames:[],
          candidateQB:null,httpStatus:response.status,detail:'Respuesta supera 1.5MB'}
      const payload:unknown=await response.json()
      const parsed=inspectDepthPayload(payload,league,teamId)
      return{...common,state:parsed.state,potentialNames:parsed.names,
        candidateQB:parsed.qb,httpStatus:response.status,detail:parsed.detail}
    }catch(error){
      return{...common,state:'unavailable' as const,potentialNames:[],
        candidateQB:null,httpStatus:null,
        detail:(error instanceof Error?error.message:String(error)).slice(0,110)}
    }
  }
  const [home,away]=await Promise.all(teamIds.map(read))
  return[home!,away!]
}
export type PickComparison={
  side:'home'|'away'|null;decision:'consider'|'discard'|'pending';
  argumentsFor:string[];argumentsAgainst:string[];missing:string[];
  calibrated:false;approvedForBetting:false
}
export type SideMeasures={
  name:string;wins:number;losses:number;games:number;restHours:number|null
  confirmedStarter:boolean;netMarginPerGame:number|null
}
/** Each argument must compare BOTH rivals. Identical records add ZERO edge.
 * This is a qualitative, fail-closed gate, NOT a probability or EV model.
 */
export function compareNbaNflCandidate(
  sport:TwoSport,home:SideMeasures,away:SideMeasures,
  side:'home'|'away'|null,
):PickComparison{
  const missing:string[]=[],argumentsFor:string[]=[],argumentsAgainst:string[]=[]
  if(side===null)return{side,decision:'pending',argumentsFor,
    argumentsAgainst:['No se identificó qué equipo eligió el boleto'],
    missing:['Mercado h2h con selección por equipo'],calibrated:false,approvedForBetting:false}
  const picked=side==='home'?home:away,opponent=side==='home'?away:home
  const pickedWin=picked.games>=3?picked.wins/picked.games:null
  const otherWin=opponent.games>=3?opponent.wins/opponent.games:null
  if(pickedWin!==null&&otherWin!==null){
    const diff=pickedWin-otherWin
    if(diff>.12)argumentsFor.push('Forma favorable: '+picked.name+' '+picked.wins+
      '-'+picked.losses+' vs '+opponent.name+' '+opponent.wins+'-'+opponent.losses)
    else if(diff<-.12)argumentsAgainst.push('Forma inferior: '+picked.wins+'-'+picked.losses+
      ' frente a '+opponent.wins+'-'+opponent.losses)
    else argumentsAgainst.push('Récords similares ('+picked.wins+'-'+picked.losses+
      ' vs '+opponent.wins+'-'+opponent.losses+'): NO respaldan elegir '+picked.name)
  }else missing.push('Muestra de al menos 3 encuentros finalizados por rival')
  if(picked.netMarginPerGame!==null&&opponent.netMarginPerGame!==null){
    const diff=picked.netMarginPerGame-opponent.netMarginPerGame
    if(diff>=5)argumentsFor.push('Diferencial neto por juego superior en '+
      diff.toFixed(1)+' puntos observados')
    if(diff<=-5)argumentsAgainst.push('Diferencial neto por juego inferior en '+
      Math.abs(diff).toFixed(1)+' puntos')
    if(Math.abs(diff)<5)argumentsAgainst.push('Margen neto sin ventaja amplia verificable')
  }else missing.push('Márgenes de anotación/concesión de ambos rivales')
  if(picked.restHours!==null&&opponent.restHours!==null){
    const delta=picked.restHours-opponent.restHours
    if(delta>=24)argumentsFor.push('Descansa '+Math.round(delta)+' horas más que el rival')
    if(delta<=-24)argumentsAgainst.push('Descansa '+Math.round(-delta)+' horas menos que el rival')
  }else missing.push('Descanso comparado y calendario de ambos equipos')
  if(!picked.confirmedStarter||!opponent.confirmedStarter)
    missing.push(sport==='nfl'?'QB1 de AMBOS equipos confirmado para este partido':
      'Quintetos de AMBOS equipos confirmados para este partido')
  // A plain 3-1 vs 3-1 comparison cannot become a positive pick.
  const disadvantage=argumentsAgainst.some(x=>/inferior/iu.test(x))
  const supported=argumentsFor.length>=2&&!disadvantage
  const decision:PickComparison['decision']=supported?'consider':
    argumentsFor.length===0?'discard':'pending'
  return{side,decision,argumentsFor,argumentsAgainst,missing,
    calibrated:false,approvedForBetting:false}
}
