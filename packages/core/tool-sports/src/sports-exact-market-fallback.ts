/**
 * Opt-in cross-provider market fallback for an exact future ESPN event.
 * Never map an unrelated provider event ID onto an ESPN event. Bookmaker
 * quotations retain their own IDs, origins and timestamps.
 */
import {getFeed,marketOddsDetailed,type MarketOutcome} from './sports.ts'
export type ExactMarketResult={
  status:'matched'|'unmatched'|'fixture-unverified'|'provider-unavailable'
  espnEventId:string;league:string;home:string|null;away:string|null
  kickoff:string|null;quotes:MarketOutcome[]
  sources:Array<{provider:string;status:string;count:number;detail:string}>
  reason:string
}
const leagues:Readonly<Record<string,[string,string]>>={
  basketball_nba:['basketball','nba'],basketball_wnba:['basketball','wnba'],
  americanfootball_nfl:['football','nfl'],baseball_mlb:['baseball','mlb'],
  icehockey_nhl:['hockey','nhl'],soccer_epl:['soccer','eng.1'],
  soccer_spain_la_liga:['soccer','esp.1'],soccer_mexico_ligamx:['soccer','mex.1'],
  soccer_usa_mls:['soccer','usa.1'],soccer_uefa_champs_league:['soccer','uefa.champions'],
}
const norm=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9 ]/gu,' ').replace(/\s+/gu,' ').trim()
const compareTeam=(a:string,b:string)=>{
  if(norm(a)===norm(b))return true
  const last=(text:string)=>norm(text).split(' ').at(-1)??''
  const aa=last(a),bb=last(b)
  return aa.length>=5&&aa===bb
}
const dateLocal=(time:number)=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date(time))
type FixtureEvent={
  id?:string|number;date?:string;status?:{type?:{state?:string}}
  competitions?:Array<{competitors?:Array<{homeAway?:string;team?:{displayName?:string}}>}>
}
function readFixture(event:FixtureEvent){
  const teams=event.competitions?.[0]?.competitors??[]
  return {home:teams.find(x=>x.homeAway==='home')?.team?.displayName??null,
    away:teams.find(x=>x.homeAway==='away')?.team?.displayName??null}
}
const supportedMarket=(name:string,requested:string,sportKey:string)=>{
  const want=requested.split(',')
  const market=name.toLowerCase()
  return (want.includes('h2h')&&(
    sportKey.startsWith('soccer_')?['1x2','h2h'].includes(market):
    ['h2h','moneyline','home_away','match_winner'].includes(market)))
    ||(want.includes('totals')&&market==='totals')
    ||(want.includes('spreads')&&market==='spreads')
}
/** Verify a provider quote against ESPN home/away and kickoff, not provider event ID. */
export function exactProviderQuote(
  quote:MarketOutcome,fixture:{home:string;away:string;kickoff:string},
  markets='h2h',sportKey='basketball_nba',now=Date.now(),
):boolean{
  const qt=Date.parse(quote.timeIso??quote.time),kickoff=Date.parse(fixture.kickoff)
  const updated=Date.parse(quote.updatedAt)
  if(!Number.isFinite(qt)||!Number.isFinite(kickoff)||!Number.isFinite(updated)
    ||kickoff<=now||qt<=now||Math.abs(kickoff-qt)>45*60_000
    ||updated>now+60_000||now-updated>60*60_000
    ||!Number.isFinite(quote.price)||quote.price<=1||quote.price>=1000
    ||!quote.bookmaker||!quote.bookmaker.trim()
    ||!quote.source||quote.source.toLowerCase().includes('espn')
    ||!supportedMarket(quote.market,markets,sportKey))return false
  if(!compareTeam(quote.home,fixture.home)||!compareTeam(quote.away,fixture.away))return false
  const selection=norm(quote.selection)
  if(['h2h','moneyline','home_away','match_winner','1x2'].includes(quote.market.toLowerCase())){
    return compareTeam(selection,fixture.home)||compareTeam(selection,fixture.away)
      ||(sportKey.startsWith('soccer_')&&['1x2','h2h'].includes(quote.market.toLowerCase())
        &&['draw','empate','tie'].includes(selection))
  }
  return quote.point!==undefined&&quote.point!==null&&Number.isFinite(quote.point)
}
/** Only explicitly requested sourcePolicy=all calls this path. */
export async function exactAlternativeOdds(
  sportKey:string,eventId:string,date:string,markets='h2h',
  env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch,now=Date.now(),
):Promise<ExactMarketResult>{
  const which=leagues[sportKey]
  if(!which||!/^\d{1,20}$/u.test(eventId)
    ||!/^\d{4}-\d{2}-\d{2}$/u.test(date)
    ||!Number.isFinite(Date.parse(date+'T00:00:00Z'))
    ||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)
    throw Error('Evento exacto ESPN o liga sin ruta verificada')
  const base={espnEventId:eventId,league:which[1],home:null,away:null,kickoff:null,
    quotes:[] as MarketOutcome[],sources:[] as ExactMarketResult['sources']}
  if(env.PHOENIX_SPORTS_ESPN_DISABLED==='1')return{...base,status:'fixture-unverified',
    reason:'ESPN deshabilitado por el operador; no cotejar IDs externos sin fixture oficial'}
  try{
    const next=new Date(Date.parse(date+'T00:00:00Z')+86_400_000)
      .toISOString().slice(0,10)
    const days=[date,next]
    const boards=await Promise.allSettled(days.map(day=>getFeed<{events?:FixtureEvent[]}>(
      'https://site.api.espn.com/apis/site/v2/sports/'+which[0]+'/'+which[1]+
      '/scoreboard?dates='+day.replaceAll('-',''),fetcher)))
    const events=boards.flatMap(x=>x.status==='fulfilled'&&Array.isArray(x.value.events)
      ?x.value.events:[])
    const fixture=events.find(x=>String(x.id??'')===eventId)
    if(!fixture)return{...base,status:'fixture-unverified',
      reason:'El ID solicitado no figura en las dos particiones ESPN; no vincular cuotas ajenas'}
    const {home,away}=readFixture(fixture)
    const kickoff=Date.parse(fixture.date??'')
    if(!home||!away||!Number.isFinite(kickoff)||kickoff<=now||dateLocal(kickoff)!==date
      ||fixture.status?.type?.state!=='pre')
      return{...base,home,away,kickoff:fixture.date??null,status:'fixture-unverified',
        reason:'Estado, equipos, fecha local u hora del partido no verificables como futuros'}
    const known={home,away,kickoff:fixture.date!}
    const observed=await marketOddsDetailed(sportKey,markets,env,fetcher,now)
    const eligible=observed.quotes.filter(q=>exactProviderQuote(q,known,markets,sportKey,now))
    // Soccer 'h2h' must be a complete THREE-way market (home/draw/away)
    // from the SAME bookmaker, event and source. Never create 1X2 from 2-way.
    const hasThreeWay=(q:MarketOutcome)=>eligible.some(x=>
      x.eventId===q.eventId&&x.bookmaker===q.bookmaker&&x.source===q.source
      &&x.market===q.market&&['draw','empate','tie'].includes(norm(x.selection)))
      &&eligible.some(x=>x.eventId===q.eventId&&x.bookmaker===q.bookmaker
        &&x.source===q.source&&compareTeam(x.selection,home))
      &&eligible.some(x=>x.eventId===q.eventId&&x.bookmaker===q.bookmaker
        &&x.source===q.source&&compareTeam(x.selection,away))
    const quotes=eligible.filter(q=>!sportKey.startsWith('soccer_')||
      !['h2h','1x2'].includes(q.market.toLowerCase())||hasThreeWay(q)).slice(0,40)
    return{...base,home,away,kickoff:fixture.date!,
      status:quotes.length?'matched':'unmatched',quotes,sources:observed.sources,
      reason:quotes.length?'Cuotas de proveedor externo cotejadas por equipos, mercado y UTC; IDs de casas conservados':
        'No hubo cotizaciones recientes del mismo partido en fuentes alternativas autorizadas'}
  }catch(e){
    return{...base,status:'provider-unavailable',
      reason:'Consulta secundaria fallida: '+String(e instanceof Error?e.message:e).slice(0,180)}
  }
}
