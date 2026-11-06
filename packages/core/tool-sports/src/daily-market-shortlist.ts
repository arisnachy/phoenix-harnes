/** Cross-check real sportsbook menus with the verified daily slate before research.
 * Market consensus is not a prediction or an expected-value advantage.
 */
import type {MarketOutcome} from './sports.ts'
import type {scoutDailySports} from './daily-sports-scout.ts'

type Fixture=Awaited<ReturnType<typeof scoutDailySports>>['events'][number]
export type DailyMarketCandidate={
  sport:string;league:string;espnEventId:string;bookmakerEventId:string
  fixture:string;kickoff:string;bookmaker:string;market:'h2h'|'spreads'|'totals'
  selection:string;line:number|null;decimalOdds:number;marketNoVigShare:number
  bookmakerOverround:number;quoteUpdatedAt:string;source:string
  assessment:'quote-only-research-pending'
}
export type DailyMarketShortlist={
  goal:number;range:[number,number];complete:boolean;bookmaker:string|null
  matchesInSlate:number;eligibleMarkets:number;selected:DailyMarketCandidate[]
  rejectedQuotes:number;warning:string
}
const providerKeys:Readonly<Record<string,string>>={
  'basketball|nba':'basketball_nba',
  'basketball|wnba':'basketball_wnba',
  'baseball|mlb':'baseball_mlb',
  'hockey|nhl':'icehockey_nhl',
  'football|nfl':'americanfootball_nfl',
  'soccer|eng.1':'soccer_epl',
  'soccer|esp.1':'soccer_spain_la_liga',
  'soccer|mex.1':'soccer_mexico_ligamx',
  'soccer|usa.1':'soccer_usa_mls',
  'soccer|uefa.champions':'soccer_uefa_champs_league',
}
export const dailyOddsSportKey=(sport:string,league:string):string|null=>
  providerKeys[sport+'|'+league]??null

const normal=(value:string):string=>value.normalize('NFD')
  .replace(/[\u0300-\u036f]/gu,'').toLowerCase().replace(/[^a-z0-9]/gu,'')
const isDraw=(name:string)=>/^(draw|empate|tie|x)$/u.test(name.toLowerCase())
const groupKey=(fixture:Fixture,quote:MarketOutcome):string=>[
  fixture.sport,fixture.league,fixture.eventId,quote.bookmaker,quote.eventId,
  quote.market,quote.market==='spreads'&&typeof quote.point==='number'
    ?Math.abs(quote.point):quote.market==='totals'?quote.point??'':'',
].join('|')

/** Return up to six separate-match, same-bookmaker market observations for investigation.
 * @param fixtures - Upcoming games with validated ESPN IDs and participants.
 * @param quotes - Current bookmaker quotes from the existing provider adapters.
 * @param goal - Target number of observed choices, 4 to 6.
 * @param now - Evaluation instant for freshness and future kickoffs.
 * @returns A market shortlist only; no autonomous wager or predictive probability.
 */
