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
  outcomes:Array<{selection:string;line:number|null;decimalOdds:number;noVigShare:number}>
  bookmakerOverround:number;quoteUpdatedAt:string;source:string
  /** Public ESPN observation, distinct from a verified bookmaker update. */
  observedAt:string;timestampSource:'espn-observation'|'bookmaker-update'
  assessment:'quote-only-research-pending'
  /** An older ESPN observation is visible, but needs a new price read before completion. */
  requiresRecheck?:boolean;observationAgeMinutes?:number
}
export type DailyMarketShortlist={
  goal:number;range:[number,number];complete:boolean;bookmaker:string|null
  matchesInSlate:number;eligibleMarkets:number;selected:DailyMarketCandidate[]
  alternatives:DailyMarketCandidate[];rejectedQuotes:number;warning:string
  matchDiagnostics:{invalidQuote:number;unmatchedFixture:number;
    incompleteMarket:number;timestampConflict:number;invalidMarketSides:number;
    unsupportedCandidatePrice:number;requiresRefresh:number}
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
  'soccer|uefa.wchampions':'soccer_uefa_womens_champions_league',
  'soccer|ger.1':'soccer_germany_bundesliga',
  'soccer|ita.1':'soccer_italy_serie_a',
  'soccer|fra.1':'soccer_france_ligue_one',
  'soccer|por.1':'soccer_portugal_primeira_liga',
  'soccer|ned.1':'soccer_netherlands_eredivisie',
  'soccer|bra.1':'soccer_brazil_campeonato',
  'soccer|arg.1':'soccer_argentina_primera_division',
  'soccer|uefa.europa':'soccer_uefa_europa_league',
  'soccer|fifa.world':'soccer_fifa_world_cup',
}
export const dailyOddsSportKey=(sport:string,league:string):string|null=>
  providerKeys[sport+'|'+league]??null

/** Audit all active quote-supported leagues before deciding which sports to investigate.
 * A league with more verified games receives inventory priority, but EVERY
 * active sport gets a first pass. This plans research, not betting picks.
 */
export function planDailyOddsLeagueKeys(fixtures:readonly Fixture[],limit=18):string[]{
  if(!Number.isInteger(limit)||limit<1||limit>32)
    throw Error('Límite de 1 a 32 ligas de cuotas')
  const leagues=new Map<string,{key:string;sport:string;games:number;first:string}>()
  for(const fixture of fixtures){
    const key=dailyOddsSportKey(fixture.sport,fixture.league)
    if(!key)continue
    const entry=leagues.get(key)??{key,sport:fixture.sport,games:0,first:fixture.kickoff}
    entry.games++
    if(fixture.kickoff<entry.first)entry.first=fixture.kickoff
    leagues.set(key,entry)
  }
  const ranked=[...leagues.values()].sort((a,b)=>
    b.games-a.games||a.first.localeCompare(b.first)||a.key.localeCompare(b.key))
  const chosen:string[]=[]
  const represented=new Set<string>()
  for(const row of ranked){
    if(represented.has(row.sport))continue
    chosen.push(row.key);represented.add(row.sport)
    if(chosen.length===limit)return chosen
  }
  for(const row of ranked){
    if(chosen.length>=limit)break
    if(!chosen.includes(row.key))chosen.push(row.key)
  }
  return chosen
}


/** Winner-only analysis must not ask free bookmakers for premium spreads/totals.
 * The absence of a bookmaker response does not affect fixture research.
 */
export const requestedDailyOddsMarkets=(winnerOnly:boolean):
  'h2h'|'h2h,spreads,totals'=>winnerOnly?'h2h':'h2h,spreads,totals'

const aliases:Readonly<Record<string,string>>={
  laclippers:'losangelesclippers',nyknicks:'newyorkknicks',
  okcthunder:'oklahomacitythunder',gswarriors:'goldenstatewarriors',
  lakings:'losangeleskings',nyrangers:'newyorkrangers',
  arizonadbacks:'arizonadiamondbacks',arizonadbacksmlb:'arizonadiamondbacks',
  mancity:'manchestercity',manutd:'manchesterunited',
  manunited:'manchesterunited',intermilan:'internazionale',
  psg:'parissaintgermain',parissaintgermainfc:'parissaintgermain',
}
const normal=(value:string):string=>{
  const key=value.normalize('NFD')
    .replace(/[\u0300-\u036f]/gu,'').toLowerCase().replace(/[^a-z0-9]/gu,'')
  return aliases[key]??key
}
const isDraw=(name:string)=>/^(draw|empate|tie|x)$/u.test(name.toLowerCase())
const quoteClock=(quote:MarketOutcome):number=>{
  const espn=quote.source?.startsWith('ESPN')===true
  return Date.parse(espn&&quote.observedAt?quote.observedAt:quote.updatedAt)
}
/** A previous ESPN read may remain visible, but must be refetched by exact
 * event ID before an automatically issued complete research ticket.
 */
