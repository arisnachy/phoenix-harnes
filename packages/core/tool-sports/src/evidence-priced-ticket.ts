/** Quote only when independently researched fixtures match fresh, same-bookmaker prices.
 * No combined-odds claims across different bookmakers or historical sources.
 */
import { evidenceTicket } from './evidence-ticket.ts'
import { keylessEnabled,keylessOdds,type KeylessQuote } from './keyless-odds.ts'
import { marketOdds,pricedTicket,type ChatBlock,type MarketSelection,type MarketOutcome } from './sports.ts'

export type OddsAuditRow={
  source:string
  status:'disabled'|'not-configured'|'attempted'|'empty'|'observed'|'error'|'not-applicable'
  offers:number
  note:string
}
const audited=(source:string,status:OddsAuditRow['status'],offers:number,note:string):OddsAuditRow=>
  ({source,status,offers,note})
const normalize=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const routing:Record<string,{sport:string;market:string;oddsSportKey:string}>={
  soccer:{sport:'football',market:'1x2',oddsSportKey:'soccer_epl'},
  basketball:{sport:'basketball',market:'moneyline',oddsSportKey:'basketball_nba'},
  baseball:{sport:'baseball',market:'moneyline',oddsSportKey:'baseball_mlb'},
  football:{sport:'american-football',market:'moneyline',oddsSportKey:'americanfootball_nfl'},
  hockey:{sport:'ice-hockey',market:'home_away',oddsSportKey:'icehockey_nhl'},
  tennis:{sport:'tennis',market:'match_winner',oddsSportKey:'tennis_atp'},
}
const leagueSportKey:Record<string,string>={
  'eng.1':'soccer_epl','esp.1':'soccer_spain_la_liga','usa.1':'soccer_usa_mls',
  'uefa.champions':'soccer_uefa_champs_league','nba':'basketball_nba',
  'wnba':'basketball_wnba','mlb':'baseball_mlb','nfl':'americanfootball_nfl','nhl':'icehockey_nhl',
}
export async function evidencePricedTicket(
  count:number,date?:string,sport?:string,stake=0,now=Date.now(),
  env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch,
  quotesProvider?:(sport:string,market:string,day:string,env:NodeJS.ProcessEnv,now:number)=>Promise<KeylessQuote[]>,
  marketPreference:'winner'|'double_chance'='winner',
):Promise<{card:ChatBlock;priced:boolean;placed:false;complete:boolean;
  verifiedEvents:number;quotedLegs:number;missingQuotes:number;
  sourceAudit:OddsAuditRow[];approvedLegs:number;multisportSatisfied:boolean;
  explanation:string}>{
  const research=await evidenceTicket(count,date,sport,fetcher,now,env)
  const quoteAccess=[
    keylessEnabled(env)?'OddsHarvester habilitado (sujeto al acceso del sitio)':
      'OddsHarvester inactivo: requiere instalación y habilitación por el operador',
    env.THE_ODDS_API_KEY?.trim()?'The Odds API v4 configurada':'The Odds API v4 sin clave',
    env.THEODDSAPI_API_KEY?.trim()?'TheOddsAPI configurada':'TheOddsAPI sin clave',
    'ESPN: cuotas solo cuando el proveedor publique mercados con fecha',
  ].join(' · ')
  const researchCard:ChatBlock={...research.card,props:{...research.card.props,
    note:(String(research.card.props.note??'')+' Estado de fuentes de cuotas: '+quoteAccess+
      '. Los repositorios GitHub SportsbookReview/MLB son solo históricos.').slice(0,1000),
  }}
  const initialSources:OddsAuditRow[]=[
    audited('OddsHarvester',keylessEnabled(env)?'attempted':'disabled',0,
      keylessEnabled(env)?'El scraping local necesita CLI y acceso real al sitio.':
        'Scraping desactivado: PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED no está habilitado.'),
    audited('The Odds API v4',env.THE_ODDS_API_KEY?.trim()?'attempted':'not-configured',0,
      'Clave opcional; configurar no demuestra disponibilidad de precios.'),
    audited('TheOddsAPI',env.THEODDSAPI_API_KEY?.trim()?'attempted':'not-configured',0,
      'Servicio de cuotas opcional independiente.'),
    audited('ESPN Site/Core',env.PHOENIX_SPORTS_ESPN_DISABLED==='1'?'disabled':'attempted',0,
      'Solo se acepta precio identificado y con actualización verificable.'),
    audited('SportsbookReview/MLB GitHub históricos','not-applicable',0,
      'NO se consultan como cuota en vivo ni permiten generar combinadas actuales.'),
  ]
  const base={card:researchCard,priced:false as boolean,placed:false as const,
    complete:research.complete,verifiedEvents:research.verifiedEvents,
    quotedLegs:0,missingQuotes:count,sourceAudit:initialSources,
    multisportSatisfied:research.multisportSatisfied,approvedLegs:0,
    explanation:'Preselección ESPN, cuotas todavía NO verificadas: '+quoteAccess+
      '. Los archivos históricos no ofrecen precios para apostar hoy.'}
  // Even an incomplete 4/5 slate must audit the four real events for quotes;
  // otherwise 'no prices available' falsely implies the sources were checked.
  const day=date??new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now))
  const categories=[...new Set(research.events.map(e=>e.sport))]
  const sources=await Promise.allSettled(categories.map(async category=>{
    const route=routing[category]
    if(!route)return {category,quotes:[] as KeylessQuote[]}
    const market=category==='soccer'&&marketPreference==='double_chance'
      ?'double_chance':route.market
    const quotes=quotesProvider?await quotesProvider(route.sport,market,day,env,now):
      keylessEnabled(env)?await keylessOdds(route.sport,market,day,env,now):[]
    return {category,quotes}
  }))
  const keyless=sources.flatMap(s=>s.status==='fulfilled'?s.value.quotes:[])
  // Use the existing public ESPN and optional authenticated Odds API adapters
  // as a real second LIVE source, never the two historical GitHub archives.
  // Explicit double-chance selections are only supplied by a verified 1X/X2
  // market; do not relabel a winner moneyline as double chance.
  const leagues=[...new Map(research.events.map(e=>[e.league,e])).values()]
  const additional=quotesProvider?[]:await Promise.allSettled(leagues.map(async event=>{
    if(event.sport==='soccer'&&marketPreference==='double_chance')return [] as KeylessQuote[]
    const sportKey=leagueSportKey[event.league]??routing[event.sport]?.oddsSportKey
    if(!sportKey)return [] as KeylessQuote[]
    const lines=await marketOdds(sportKey,'h2h',env,fetcher)
    return lines.flatMap(q=>{
      const time=q.timeIso??''
      const updated=Date.parse(q.updatedAt)
      if(!Number.isFinite(Date.parse(time))||!Number.isFinite(updated)
        ||updated>now||now-updated>3_600_000)return []
      // Soccer 3-way victory must demonstrably include DRAW at this book.
      if(event.sport==='soccer'&&!lines.some(draw=>
        draw.eventId===q.eventId&&draw.bookmaker===q.bookmaker
        &&draw.market===q.market&&/^(?:draw|empate|tie)$/iu.test(draw.selection)))return []
      return [{
        eventId:q.eventId,bookmaker:q.bookmaker,
        market:event.sport==='soccer'?'1x2':'h2h',
        selection:q.selection,point:q.point??null,price:q.price,
        home:q.home,away:q.away,time,updatedAt:q.updatedAt,
        source:q.source??'Proveedor de cuotas público',sportKey,
      }] satisfies KeylessQuote[]
    })
  }))
  const all=[...keyless,...additional.flatMap(s=>s.status==='fulfilled'?s.value:[])]
  const groups:KeylessQuote[][]=research.events.map(event=>{
    const kickoff=Date.parse(event.kickoff)
    const doubleChance=event.sport==='soccer'&&marketPreference==='double_chance'
    const expectedMarket=doubleChance?'double_chance':event.sport==='soccer'?'1x2':'h2h'
    return all.filter(q=>{
      const updated=Date.parse(q.updatedAt),quoteKickoff=Date.parse(q.time)
      return Number.isFinite(kickoff)&&Number.isFinite(updated)&&Number.isFinite(quoteKickoff)
        &&Math.abs(kickoff-quoteKickoff)<=3_600_000
        &&now-updated>=0&&now-updated<=3_600_000
        &&typeof q.bookmaker==='string'&&q.bookmaker.trim().length>0
        &&typeof q.eventId==='string'&&q.eventId.length>0
        &&Number.isFinite(q.price)&&q.price>1&&q.price<1000
        &&normalize(q.home)===normalize(event.home)
        &&normalize(q.away)===normalize(event.away)
        &&q.market===expectedMarket
        &&(doubleChance?q.selection===(event.pick==='home'?'1X':'X2'):
          normalize(q.selection)===normalize(event.pick==='home'?event.home:event.away))
    })
  })
  const quotedLegs=groups.filter(g=>g.length>0).length
  if(quotedLegs!==count)return{...base,quotedLegs,missingQuotes:count-quotedLegs,
    explanation:'Tras consultar OddsHarvester cuando está habilitado y las fuentes ESPN/API opcionales para mercados compatibles, faltan cuotas recientes verificables para todos los partidos; no se fabrica una combinada.'}
  // A realistic combined price requires the SAME bookmaker to offer all legs.
  const common=groups.reduce<Set<string>>((set,rows,index)=>{
    const names=new Set(rows.map(q=>q.bookmaker))
    return index===0?names:new Set([...set].filter(book=>names.has(book)))
  },new Set())
  if(!common.size)return{...base,quotedLegs,missingQuotes:0,
    explanation:'Los precios corresponden a distintas casas sin un operador común; no se multiplican como si existiera una combinada disponible.'}
  const best=[...common].map(book=>{
    const choices=groups.map(rows=>rows.filter(q=>q.bookmaker===book)
      .sort((a,b)=>b.price-a.price)[0]).filter((q):q is KeylessQuote=>q!==undefined)
    return{book,choices,combined:choices.reduce((acc,q)=>acc*q.price,1)}
  }).filter(x=>x.choices.length===count).sort((a,b)=>b.combined-a.combined)[0]
  if(!best)return base
  const marketQuotes:MarketOutcome[]=best.choices.map((q,index)=>({
    eventId:q.eventId,bookmaker:q.bookmaker,market:q.market,selection:q.selection,point:q.point,
    price:q.price,home:q.home,away:q.away,time:q.time,updatedAt:q.updatedAt,
    source:q.source,sportKey:leagueSportKey[research.events[index]?.league??'']??routing[research.events[index]?.sport??'']?.oddsSportKey??'sports_keyless',
  }))
  const selections:MarketSelection[]=marketQuotes.map(q=>({
    eventId:q.eventId,bookmaker:q.bookmaker,market:q.market,selection:q.selection,point:q.point??null,
  }))
  const priced=pricedTicket(selections,marketQuotes,stake)
  // Do not discard verified fixture branding, league, or the reasoning in the
  // unpriced evidence ticket when attaching bookmaker prices.
  const original=Array.isArray(research.card.props.legs)?research.card.props.legs:[]
  const pricedRows=Array.isArray(priced.card.props.legs)?priced.card.props.legs:[]
  const legs=pricedRows.map((row,index)=>{
    const estimate=original[index],quote=best.choices[index]
    const prior=estimate&&typeof estimate==='object'&&!Array.isArray(estimate)
      ?estimate as Record<string,unknown>:{}
    const pricedRow=row&&typeof row==='object'&&!Array.isArray(row)
      ?row as Record<string,unknown>:{}
    return {...pricedRow,
      ...Object.fromEntries(['homeTeam','awayTeam','homeLogo','awayLogo','sport',
        'league','country','rationale','when'].filter(k=>typeof prior[k]==='string')
        .map(k=>[k,prior[k]])),
      ...(quote?{price:String(quote.price),bookmaker:quote.bookmaker,
        ...(quote.market==='double_chance'?{selection:quote.selection==='1X'
          ?'1X · Local o empate':'X2 · Visita o empate',
          market:'Doble oportunidad (1X/X2)',
          rationale:(String(prior.rationale??'').slice(0,420)+
            ' · Cobertura del empate; cuota verificada, riesgo vigente.').slice(0,480)}:{})}:{})}
  })
  const card:ChatBlock={...priced.card,props:{
    ...priced.card.props,legs,requestedLegs:count,
    subtitle:'Cuotas verificadas · '+best.book+' · análisis de forma con datos ESPN',
    note:'SIMULACIÓN, NO APUESTA REAL. '+(marketPreference==='double_chance'
      ?'Fútbol: la doble oportunidad cubre empate (1X/X2), NO asegura ganar. ':'')+
      'Formas y descanso históricos NO son probabilidades calibradas. Lesiones, alineaciones y disponibilidad exacta en la banca pendientes; cuotas variables. '+priced.warning,
    askPrompt:'Kira, comprueba lesiones, titulares, estadísticas específicas, correlación y vigencia de las '+count+' cuotas antes de recomendar este ticket.',
  }}
  return{card,priced:true,placed:false,complete:true,verifiedEvents:research.verifiedEvents,
    quotedLegs:count,missingQuotes:0,
    explanation:'Las '+count+' selecciones tienen cuota vigente y la misma casa '+best.book+
      '. El boleto conserva logos, análisis y riesgos por partido; NO es un modelo de acierto calibrado. Validar lesiones, titulares, restricciones y precios antes de apostar.'}
}
