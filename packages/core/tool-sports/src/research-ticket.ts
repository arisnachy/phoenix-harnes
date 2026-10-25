/** Ticket de pronósticos con encuentros verificables aunque falten cuotas comerciales. */
import { getFeed, hasSportsPermission, sportsCatalog, type ChatBlock } from './sports.ts'

/** Selección propuesta por Kira, independiente de cualquier precio de apuestas. */
export type ResearchTicketLeg = {
  sport: string
  league: string
  eventId: string
  pick: 'home' | 'away' | 'draw'
  rationale?: string
}

type EspnTeam = {homeAway?:string;team?:{displayName?:string;name?:string}}
type EspnEvent = {
  id?:string|number
  date?:string
  status?:{type?:{state?:string}}
  competitions?:Array<{competitors?:EspnTeam[]}>
}
type EspnBoard = {events?:EspnEvent[]}
const dateInSantoDomingo = ():string =>
  new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit'})
    .format(new Date())
const validDay = (raw:string):boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return false
  const date = new Date(raw+'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===raw
}
const clean = (value:string,length:number):string =>
  value.replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,length)
const leagueInfo:Record<string,{sport:string;country?:string;league:string}>={
  'eng.1':{sport:'Fútbol',country:'Inglaterra',league:'Premier League'},
  'esp.1':{sport:'Fútbol',country:'España',league:'LaLiga'},
  'mex.1':{sport:'Fútbol',country:'México',league:'Liga MX'},
  'usa.1':{sport:'Fútbol',country:'Estados Unidos / Canadá',league:'MLS'},
  'uefa.champions':{sport:'Fútbol',country:'Europa',league:'Champions League'},
  'mlb':{sport:'Béisbol',league:'MLB'},
  'nba':{sport:'Baloncesto',league:'NBA'},
  'wnba':{sport:'Baloncesto',league:'WNBA'},
  'nfl':{sport:'Fútbol americano',league:'NFL'},
  'nhl':{sport:'Hockey',league:'NHL'},
}
const sportLabel:Record<string,string>={
  soccer:'Fútbol',baseball:'Béisbol',basketball:'Baloncesto',
  football:'Fútbol americano',hockey:'Hockey',
}
const whenLocal = (value:string):string=>
  new Intl.DateTimeFormat('es-DO',{timeZone:'America/Santo_Domingo',dateStyle:'medium',timeStyle:'short'})
    .format(new Date(value))

/**
 * Produce un ticket visual de investigación usando solo partidos próximos de ESPN.
 * No calcula cuotas combinadas, retornos ni atribuye casas de apuestas.
 * @param selections - Entre una y seis selecciones, todas con evento y liga identificados.
 * @param requestedDate - Fecha del calendario local dominicano.
 * @param fetcher - Transporte HTTP inyectable para las pruebas.
 * @param now - Instante de validación; permite pruebas deterministas.
 * @param env - Política de proveedores del operador de Phoenix.
 * @returns Tarjeta nativa y lista de partidos validados; nunca una apuesta real.
 */
export async function researchTicket(
  selections: ResearchTicketLeg[],
  requestedDate = dateInSantoDomingo(),
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
):Promise<{card:ChatBlock;verifiedEvents:number;priced:false;placed:false}> {
  if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado por configuración del operador')
  if(!validDay(requestedDate))throw Error('Fecha de ticket inválida (AAAA-MM-DD)')
  if(!Array.isArray(selections)||selections.length<1||selections.length>6)throw Error('El ticket de pronósticos requiere entre 1 y 6 selecciones')
  const cache=new Map<string,EspnBoard>()
  const seen=new Set<string>()
  const legs:Array<Record<string,string>>=[]
  for(const selection of selections){
    if(!selection||typeof selection!=='object')throw Error('Selección inválida')
    const {sport,league,eventId,pick}=selection
    if(typeof sport!=='string'||typeof league!=='string'||typeof eventId!=='string'||typeof pick!=='string'
      || !Object.hasOwn(sportsCatalog,sport) || !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(league)
      || !sportsCatalog[sport]?.includes(league) || !/^\d{1,20}$/u.test(eventId)
      || !['home','away','draw'].includes(pick) || (pick==='draw' && sport!=='soccer')){
      throw Error('Selecciona un evento real, liga admitida y mercado ganador/empate válido')
    }
    if(selection.rationale!==undefined&&(typeof selection.rationale!=='string'||selection.rationale.length>240)){
      throw Error('Fundamento del pronóstico inválido')
    }
    const identity=sport+'|'+league+'|'+eventId
    if(seen.has(identity))throw Error('Encuentro duplicado: el ticket de pronósticos admite una selección por partido')
    seen.add(identity)
    const key=sport+'|'+league
    let board=cache.get(key)
    if(!board){
      const url='https://site.api.espn.com/apis/site/v2/sports/'+sport+'/'+league+'/scoreboard?dates='+requestedDate.replaceAll('-','')
      board=await getFeed<EspnBoard>(url,fetcher)
      if(!Array.isArray(board.events))throw Error('ESPN no confirmó la cartelera para '+league)
      cache.set(key,board)
    }
    const event=board.events?.find(e=>String(e.id??'')===eventId)
    if(!event)throw Error('Partido no encontrado en la cartelera verificada de '+league)
    const kickoff=new Date(event.date??'')
    if(!Number.isFinite(kickoff.getTime())||kickoff.getTime()<=now||(event.status?.type?.state!==undefined && event.status.type.state!=='pre')){
      throw Error('Encuentro iniciado o finalizado: no se incluye en un ticket previo al partido')
    }
    const teams=event.competitions?.[0]?.competitors
    const home=teams?.find(team=>team.homeAway==='home')?.team
    const away=teams?.find(team=>team.homeAway==='away')?.team
    const homeName=home?.displayName??home?.name
    const awayName=away?.displayName??away?.name
    if(!homeName||!awayName)throw Error('ESPN no publicó los nombres de ambos equipos')
    const info=leagueInfo[league]
    const label=pick==='draw'?'Empate':pick==='home'?homeName:awayName
    const reason=clean(selection.rationale??'',240)
    legs.push({
      event:clean(awayName+' vs '+homeName,180),
      selection:clean(label,140),
      price:'Por verificar',
      bookmaker:'Sin casa confirmada',
      when:whenLocal(event.date??''),
      sport:info?.sport??sportLabel[sport]??sport,
      league:info?.league??league,
      ...(info?.country?{country:info.country}:{}),
      market:sport==='soccer'?'1X2 · Pronóstico':'Ganador · Pronóstico',
      ...(reason?{rationale:reason}:{}),
    })
  }
  return {
    verifiedEvents:legs.length,priced:false,placed:false,
    card:{component:'sports_ticket_card',version:1,props:{
      title:'PHOENIX · Ticket de pronósticos',
      subtitle:'Selecciones sobre eventos verificados · Previa sin cotización',
      source:'ESPN Site API · cartelera consultada '+new Date(now).toISOString(),
      legs,combinedOdds:'No disponible',
      note:'PRONÓSTICO ORIENTATIVO, SIN APUESTA REAL. Los partidos se confirmaron en ESPN, pero no se verificaron cuotas ni casas. Los argumentos de Kira son hipótesis y deben contrastarse antes de apostar. No se calcula retorno ni probabilidad conjunta.',
      askPrompt:'Kira, busca precios vigentes para estas selecciones con el operador identificado y valida la información antes de generar un ticket cotizado.',
    }},
  }
}
