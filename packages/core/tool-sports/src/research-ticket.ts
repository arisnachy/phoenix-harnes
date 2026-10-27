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

type EspnTeam = {
  homeAway?:string
  team?:{ displayName?:string;name?:string;logo?:string;logos?:Array<{href?:string}> }
  records?:Array<{summary?:string}>
}
type EspnEvent = {
  id?:string|number
  date?:string
  status?:{ type?:{ state?:string } }
  competitions?:Array<{ competitors?:EspnTeam[] }>
}
type EspnBoard = { events?:EspnEvent[] }
const dateInSantoDomingo = ():string =>
  new Intl.DateTimeFormat('en-CA',{ timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit' })
    .format(new Date())
const validDay = (raw:string):boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return false
  const date = new Date(raw+'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===raw
}
const clean = (value:string,length:number):string =>
  value.replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,length)
const leagueInfo:Record<string,{ sport:string;country?:string;league:string }>={
  'eng.1':{ sport:'Fútbol',country:'Inglaterra',league:'Premier League' },
  'esp.1':{ sport:'Fútbol',country:'España',league:'LaLiga' },
  'mex.1':{ sport:'Fútbol',country:'México',league:'Liga MX' },
  'usa.1':{ sport:'Fútbol',country:'Estados Unidos / Canadá',league:'MLS' },
  'uefa.champions':{ sport:'Fútbol',country:'Europa',league:'Champions League' },
  'mlb':{ sport:'Béisbol',league:'MLB' },
  'nba':{ sport:'Baloncesto',league:'NBA' },
  'wnba':{ sport:'Baloncesto',league:'WNBA' },
  'nfl':{ sport:'Fútbol americano',league:'NFL' },
  'nhl':{ sport:'Hockey',league:'NHL' },
}
const sportLabel:Record<string,string>={
  soccer:'Fútbol',baseball:'Béisbol',basketball:'Baloncesto',
  football:'Fútbol americano',hockey:'Hockey',
}
const whenLocal = (value:string):string=>
  new Intl.DateTimeFormat('es-DO',{ timeZone:'America/Santo_Domingo',dateStyle:'medium',timeStyle:'short' })
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
  requestedLegs = Array.isArray(selections)?selections.length:0,
  allowPartial = false,
  preloadedBoards?:Map<string,EspnBoard>,
):Promise<{ card:ChatBlock;verifiedEvents:number;priced:false;placed:false;complete:boolean }> {
  if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado por configuración del operador')
  if(!validDay(requestedDate))throw Error('Fecha de ticket inválida (AAAA-MM-DD)')
  if(!Array.isArray(selections)||selections.length<1||selections.length>6)throw Error('El ticket de pronósticos requiere entre 1 y 6 selecciones')
  if(!Number.isInteger(requestedLegs)||requestedLegs<1||requestedLegs>6)throw Error('Indica entre 1 y 6 patas')
  if((!allowPartial&&selections.length!==requestedLegs)||selections.length>requestedLegs){
    throw Error('Ticket incompleto: solicitaste '+requestedLegs+' patas y recibí '+selections.length+
      '. Investiga más encuentros antes de generar el ticket.')
  }
  const cache=preloadedBoards??new Map<string,EspnBoard>()
  const seen=new Set<string>()
  const legs:Array<Record<string,string>>=[]
  for(const raw of selections){
    const candidate: unknown = raw
    if(candidate===null||typeof candidate!=='object')throw Error('Selección inválida')
    const selection = candidate as ResearchTicketLeg
    const { sport,league,eventId,pick }=selection
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
    const trustedLogo=(url?:string):string|undefined=>
      env.PHOENIX_SPORTS_IMAGES_DISABLED!=='1'&&url&&/^https:\/\/a\.espncdn\.com\//u.test(url)?url:undefined
    const homeLogo=trustedLogo(home?.logo??home?.logos?.[0]?.href)
    const awayLogo=trustedLogo(away?.logo??away?.logos?.[0]?.href)
    legs.push({
      event:clean(awayName+' vs '+homeName,180),
      homeTeam:clean(homeName,100),
      awayTeam:clean(awayName,100),
      selection:clean(label,140),
      price:'Por verificar',
      bookmaker:'Sin casa confirmada',
      when:whenLocal(event.date??''),
      sport:info?.sport??sportLabel[sport]??sport,
      league:info?.league??league,
      ...(info?.country?{ country:info.country }:{}),
      market:sport==='soccer'?'1X2 · Pronóstico':'Ganador · Pronóstico',
      ...(homeLogo?{homeLogo}:{}),...(awayLogo?{awayLogo}:{}),
      ...(reason?{ rationale:reason }:{}),
    })
  }
  const complete=legs.length===requestedLegs
  return {
    verifiedEvents:legs.length,priced:false,placed:false,complete,
    card:{ component:'sports_ticket_card',version:1,props:{
      title:complete?'PHOENIX · Ticket de pronósticos':'PHOENIX · Borrador incompleto',
      subtitle:complete?'Selecciones verificadas · Previa sin cotización':
        'Solo '+legs.length+' de '+requestedLegs+' patas verificadas; NO es el ticket solicitado.',
      requestedLegs,
      source:'ESPN Site API · cartelera consultada '+new Date(now).toISOString(),
      legs,combinedOdds:'No disponible',
      note:(complete?'':'TICKET INCOMPLETO: faltan '+(requestedLegs-legs.length)+' patas verificadas. ')+
        'PRONÓSTICO ORIENTATIVO, SIN APUESTA REAL. Los partidos se confirmaron en ESPN, pero no se verificaron cuotas ni casas. Los argumentos de Kira son hipótesis y deben contrastarse antes de apostar. No se calcula retorno ni probabilidad conjunta.',
      askPrompt:'Kira, busca precios vigentes para estas selecciones con el operador identificado y valida la información antes de generar un ticket cotizado.',
    } },
  }
}

