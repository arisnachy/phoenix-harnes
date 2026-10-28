/** Quote only when independently researched fixtures match fresh, same-bookmaker prices.
 * No combined-odds claims across different bookmakers or historical sources.
 */
import { evidenceTicket } from './evidence-ticket.ts'
import { keylessEnabled,keylessOdds,type KeylessQuote } from './keyless-odds.ts'
import { pricedTicket,type ChatBlock,type MarketSelection,type MarketOutcome } from './sports.ts'

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
  explanation:string}>{
  const research=await evidenceTicket(count,date,sport,fetcher,now,env)
  const base={card:research.card,priced:false as boolean,placed:false as const,
    complete:research.complete,verifiedEvents:research.verifiedEvents,
    quotedLegs:0,missingQuotes:research.verifiedEvents,
    explanation:'Informe de investigación con eventos verificables, SIN cuotas actuales respaldadas por una misma casa.'}
  if(!research.complete||!keylessEnabled(env))return base
  const day=date??new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now))
  const categories=[...new Set(research.events.map(e=>e.sport))]
  const sources=await Promise.allSettled(categories.map(async category=>{
    const route=routing[category]
    if(!route)return {category,quotes:[] as KeylessQuote[]}
    const market=category==='soccer'&&marketPreference==='double_chance'
      ?'double_chance':route.market
    const quotes=quotesProvider?await quotesProvider(route.sport,market,day,env,now):
      await keylessOdds(route.sport,market,day,env,now)
    return {category,quotes}
  }))
  const all=sources.flatMap(s=>s.status==='fulfilled'?s.value.quotes:[])
  const groups:KeylessQuote[][]=research.events.map(event=>{
    const kickoff=Date.parse(event.kickoff)
    return all.filter(q=>{
      const updated=Date.parse(q.updatedAt),quoteKickoff=Date.parse(q.time)
      return Number.isFinite(kickoff)&&Number.isFinite(updated)&&Number.isFinite(quoteKickoff)
        &&Math.abs(kickoff-quoteKickoff)<=3_600_000
        &&now-updated>=0&&now-updated<=3_600_000
        &&normalize(q.home)===normalize(event.home)
        &&normalize(q.away)===normalize(event.away)
        &&(event.sport==='soccer'&&marketPreference==='double_chance'
          ?q.market==='double_chance'&&q.selection===(event.pick==='home'?'1X':'X2')
          :q.market!=='totals'&&normalize(q.selection)===
            normalize(event.pick==='home'?event.home:event.away))
    })
  })
  const quotedLegs=groups.filter(g=>g.length>0).length
  if(quotedLegs!==count)return{...base,quotedLegs,missingQuotes:count-quotedLegs,
    explanation:'Las cuotas disponibles no se corresponden de forma verificable con todos los partidos seleccionados; no se construye una combinada cotizada con precios faltantes.'}
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
      ...(quote?{price:quote.price.toFixed(2),bookmaker:quote.bookmaker,
        ...(quote.market==='double_chance'?{selection:quote.selection==='1X'
          ?'1X · Local o empate':'X2 · Visita o empate',
          market:'Doble oportunidad (1X/X2)',
          rationale:(String(prior.rationale??'').slice(0,175)+
            ' · Cobertura del empate; cuota verificada, riesgo vigente.').slice(0,240)}:{})}:{})}
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