export const espnQuoteNeedsRecheck=(quote:MarketOutcome,now=Date.now()):boolean=>{
  if(quote.source?.startsWith('ESPN')!==true)return false
  const observed=Date.parse(quote.observedAt??'')
  return !Number.isFinite(observed)||observed>now||now-observed>30*60_000
}
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
 * @param researchPool - Optional larger pool (up to 16) to investigate before choosing 5–6.
 * @returns A market shortlist only; no autonomous wager or predictive probability.
 */
export function shortlistDailyMarkets(
  fixtures:readonly Fixture[],quotes:readonly MarketOutcome[],
  goal=5,now=Date.now(),researchPool=goal,
):DailyMarketShortlist{
  if(!Number.isInteger(goal)||goal<4||goal>6)throw Error('Objetivo de 4 a 6 patas')
  if(!Number.isInteger(researchPool)||researchPool<goal||researchPool>16)
    throw Error('Reserva de investigación desde objetivo hasta 16 eventos')
  const groups=new Map<string,{fixture:Fixture;quotes:MarketOutcome[]}>()
  let rejectedQuotes=0
  const matchDiagnostics={invalidQuote:0,unmatchedFixture:0,incompleteMarket:0,
    timestampConflict:0,invalidMarketSides:0,unsupportedCandidatePrice:0,requiresRefresh:0}
  const matchedGames=new Set<string>()
  for(const quote of quotes.slice(0,2000)){
    const time=Date.parse(quote.timeIso??quote.time),at=quoteClock(quote)
    const espnObservation=quote.source?.startsWith('ESPN')===true&&
      Number.isFinite(Date.parse(quote.observedAt??''))
    // Never age out a published ESPN observation solely because it is old.
    // Old observations are explicitly marked for a live recheck downstream.
    const expired=!espnObservation&&now-at>60*60_000
    if(!quote.bookmaker?.trim()||!quote.source?.trim()||
      !['h2h','spreads','totals'].includes(quote.market)||
      !Number.isFinite(quote.price)||quote.price<=1||quote.price>1000||
      !Number.isFinite(at)||at>now||expired||
      !Number.isFinite(time)||time<=now||!quote.sportKey){
      rejectedQuotes++;matchDiagnostics.invalidQuote++;continue
    }
    const matches=fixtures.filter(game=>(dailyOddsSportKey(game.sport,game.league)===quote.sportKey||
      (game.sport==='soccer'&&quote.sportKey==='soccer_espn_dynamic'&&
        /^\d{1,16}$/u.test(quote.eventId)&&quote.eventId===game.eventId))
      &&normal(game.home.name)===normal(quote.home)
      &&normal(game.away.name)===normal(quote.away)
      &&Math.abs(Date.parse(game.kickoff)-time)<=45*60_000)
    if(matches.length!==1){
      rejectedQuotes++;matchDiagnostics.unmatchedFixture++;continue
    }
    const fixture=matches[0]!
    const key=groupKey(fixture,quote)
    const group=groups.get(key)??{fixture,quotes:[]}
    const previous=group.quotes.findIndex(q=>
      q.selection===quote.selection&&q.point===quote.point)
    if(previous<0)group.quotes.push(quote)
    else if(quoteClock(quote)>quoteClock(group.quotes[previous]!))
      group.quotes[previous]=quote
    groups.set(key,group)
    matchedGames.add(fixture.sport+'|'+fixture.league+'|'+fixture.eventId)
  }
  const candidates:DailyMarketCandidate[]=[]
  for(const {fixture,quotes:rows} of groups.values()){
    if(rows.length<2||rows.length>3){matchDiagnostics.incompleteMarket++;continue}
    const stamps=rows.map(quoteClock)
    if(Math.max(...stamps)-Math.min(...stamps)>10*60_000){
      matchDiagnostics.timestampConflict++;continue
    }
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
      valid=rows.length===2&&twoTeams
        &&typeof rows[0]?.point==='number'&&typeof rows[1]?.point==='number'
        &&rows[0].point===-rows[1].point
    if(market==='totals')
      valid=rows.length===2&&rows[0]!.point!==null
        &&rows[0]!.point!==undefined&&rows[0]!.point===rows[1]!.point
        &&labels.includes('over')&&labels.includes('under')
    if(!valid){matchDiagnostics.invalidMarketSides++;continue}
    const inverse=rows.map(q=>1/q.price),sum=inverse.reduce((a,b)=>a+b,0)
    if(!Number.isFinite(sum)||sum<=0)continue
    const options=rows.map((q,i)=>({quote:q,share:(inverse[i]??0)/sum}))
      // Very short genuine favorites remain research candidates; value/risk
      // is assessed later, not silently erased by an arbitrary odds floor.
      .filter(x=>x.quote.price>=1.01&&x.quote.price<=4)
      .sort((a,b)=>b.share-a.share||a.quote.selection.localeCompare(b.quote.selection))
    const choice=options[0]
    if(!choice){matchDiagnostics.unsupportedCandidatePrice++;continue}
    const q=choice.quote
    const requiresRecheck=rows.some(row=>espnQuoteNeedsRecheck(row,now))
    if(requiresRecheck)matchDiagnostics.requiresRefresh++
    candidates.push({
      requiresRecheck,observationAgeMinutes:Number(((now-quoteClock(q))/60_000).toFixed(1)),
      sport:fixture.sport,league:fixture.league,espnEventId:fixture.eventId,
      bookmakerEventId:q.eventId,fixture:fixture.away.name+' vs '+fixture.home.name,
      kickoff:fixture.kickoff,bookmaker:q.bookmaker,market:market as DailyMarketCandidate['market'],
      selection:q.selection,line:q.point??null,decimalOdds:q.price,
      marketNoVigShare:Number(choice.share.toFixed(5)),
      outcomes:rows.map((item,i)=>({
        selection:item.selection,line:item.point??null,decimalOdds:item.price,
        noVigShare:Number(((inverse[i]??0)/sum).toFixed(5)),
      })),
      bookmakerOverround:Number((sum-1).toFixed(5)),
      quoteUpdatedAt:q.updatedAt,source:q.source??'',
      observedAt:new Date(quoteClock(q)).toISOString(),
      timestampSource:q.source?.startsWith('ESPN')&&q.observedAt?
        'espn-observation':'bookmaker-update',
      assessment:'quote-only-research-pending',
    })
  }
  const perBook=new Map<string,DailyMarketCandidate[]>()
  for(const x of candidates)perBook.set(x.bookmaker,[...(perBook.get(x.bookmaker)??[]),x])
  const pick=(rows:DailyMarketCandidate[])=>{
    // Discovery must not rank a bet by implied chance (or automatically
    // surface totals/+1.5 first). All authentic market families for an event
    // are researched before the final choice is made.
    const marketPriority:Record<DailyMarketCandidate['market'],number>={
      h2h:0,totals:1,spreads:2,
    }
    // Provider fetch order is not sporting merit. Audit moneylines first,
    // then paired/fresh market favorites; specialist evidence decides later.
    const sorted=[...rows].sort((a,b)=>
      Number(a.requiresRecheck)-Number(b.requiresRecheck)||
      marketPriority[a.market]-marketPriority[b.market]||
      b.marketNoVigShare-a.marketNoVigShare||
      a.kickoff.localeCompare(b.kickoff)||a.fixture.localeCompare(b.fixture))
    const used=new Set<string>(),chosen:DailyMarketCandidate[]=[]
    const take=(p:DailyMarketCandidate)=>{
      const event=p.sport+'|'+p.league+'|'+p.espnEventId
      if(chosen.length>=researchPool||used.has(event))return
      chosen.push(p);used.add(event)
    }
    // Diversify by actual sport before filling the pool; not by a bookmaker's
    // favorite or by market type. Two opposite market sides stay in outcomes.
    // All alternative families for each chosen fixture are compared later.
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
  // Preserve real alternate lines as well as market families for each researched fixture.
  // Historical evidence is gathered ONCE per event before choosing a market,
  // so the user is not restricted to the first bookmaker-favorite selection.
  const eventKey=(p:DailyMarketCandidate)=>p.sport+'|'+p.league+'|'+p.espnEventId
  const alternatives=selected.flatMap(chosen=>{
    const eligible=(perBook.get(best!.bookmaker)??[])
      .filter(x=>eventKey(x)===eventKey(chosen)&&x!==chosen)
      .sort((a,b)=>Number(a.market===chosen.market)-Number(b.market===chosen.market)||
        b.observedAt.localeCompare(a.observedAt)||
        a.market.localeCompare(b.market))
    const lines=new Set([chosen.market+'|'+String(chosen.line)])
    const extra:DailyMarketCandidate[]=[]
    for(const option of eligible){
      const key=option.market+'|'+String(option.line)
      if(lines.has(key))continue
      lines.add(key);extra.push(option)
      if(extra.length>=4)break
    }
    return extra
  })
  return {goal,range:[4,6],complete:selected.length>=goal,
    bookmaker:best?.bookmaker??null,matchesInSlate:matchedGames.size,
    eligibleMarkets:candidates.length,selected,alternatives,rejectedQuotes,
    matchDiagnostics,
    warning:'Las observaciones ESPN antiguas se conservan para estudio, pero requieren nueva lectura antes del boleto final. Solo preselección del mercado: marketNoVigShare procede de cuotas, NO de un modelo de acierto ni de valor esperado. Antes de proponer un ticket final confirma alineaciones, lesiones, titulares, porteros, contexto, reglas y probabilidad calibrada cuando exista. Si hay menos de cuatro ofertas válidas, informa la falta sin fabricar patas. No se ha realizado ninguna apuesta.'}
}