/** Candidates come only from ESPN fixtures and reported win-loss records, never synthetic IDs.
 * A simple record comparison is a transparent heuristic, NOT a calibrated predictive model.
 * Returns a visibly incomplete draft when fewer than the requested legs have evidence.
 */
export async function autoResearchTicket(
  count:number,
  requestedDate=dateInSantoDomingo(),
  fetcher:typeof fetch=fetch,
  now=Date.now(),
  env:NodeJS.ProcessEnv=process.env,
):Promise<{ card:ChatBlock;verifiedEvents:number;priced:false;placed:false;complete:boolean }> {
  if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado por configuración del operador')
  if(!validDay(requestedDate))throw Error('Fecha de ticket inválida (AAAA-MM-DD)')
  if(!Number.isInteger(count)||count<1||count>6)throw Error('Indica entre 1 y 6 patas')

  const leagues=[
    ['basketball','nba'],['football','nfl'],['hockey','nhl'],
    ['soccer','eng.1'],['soccer','esp.1'],['soccer','uefa.champions'],
    ['baseball','mlb'],['basketball','wnba'],
  ] as const
  const boards=new Map<string,EspnBoard>()
  const candidates:Array<{leg:ResearchTicketLeg;edge:number}>=[]
  const jobs=await Promise.allSettled(leagues.map(async([sport,league])=>{
    const url='https://site.api.espn.com/apis/site/v2/sports/'+sport+'/'+league+
      '/scoreboard?dates='+requestedDate.replaceAll('-','')
    const board=await getFeed<EspnBoard>(url,fetcher)
    if(!Array.isArray(board.events))throw Error('ESPN no confirmó la cartelera de '+league)
    return {sport,league,board}
  }))
  for(const job of jobs){
    if(job.status!=='fulfilled')continue
    const {sport,league,board}=job.value
    boards.set(sport+'|'+league,board)
    for(const event of board.events??[]){
      const kickoff=new Date(event.date??'')
      if(!/^\d{1,20}$/u.test(String(event.id??''))||!Number.isFinite(kickoff.getTime())||kickoff.getTime()<=now
        ||(event.status?.type?.state!==undefined&&event.status.type.state!=='pre'))continue
      const teams=event.competitions?.[0]?.competitors
      const home=teams?.find(team=>team.homeAway==='home')
      const away=teams?.find(team=>team.homeAway==='away')
      if(!home?.team?.displayName&&!home?.team?.name || !away?.team?.displayName&&!away?.team?.name)continue
      const record=(team:EspnTeam):{wins:number;losses:number;name:string}|null=>{
        const match=team.records?.map(x=>x.summary??'')
          .find(x=>/^\d{1,3}-\d{1,3}$/u.test(x))?.match(/^(\d+)-(\d+)$/u)
        if(!match)return null
        const wins=Number(match[1]),losses=Number(match[2])
        if(wins+losses<1)return null
        return {wins,losses,name:clean(team.team?.displayName??team.team?.name??'',75)}
      }
      const h=record(home),a=record(away)
      if(!h||!a)continue
      // Laplace smoothing avoids treating a 1-0 early-season record as certainty.
      const hp=(h.wins+1)/(h.wins+h.losses+2)
      const ap=(a.wins+1)/(a.wins+a.losses+2)
      const difference=hp-ap
      if(Math.abs(difference)<0.055)continue
      const winner=difference>0?h:a
      const loser=difference>0?a:h
      candidates.push({
        edge:Math.abs(difference),
        leg:{ sport,league,eventId:String(event.id),pick:difference>0?'home':'away',
          rationale:clean('Tendencia descriptiva: '+winner.name+' '+winner.wins+'-'+winner.losses+
            ' ante '+loser.name+' '+loser.wins+'-'+loser.losses+
            '. Muestra inicial; no considera bajas, rivales ni cuotas. No es probabilidad de ganar.',240) },
      })
    }
  }
  candidates.sort((a,b)=>b.edge-a.edge||a.leg.eventId.localeCompare(b.leg.eventId))
  const chosen=candidates.slice(0,count).map(x=>x.leg)
  if(!chosen.length)throw Error('No hay eventos futuros con registros contrastables suficientes para proponer un ticket; no inventaré patas.')
  return researchTicket(chosen,requestedDate,fetcher,now,env,count,true,boards)
}
