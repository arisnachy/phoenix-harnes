/** Turn user-provided bet receipts into verified, match-bound PHOENIX live goals.
 * The ESPN fixture is verified; acceptance/odds/settlement by the bookmaker are NOT.
 * Never use a price-provider event ID as an ESPN event ID.
 */
import {getFeed,hasSportsPermission,sportsCatalog} from './sports.ts'

export type ReceiptLegInput={
  sport:string;league:string;date?:string;eventId?:string;
  team:string;opponent?:string;
  market:'moneyline'|'spread'|'total'|'three-way';
  side?:'over'|'under'|'draw';
  line?:number;americanOdds?:number
}
export type ReceiptInput={
  ticketReference:string;date:string;bookmaker:string;
  stake?:number;reportedReturn?:number;legs:ReceiptLegInput[]
}
type ProviderTeam={homeAway?:string;team?:{displayName?:string;name?:string}}
type ProviderEvent={id?:string|number;date?:string;
  competitions?:Array<{competitors?:ProviderTeam[]}>}
type Board={events?:ProviderEvent[]}
const dateOK=(s:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(s)&&
  !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').replace(/[^a-z0-9]/giu,'').toLowerCase()
const validName=(s:unknown):s is string=>typeof s==='string'&&s.trim().length>=2&&s.length<=120
const teamName=(event:ProviderEvent,side:'home'|'away')=>{
  const row=event.competitions?.[0]?.competitors?.find(x=>x.homeAway===side)?.team
  return row?.displayName??row?.name??''
}
function checkedDate(value:string):string{
  if(!dateOK(value))throw Error('Fecha inválida (AAAA-MM-DD)')
  return value
}
function gameDate(iso:string|undefined):string|null{
  if(!iso)return null
  const d=new Date(iso)
  if(!Number.isFinite(d.getTime()))return null
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',year:'numeric',
    month:'2-digit',day:'2-digit'}).format(d)
}
const displayHour=(iso:string)=>new Intl.DateTimeFormat('es-DO',{
  timeZone:'America/Santo_Domingo',dateStyle:'medium',timeStyle:'short',
}).format(new Date(iso))
function verifyLeg(x:ReceiptLegInput):void{
  if(!x||!Object.hasOwn(sportsCatalog,x.sport)||!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(x.league)
    ||!sportsCatalog[x.sport]?.includes(x.league)||!validName(x.team)
    ||x.opponent!==undefined&&!validName(x.opponent))
    throw Error('Deporte, liga o equipo sin identificar con precisión')
  if(x.eventId!==undefined&&!/^\d{1,20}$/u.test(x.eventId))throw Error('ID ESPN inválido')
  if(!['moneyline','spread','total','three-way'].includes(x.market))
    throw Error('Mercado fuera de los cuatro tipos compatibles con marcador')
  if((x.market==='total'&&(!x.opponent||!['over','under'].includes(x.side??'')))||
    (x.market==='three-way'&&x.side!==undefined&&x.side!=='draw')||
    (x.market!=='total'&&x.market!=='three-way'&&x.side!==undefined))
    throw Error('Selección sin condición o período compatible')
  if((x.market==='spread'||x.market==='total')&&
    (typeof x.line!=='number'||!Number.isFinite(x.line)||Math.abs(x.line)>10000))
    throw Error('El total/hándicap requiere línea numérica exacta')
  if(x.line!==undefined&&x.market!=='total'&&x.market!=='spread')
    throw Error('Línea no admitida en este mercado')
  if(x.americanOdds!==undefined&&(!Number.isInteger(x.americanOdds)||
      Math.abs(x.americanOdds)<100||Math.abs(x.americanOdds)>100000))
    throw Error('Cuota americana del recibo inválida')
}
export async function registerSportsReceipt(input:ReceiptInput,fetcher:typeof fetch=fetch,
  env:NodeJS.ProcessEnv=process.env,now=Date.now()){
  if(!hasSportsPermission('espn',env))throw Error('ESPN no autorizado')
  if(!input||!/^[a-zA-Z0-9-]{1,25}$/u.test(input.ticketReference??'')||
    !validName(input.bookmaker)||input.bookmaker.length>100)
    throw Error('Referencia de boleto u operador inválidos')
  checkedDate(input.date)
  if(input.stake!==undefined&&(!Number.isFinite(input.stake)||input.stake<0||input.stake>1e6)||
    input.reportedReturn!==undefined&&(!Number.isFinite(input.reportedReturn)||
      input.reportedReturn<0||input.reportedReturn>1e9))
    throw Error('Valores monetarios indicados inválidos')
  if(!Array.isArray(input.legs)||input.legs.length<1||input.legs.length>12)
    throw Error('Indica entre 1 y 12 selecciones extraídas del comprobante')
  for(const leg of input.legs){verifyLeg(leg);checkedDate(leg.date??input.date)}
  const cache=new Map<string,Board>()
  const used=new Set<string>()
  const legs=[]
  for(const leg of input.legs){
    const day=leg.date??input.date,key=leg.sport+'|'+leg.league+'|'+day
    let board=cache.get(key)
    if(!board){
      board=await getFeed<Board>('https://site.api.espn.com/apis/site/v2/sports/'+leg.sport+'/'+leg.league+
        '/scoreboard?dates='+day.replaceAll('-',''),fetcher)
      if(!Array.isArray(board.events))throw Error('ESPN no devolvió una cartelera verificable: '+key)
      cache.set(key,board)
    }
    const candidates=(board.events??[]).filter(e=>{
      const id=String(e.id??'')
      if(!/^\d{1,20}$/u.test(id)||leg.eventId&&leg.eventId!==id)return false
      if(gameDate(e.date)!==day)return false
      const home=teamName(e,'home'),away=teamName(e,'away')
      if(!home||!away||normalize(home)===normalize(away))return false
      const match=normalize(leg.team),opponent=leg.opponent?normalize(leg.opponent):''
      if(match!==normalize(home)&&match!==normalize(away))return false
      return !opponent||((opponent===normalize(home)||opponent===normalize(away))&&opponent!==match)
    })
    // Always reject zero or ambiguous matches. No guessed fixtures/markets.
    if(candidates.length!==1)throw Error('No se pudo vincular de forma inequívoca '+
      leg.team+' ('+key+'). Coincidencias '+candidates.length+'. Revisar evento, fecha y rival.')
    const event=candidates[0]!
    const eventId=String(event.id),home=teamName(event,'home'),away=teamName(event,'away')
    const normalizedTeam=normalize(leg.team)
    const selectedSide=normalizedTeam===normalize(home)?'home':'away'
    const side=leg.market==='total'?leg.side??'over':
      leg.market==='three-way'&&leg.side==='draw'?'draw':selectedSide
    const identity=key+'|'+eventId
    if(used.has(identity))throw Error('Un ticket no puede repetir el mismo partido sin precio conjunto verificado')
    used.add(identity)
    const label=side==='draw'?'Empate':leg.market==='total'
      ?(side==='over'?'Arriba ':'Abajo ')+String(leg.line):
        (selectedSide==='home'?home:away)+(leg.market==='spread'?' '+((leg.line??0)>=0?'+':'')+leg.line:'')
    legs.push({
      event:away+' vs '+home,homeTeam:home,awayTeam:away,
      selection:label,price:leg.americanOdds===undefined?'No informada':
        leg.americanOdds>0?'+'+leg.americanOdds:String(leg.americanOdds),
      bookmaker:input.bookmaker,when:displayHour(event.date!),sport:leg.sport,league:leg.league,
      providerLeague:leg.league,eventId,eventDate:day,market:leg.market,
      trackedBet:{receipt:input.ticketReference,market:leg.market,side,
        ...(leg.line!==undefined?{line:leg.line}:{})},
    })
  }
  const estimatedOdds=input.stake&&input.reportedReturn&&input.stake>0
    ?(input.reportedReturn/input.stake).toFixed(3):'No disponible'
  const uiBlock={
    component:'sports_ticket_card',version:1,props:{
      title:'Boleto #'+input.ticketReference+' · objetivos vinculados',
      subtitle:'Partidos cotejados con ESPN · recibo aportado por el usuario',
      ticketReference:input.ticketReference,
      source:'Comprobante aportado por el usuario + ESPN Site API · '+new Date(now).toISOString(),
      requestedLegs:legs.length,legs,combinedOdds:estimatedOdds,
      ...(input.stake===undefined?{}:{stake:input.stake.toFixed(2)}),
      ...(input.reportedReturn===undefined?{}:{grossReturn:input.reportedReturn.toFixed(2)}),
      note:'Partidos vinculados con ESPN y metas importadas sin formularios. El recibo y sus cuotas los aportó el usuario: ni el operador ni ESPN han confirmado aceptación, precio efectivo, período, anulaciones, liquidación o pago.',
    },
  }
  return {ticketReference:input.ticketReference,linked:legs.length,
    gamesVerified:true,operatorAcceptanceVerified:false,paymentVerified:false,
    uiBlock,linkedEvents:legs.map(l=>({eventId:l.eventId,sport:l.sport,league:l.league,
      date:l.eventDate,home:l.homeTeam,away:l.awayTeam,goal:l.trackedBet})),
    instruction:'Tarjeta de recibo visible y seguimiento automático en carteleras futuras del mismo navegador. NO pedir al usuario rellenar objetivos por partido. Distinguir vínculo ESPN de aceptación por la banca. Si faltan datos fiables, explicar qué selección quedó sin vincular en lugar de inventarla.',
  }
}