export function shortlistDailyMarkets(
  fixtures:readonly Fixture[],quotes:readonly MarketOutcome[],
  goal=5,now=Date.now(),
):DailyMarketShortlist{
  if(!Number.isInteger(goal)||goal<4||goal>6)throw Error('Objetivo de 4 a 6 patas')
  const groups=new Map<string,{fixture:Fixture;quotes:MarketOutcome[]}>()
  let rejectedQuotes=0
  const matchedGames=new Set<string>()
  for(const quote of quotes.slice(0,2000)){
    const time=Date.parse(quote.timeIso??quote.time),at=Date.parse(quote.updatedAt)
    if(!quote.bookmaker?.trim()||!quote.source?.trim()||
      !['h2h','spreads','totals'].includes(quote.market)||
      !Number.isFinite(quote.price)||quote.price<=1||quote.price>1000||
      !Number.isFinite(at)||at>now||now-at>60*60_000||
      !Number.isFinite(time)||time<=now||!quote.sportKey){
      rejectedQuotes++;continue
    }
    const matches=fixtures.filter(game=>dailyOddsSportKey(game.sport,game.league)===quote.sportKey
      &&normal(game.home.name)===normal(quote.home)
      &&normal(game.away.name)===normal(quote.away)
      &&Math.abs(Date.parse(game.kickoff)-time)<=45*60_000)
    if(matches.length!==1){rejectedQuotes++;continue}
    const fixture=matches[0]!
    const key=groupKey(fixture,quote)
    const group=groups.get(key)??{fixture,quotes:[]}
    if(!group.quotes.some(q=>q.selection===quote.selection&&q.point===quote.point))
      group.quotes.push(quote)
    groups.set(key,group)
    matchedGames.add(fixture.sport+'|'+fixture.league+'|'+fixture.eventId)
  }
  const candidates:DailyMarketCandidate[]=[]
  for(const {fixture,quotes:rows} of groups.values()){
    if(rows.length<2||rows.length>3)continue
    const stamps=rows.map(q=>Date.parse(q.updatedAt))
    if(Math.max(...stamps)-Math.min(...stamps)>10*60_000)continue
    const market=rows[0]!.market
    const home=normal(fixture.home.name),away=normal(fixture.away.name)
    const labels=rows.map(q=>normal(q.selection))
    const twoTeams=labels.includes(home)&&labels.includes(away)
    const threeWay=fixture.sport==='soccer'
    let valid=false
    if(market==='h2h')
      valid=twoTeams&&(threeWay
        ?rows.length===3&&rows.some(q=>isDraw(q.selection))
        :rows.length===2)
    if(market==='spreads')
      valid=rows.length===2&&twoTeams&&rows.every(q=>typeof q.point==='number')
        &&rows[0]!.point===-rows[1]!.point
    if(market==='totals')
      valid=rows.length===2&&rows[0]!.point!==null
        &&rows[0]!.point!==undefined&&rows[0]!.point===rows[1]!.point
        &&labels.includes('over')&&labels.includes('under')
    if(!valid)continue
    const inverse=rows.map(q=>1/q.price),sum=inverse.reduce((a,b)=>a+b,0)
    if(!Number.isFinite(sum)||sum<=0)continue
    const options=rows.map((q,i)=>({quote:q,share:(inverse[i]??0)/sum}))
      .filter(x=>x.quote.price>=1.20&&x.quote.price<=4)
      .sort((a,b)=>b.share-a.share||a.quote.selection.localeCompare(b.quote.selection))
    const choice=options[0]
    if(!choice)continue
    const q=choice.quote
    candidates.push({
      sport:fixture.sport,league:fixture.league,espnEventId:fixture.eventId,
      bookmakerEventId:q.eventId,fixture:fixture.away.name+' vs '+fixture.home.name,
      kickoff:fixture.kickoff,bookmaker:q.bookmaker,market:market as DailyMarketCandidate['market'],
      selection:q.selection,line:q.point??null,decimalOdds:q.price,
      marketNoVigShare:Number(choice.share.toFixed(5)),
      bookmakerOverround:Number((sum-1).toFixed(5)),
      quoteUpdatedAt:q.updatedAt,source:q.source??'',
      assessment:'quote-only-research-pending',
    })
  }
  const perBook=new Map<string,DailyMarketCandidate[]>()
  for(const x of candidates)perBook.set(x.bookmaker,[...(perBook.get(x.bookmaker)??[]),x])
  const pick=(rows:DailyMarketCandidate[])=>{
    const sorted=[...rows].sort((a,b)=>b.marketNoVigShare-a.marketNoVigShare||
      b.quoteUpdatedAt.localeCompare(a.quoteUpdatedAt)||
      a.fixture.localeCompare(b.fixture))
    const used=new Set<string>(),chosen:DailyMarketCandidate[]=[]
    const take=(p:DailyMarketCandidate)=>{
      const event=p.sport+'|'+p.league+'|'+p.espnEventId
      if(chosen.length>=goal||used.has(event))return
      chosen.push(p);used.add(event)
    }
    // Surface real non-winner markets first so the researcher sees alternatives,
    // but do not interpret a bookmaker share as independent model probability.
    for(const market of ['totals','spreads'] as const){
      const option=sorted.find(x=>x.market===market)
      if(option)take(option)
    }
    // Then diversify by actual sport before adding a second match in one sport.
    const sports=[...new Set(sorted.map(x=>x.sport))]
    for(const sport of sports){
      if(chosen.some(x=>x.sport===sport))continue
      const option=sorted.find(x=>x.sport===sport)
      if(option)take(option)
    }
    for(const x of sorted)take(x)
    return chosen
  }
  const choices=[...perBook.entries()].map(([bookmaker,rows])=>({
    bookmaker,selected:pick(rows),
  })).sort((a,b)=>b.selected.length-a.selected.length||
    new Set(b.selected.map(x=>x.sport)).size-new Set(a.selected.map(x=>x.sport)).size||
    a.bookmaker.localeCompare(b.bookmaker))
  const best=choices[0]
  const selected=best?.selected??[]
  return {goal,range:[4,6],complete:selected.length>=goal,
    bookmaker:best?.bookmaker??null,matchesInSlate:matchedGames.size,
    eligibleMarkets:candidates.length,selected,rejectedQuotes,
    warning:'Solo preselección del mercado: marketNoVigShare procede de cuotas, NO de un modelo de acierto ni de valor esperado. Antes de proponer un ticket final confirma alineaciones, lesiones, titulares, porteros, contexto, reglas y probabilidad calibrada cuando exista. Si hay menos de cuatro ofertas válidas, informa la falta sin fabricar patas. No se ha realizado ninguna apuesta.'}
}
