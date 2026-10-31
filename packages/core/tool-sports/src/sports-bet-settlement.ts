/** Provider-attributed sportsbook settlement preview.
 * Official match scores are evidence, NOT a house-confirmed wager or settlement.
 * Never apply a competitor's rulebook to another operator.
 */
import { getFeed,hasSportsPermission,sportsCatalog,discoverEspnLeagues } from './sports.ts'

type RecordValue=Record<string,unknown>
const obj=(value:unknown):RecordValue=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as RecordValue:{}
const arr=(value:unknown):unknown[]=>Array.isArray(value)?value:[]
const id=(value:unknown)=>/^\d{1,20}$/u.test(String(value??''))?String(value):''
const number=(value:unknown):number|null=>{
  if((typeof value!=='number'&&typeof value!=='string')||String(value).trim()==='')return null
  const result=Number(value)
  return Number.isFinite(result)&&result>=0&&result<=10000?result:null
}
const dateOK=(s:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(s)&&
  Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
  new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s
export type SportsMarketFamily=
  'moneyline'|'h2h'|'1x2'|'run_line'|'spread'|'total'|'team_total'|
  'first_3_total'|'first_5_total'|'first_3_spread'|'first_5_spread'|'player_prop'
export type SportsBetLeg={
  eventId:string;market:SportsMarketFamily;selection:'home'|'away'|'draw'|'over'|'under'|'yes'|'no'
  price:number;line?:number;team?:'home'|'away';playerId?:string
  bookmaker:string;reference?:string
}
export type SportsSettlementInput={
  sport:string;league:string;date:string;stake:number;legs:SportsBetLeg[]
  ticketReference?:string
}
export type SportsLegGrade={
  eventId:string;market:SportsMarketFamily;selection:string;bookmaker:string
  result:'won'|'lost'|'push'|'pending'|'unverifiable';reason:string
  eventState:string;score:string|null;source:'ESPN Site API'
}
const supported=new Set<SportsMarketFamily>([
  'moneyline','h2h','1x2','run_line','spread','total','team_total',
  'first_3_total','first_5_total','first_3_spread','first_5_spread','player_prop',
])
export function validateSportsSettlement(input:SportsSettlementInput):void{
  if(!Object.hasOwn(sportsCatalog,input.sport)||!/^[a-z][a-z-]{1,35}$/u.test(input.sport)
    ||!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(input.league)||!dateOK(input.date))
    throw Error('Deporte, liga o fecha inválidos')
  if(!Number.isFinite(input.stake)||input.stake<=0||input.stake>1_000_000)
    throw Error('Importe real de apuesta inválido')
  if(!Array.isArray(input.legs)||!input.legs.length||input.legs.length>12)
    throw Error('El ticket admite entre 1 y 12 selecciones')
  const operators=new Set(input.legs.map(leg=>leg.bookmaker.trim()))
  if(operators.size!==1||operators.has(''))
    throw Error('Se requiere la misma casa para todas las selecciones')
  if(/^juancito sport$/iu.test(input.legs[0]!.bookmaker.trim())&&input.stake<100)
    throw Error('Juancito Sport publica mínimo RD$100 por apuesta (términos 7.10)')
  for(const leg of input.legs){
    if(!id(leg.eventId)||!supported.has(leg.market)||!Number.isFinite(leg.price)
       ||leg.price<=1||leg.price>1000)
      throw Error('Evento, mercado o cuota no verificables')
    const side=['home','away','draw'].includes(leg.selection)
    const total=['over','under'].includes(leg.selection)
    if(leg.market==='player_prop'){
      if(!id(leg.playerId)||!['over','under','yes','no'].includes(leg.selection))
        throw Error('Prop de jugador sin identificador o selección válida')
    }else if(['total','team_total','first_3_total','first_5_total'].includes(leg.market)){
      if(!total)throw Error('Las altas/bajas exigen over o under')
    }else if(!side||leg.selection==='draw'&&leg.market!=='1x2')
      throw Error('Mercado de ganador o hándicap requiere local, visitante o empate 1X2')
    if(['run_line','spread','total','team_total','first_3_total','first_5_total',
      'first_3_spread','first_5_spread','player_prop'].includes(leg.market)&&
       (typeof leg.line!=='number'||!Number.isFinite(leg.line)||
        Math.abs(leg.line)>10000))
      throw Error('Línea de mercado ausente o inválida')
    if(typeof leg.line==='number'&&['run_line','spread','total','team_total',
      'first_3_total','first_5_total','first_3_spread','first_5_spread'].includes(leg.market)
      &&Math.abs(leg.line*2-Math.round(leg.line*2))>1e-8)
      throw Error('Línea asiática de cuarto de punto requiere semivictorias/semipérdidas y reglas propias; no se liquida como línea simple')
    if(leg.market==='team_total'&&!['home','away'].includes(leg.team??''))
      throw Error('Total de equipo sin identificar local o visitante')
  }
}
type Game={
  id:string;state:string;home:number|null;away:number|null
  homeInnings:(number|null)[];awayInnings:(number|null)[]
}
function innings(data:unknown):(number|null)[]{
  return arr(obj(data).linescores).slice(0,20).map(value=>number(obj(value).value??obj(value).displayValue))
}
function extractGame(raw:unknown):Game|null{
  const e=obj(raw),comp=obj(arr(e.competitions)[0]),sides=arr(comp.competitors)
  const h=sides.find(x=>obj(x).homeAway==='home'),a=sides.find(x=>obj(x).homeAway==='away')
  const idValue=id(e.id)
  if(!idValue||!h||!a)return null
  return {
    id:idValue,state:String(obj(obj(e.status).type).state??'unknown'),
    home:number(obj(h).score),away:number(obj(a).score),
    homeInnings:innings(h),awayInnings:innings(a),
  }
}
const compare=(value:number,threshold:number):'won'|'lost'|'push'=>
  value>threshold?'won':value<threshold?'lost':'push'
function gradeLeg(leg:SportsBetLeg,game:Game|undefined,isBaseballSport:boolean):SportsLegGrade{
  const common={
    eventId:leg.eventId,market:leg.market,selection:leg.selection,
    bookmaker:leg.bookmaker,source:'ESPN Site API' as const,
    eventState:game?.state??'unknown',
    score:game?.home!==null&&game?.home!==undefined&&game.away!==null?
      game.away+'-'+game.home:null,
  }
  const unknown=(result:'pending'|'unverifiable',reason:string)=>({ ...common,result,reason })
  if(!game)return unknown('unverifiable','El evento no aparece en la cartelera consultada')
  if(game.state!=='post')return unknown('pending','Partido no finalizado oficialmente')
  if(leg.market==='player_prop')return unknown('unverifiable',
    'Prop de jugador requiere boxscore oficial, elegibilidad y reglas propias de la casa')
  if(game.home===null||game.away===null)return unknown('unverifiable',
    'No hay un marcador final completo con ambos equipos')
  // A provider may mark an interrupted baseball game final. House rules
  // impose different inning thresholds for moneyline and full-game totals.
  // A scoreboard-only final without enough completed inning data is not settled.
  const needsBaseballInnings=isBaseballSport&&['run_line','total','team_total','first_3_total','first_5_total',
    'first_3_spread','first_5_spread'].includes(leg.market)
  const completeInnings=(side:'home'|'away',required:number)=>{
    const values=side==='home'?game.homeInnings:game.awayInnings
    return values.length>=required&&values.slice(0,required).every(v=>v!==null)
  }
  if(needsBaseballInnings&&['total','team_total'].includes(leg.market)){
    const loser=game.home<game.away?'home':game.away<game.home?'away':null
    const valid=loser?completeInnings(loser,9):
      completeInnings('home',9)&&completeInnings('away',9)
    if(!valid)return unknown('unverifiable',
      'La casa puede exigir novena entrada agotada por equipo perdedor; marcador final sin 9 innings verificables')
  }
  if(isBaseballSport&&['moneyline','h2h','run_line'].includes(leg.market)){
    const loser=game.home<game.away?'home':game.away<game.home?'away':null
    const valid=loser?completeInnings(loser,5):
      completeInnings('home',5)&&completeInnings('away',5)
    if(!valid)return unknown('unverifiable',
      'La casa puede exigir quinta entrada agotada por equipo perdedor; evidencia de inning no suficiente')
  }
  const period=leg.market.startsWith('first_3')?3:leg.market.startsWith('first_5')?5:null
  let home=game.home,away=game.away
  if(period){
    if(game.homeInnings.length<period||game.awayInnings.length<period)
      return unknown('unverifiable','Faltan innings completos del período para liquidar la línea')
    const h=game.homeInnings.slice(0,period),a=game.awayInnings.slice(0,period)
    if([...h,...a].some(x=>x===null))return unknown('unverifiable',
      'ESPN no publicó desglose completo del período')
    home=h.reduce<number>((n,x)=>n+(x??0),0)
    away=a.reduce<number>((n,x)=>n+(x??0),0)
  }
  let result:'won'|'lost'|'push'
  if(['moneyline','h2h','1x2'].includes(leg.market)){
    if(leg.selection==='draw')result=home===away?'won':'lost'
    else if(home===away)result=leg.market==='1x2'?'lost':'push'
    else result=(home>away)===(leg.selection==='home')?'won':'lost'
  }else if(['run_line','spread','first_3_spread','first_5_spread'].includes(leg.market)){
    const adjusted=(leg.selection==='home'?home:away)+(leg.line??0)
    result=compare(adjusted,leg.selection==='home'?away:home)
  }else{
    const total=leg.market==='team_total'?(leg.team==='home'?home:away):home+away
    result=compare(total,leg.line??0)
    if(leg.selection==='under')result=result==='won'?'lost':result==='lost'?'won':'push'
  }
  return { ...common,result,reason:'Resultado preliminar calculado desde marcador oficial; falta liquidación y posibles anulaciones de la casa' }
}
/** Return a provisional grading of observed results and theoretical payout, not a settled receipt.
 * Only a sportsbook's accepted receipt and ledger can confirm placement/payout.
 */
export async function checkSportsTicket(
  input:SportsSettlementInput,fetcher:typeof fetch=fetch,
  env:NodeJS.ProcessEnv=process.env,now=Date.now(),
){
  validateSportsSettlement(input)
  if(!hasSportsPermission('espn',env))throw Error('ESPN no autorizado')
  if(!sportsCatalog[input.sport]?.includes(input.league)&&
    !(await discoverEspnLeagues(input.sport,env,fetcher)).includes(input.league))
    throw Error('Liga sin verificación en ESPN')
  const url='https://site.api.espn.com/apis/site/v2/sports/'+input.sport+'/'+input.league+
    '/scoreboard?dates='+input.date.replaceAll('-','')
  const data=await getFeed<{ events?:unknown[] }>(url,fetcher)
  if(!Array.isArray(data.events))throw Error('ESPN no devolvió una cartelera verificable')
  const games=new Map(data.events.map(extractGame).filter((g):g is Game=>g!==null).map(g=>[g.id,g]))
  const grades=input.legs.map(leg=>gradeLeg(leg,games.get(leg.eventId),input.sport==='baseball'))
  const losing=grades.some(x=>x.result==='lost')
  const unresolved=grades.some(x=>x.result==='pending'||x.result==='unverifiable')
  const allVoid=grades.every(x=>x.result==='push')
  const status=losing?'lost-provisional':unresolved?'pending':allVoid?'refund-provisional':'won-provisional'
  const effectiveOdds=input.legs.reduce((value,leg,i)=>
    value*(grades[i]?.result==='push'?1:leg.price),1)
  const potentialReturn=Number((input.stake*effectiveOdds).toFixed(2))
  const provisionalReturn=unresolved?null:losing?0:allVoid?input.stake:potentialReturn
  return {
    checkedAt:new Date(now).toISOString(),provider:'ESPN Site API',
    sportsbook:input.legs[0]!.bookmaker,receiptReference:input.ticketReference??null,
    placementVerified:false,houseSettlementVerified:false,
    status,stake:input.stake,combinedOdds:Number(effectiveOdds.toFixed(5)),
    potentialReturn,provisionalReturn,
    profit:provisionalReturn===null?null:Number((provisionalReturn-input.stake).toFixed(2)),
    legs:grades,
    warnings:[
      'La consulta no verifica que la banca haya aceptado el ticket; un número introducido por usuario no constituye prueba de aceptación.',
      'Resultado preliminar. Aplicar reglamento contractual de la casa y verificar su historial/recibo antes de declarar ganado, perdido, push o pagado.',
      'Suspensiones, reglas de pitcher listado, cambio de alineación, plazos, período y overtime pueden alterar el dictamen.',
      'Props de jugador y mercados sin estadísticas oficiales suficientes nunca se liquidan por inferencia.',
      'Las selecciones correlacionadas o same-game parlays pueden tener precios conjuntos diferentes al producto de cuotas individuales.',
    ],
    sourceUrl:url,
  }
}
