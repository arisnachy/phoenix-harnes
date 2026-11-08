/** Quote only when independently researched fixtures match fresh, same-bookmaker prices.
 * No combined-odds claims across different bookmakers or historical sources.
 */
import { evidenceTicket } from './evidence-ticket.ts'
import {investigateTicketSpecialists,type SpecialistGate} from './ticket-specialist-gate.ts'
import { keylessEnabled,keylessOdds,type KeylessQuote } from './keyless-odds.ts'
import { marketOddsDetailed,pricedTicket,type ChatBlock,type MarketSelection,type MarketOutcome } from './sports.ts'
import {fetchBetBetterModels,findModelOpinion,type ModelForecast} from './betbetter-model-evidence.ts'

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
  specialistResearcher:typeof investigateTicketSpecialists=investigateTicketSpecialists,
):Promise<{card:ChatBlock;priced:boolean;placed:false;complete:boolean;
  verifiedEvents:number;quotedLegs:number;missingQuotes:number;
  sourceAudit:OddsAuditRow[];approvedLegs:number;multisportSatisfied:boolean;
  specialistChecks:SpecialistGate[];researchedLegs:number;
  modelAudit:Array<{eventId:string;status:'support'|'contradiction'|'unavailable';
    prediction:ModelForecast|null}>;
  explanation:string}>{
  const research=await evidenceTicket(count,date,sport,fetcher,now,env)
  const day=date??new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now))
  // A winner picked from records cannot bypass the discipline-specific dossier.
  // Review each selected fixture before attaching even one bookmaker quote.
  const specialistChecks=await specialistResearcher(research.events.map(e=>({
    sport:e.sport,league:e.league,eventId:e.eventId,date:day,
    home:e.home,away:e.away,kickoff:e.kickoff,
  })),fetcher,now,env)
  const researchedLegs=specialistChecks.filter(x=>x.status==='researched').length
  const specialistComplete=research.events.length===count&&researchedLegs===count
  // Independent, openly licensed probabilities are a second opinion only.
  // They are NEVER bookmaker quotations, approval, or calibrated PHOENIX EV.
  const modelKeys=[...new Set(research.events.map(e=>leagueSportKey[e.league]).filter(
    (x):x is string=>Boolean(x)))]
  const modelResults=await Promise.allSettled(modelKeys.map(key=>
    fetchBetBetterModels(key,fetcher,now)))
  const forecasts=modelResults.flatMap(x=>x.status==='fulfilled'?x.value:[])
  const modelAudit=research.events.map(e=>({
    eventId:e.eventId,...findModelOpinion(forecasts,e),
  }))
  const modelDisagreements=modelAudit.filter(x=>x.status==='contradiction').length
  const quoteAccess=[
    keylessEnabled(env)?'OddsHarvester habilitado (sujeto al acceso del sitio)':
      'OddsHarvester inactivo: requiere instalación y habilitación por el operador',
    env.THE_ODDS_API_KEY?.trim()?'The Odds API v4 configurada':'The Odds API v4 sin clave',
    env.THEODDSAPI_API_KEY?.trim()?'TheOddsAPI configurada':'TheOddsAPI sin clave',
    env.THERUNDOWN_API_KEY?.trim()?'TheRundown configurado':'TheRundown sin clave',
    env.SPORTSGAMEODDS_API_KEY?.trim()?'SportsGameOdds configurado':'SportsGameOdds sin clave',
    'ESPN: cuotas solo cuando el proveedor publique mercados con fecha',
  ].join(' · ')
  const researchCard:ChatBlock={...research.card,props:{...research.card.props,
    note:(String(research.card.props.note??'')+' Especialistas consultados '+researchedLegs+'/'+count+
      '. Contradicciones de modelo independiente: '+modelDisagreements+
      '. Bet Better son probabilidades teóricas, NUNCA cuotas de bookmaker. Estado de fuentes de cuotas: '+quoteAccess+
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
    audited('TheRundown',env.THERUNDOWN_API_KEY?.trim()?'attempted':'not-configured',0,
      'Gratis con clave, cuotas prepartido 5 min retrasadas y límite de datapoints.'),
    audited('SportsGameOdds',env.SPORTSGAMEODDS_API_KEY?.trim()?'attempted':'not-configured',0,
      'Gratis con clave y límites del plan; fuente por bookmaker.'),
    audited('ESPN Site/Core',env.PHOENIX_SPORTS_ESPN_DISABLED==='1'?'disabled':'attempted',0,
      'Solo se acepta precio identificado y con actualización verificable.'),
    audited('SportsbookReview/MLB GitHub históricos','not-applicable',0,
      'NO se consultan como cuota en vivo ni permiten generar combinadas actuales.'),
  ]
  const base={card:researchCard,priced:false as boolean,placed:false as const,
    complete:research.complete&&specialistComplete,verifiedEvents:research.verifiedEvents,
    quotedLegs:0,missingQuotes:count,sourceAudit:initialSources,
    specialistChecks,researchedLegs,modelAudit,
    multisportSatisfied:research.multisportSatisfied,approvedLegs:0,
    explanation:'Preselección ESPN, cuotas todavía NO verificadas: '+quoteAccess+
      '. Los archivos históricos no ofrecen precios para apostar hoy.'}
  // Even an incomplete 4/5 slate must audit the four real events for quotes;
  // otherwise 'no prices available' falsely implies the sources were checked.
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
  const fallbackSources:Awaited<ReturnType<typeof marketOddsDetailed>>['sources']=[]
  const additional=quotesProvider?[]:await Promise.allSettled(leagues.map(async event=>{
    if(event.sport==='soccer'&&marketPreference==='double_chance')return [] as KeylessQuote[]
    const sportKey=leagueSportKey[event.league]??routing[event.sport]?.oddsSportKey
    if(!sportKey)return [] as KeylessQuote[]
    const report=await marketOddsDetailed(sportKey,'h2h',env,fetcher,now)
    fallbackSources.push(...report.sources)
    const lines=report.quotes
    return lines.flatMap(q=>{
      const time=q.timeIso??''
      const updated=Date.parse(q.updatedAt)
      const delayedSource=q.source==='TheRundown'||q.source==='SportsGameOdds'
      const observedAt=Date.parse(q.observedAt??'')
      const currentSnapshot=delayedSource&&Number.isFinite(observedAt)&&
        observedAt<=now&&now-observedAt<=15*60_000
      const validBookTime=Number.isFinite(updated)&&updated<=now&&
        now-updated<7*86_400_000
      if(!Number.isFinite(Date.parse(time))||
        !(currentSnapshot?validBookTime:
          Number.isFinite(updated)&&updated<=now&&now-updated<=3_600_000))return []
      // Soccer 3-way victory must demonstrably include DRAW at this book.
      if(event.sport==='soccer'&&!lines.some(draw=>
        draw.eventId===q.eventId&&draw.bookmaker===q.bookmaker
        &&draw.market===q.market&&/^(?:draw|empate|tie)$/iu.test(draw.selection)))return []
      return [{
        eventId:q.eventId,bookmaker:q.bookmaker,
        market:event.sport==='soccer'?'1x2':'h2h',
        selection:q.selection,point:q.point??null,price:q.price,
        home:q.home,away:q.away,time,updatedAt:q.updatedAt,
        observedAt:currentSnapshot?q.observedAt:undefined,
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
      const source=q.source==='TheRundown'||q.source==='SportsGameOdds'
      const observedAt=Date.parse(q.observedAt??'')
      const snapshotValid=source&&Number.isFinite(observedAt)&&
        now-observedAt>=0&&now-observedAt<=15*60_000
      const quoteAge=now-updated
      return Number.isFinite(kickoff)&&Number.isFinite(updated)&&Number.isFinite(quoteKickoff)
        &&Math.abs(kickoff-quoteKickoff)<=3_600_000
        &&quoteAge>=0&&(snapshotValid?quoteAge<7*86_400_000:quoteAge<=3_600_000)
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
  const attributed=(source:string)=>source.toLowerCase().includes('oddsharvester')?'OddsHarvester':
    source==='The Odds API'?'The Odds API v4':
    source==='TheOddsAPI'?'TheOddsAPI':
    source.toLowerCase().includes('espn')?'ESPN Site/Core':source
  const observed=new Map<string,number>(),matched=new Map<string,number>()
  for(const q of all)observed.set(attributed(q.source),(observed.get(attributed(q.source))??0)+1)
  for(const group of groups)for(const q of group)
    matched.set(attributed(q.source),(matched.get(attributed(q.source))??0)+1)
  const actualKeyless=categories.length>0&&(keylessEnabled(env)||Boolean(quotesProvider))
  const keylessFailures=sources.filter(s=>s.status==='rejected').length
  const fallbackEligible=!quotesProvider&&leagues.some(e=>
    !(e.sport==='soccer'&&marketPreference==='double_chance'))
  const fallbackFailures=additional.filter(s=>s.status==='rejected').length
  const sourceAudit:OddsAuditRow[]=initialSources.map(row=>{
    const offers=observed.get(row.source)??0
    const evidence=matched.get(row.source)??0
    if(offers)return{...row,status:'observed',offers,
      note:'Se observaron '+offers+' precios publicados; '+evidence+
        ' coinciden con selecciones investigadas (no son garantías).'}
    const providerAttempts=fallbackSources.filter(x=>x.provider===row.source)
    if(providerAttempts.length&&row.source!=='OddsHarvester'){
      const failure=providerAttempts.find(x=>x.status==='error')
      const attempted=providerAttempts.some(x=>x.status==='empty'||x.status==='observed')
      return{...row,status:failure?'error':attempted?'empty':'not-configured',offers:0,
        note:failure?'Error de proveedor: '+failure.detail.slice(0,190):
          attempted?'Consultado, sin precio válido y coincidente.':
          row.note+' Liga no cubierta o clave ausente.'}
    }
    if(row.source==='OddsHarvester'&&actualKeyless)return{...row,
      status:keylessFailures?'error':'empty',offers:0,
      note:keylessFailures?'El scraper no pudo consultar los mercados; revisar CLI y acceso.':
        'Consulta realizada sin precios válidos disponibles.'}
    if(fallbackEligible&&row.source==='The Odds API v4'&&env.THE_ODDS_API_KEY?.trim())
      return{...row,status:fallbackFailures?'error':'empty',note:
        'Ruta de cuotas v4 seleccionada; no se obtuvo precio coincidente y reciente.'}
    if(fallbackEligible&&row.source==='TheOddsAPI'&&!env.THE_ODDS_API_KEY?.trim()
      &&env.THEODDSAPI_API_KEY?.trim())return{...row,
      status:fallbackFailures?'error':'empty',note:'Proveedor secundario sin precios válidos cotejables.'}
    if(fallbackEligible&&row.source==='ESPN Site/Core'&&!env.THE_ODDS_API_KEY?.trim()
      &&!env.THEODDSAPI_API_KEY?.trim()&&!keylessEnabled(env))return{...row,
      status:fallbackFailures?'error':'empty',note:'ESPN consultado para precios; ninguno verificable.'}
    return{...row,status:row.status==='attempted'?'not-applicable':row.status,
      note:row.note+' Sin cotizaciones confirmadas en este flujo.'}
  })
  const auditSummary=' Cuotas cotejadas: '+quotedLegs+'/'+count+
    ' selecciones; proveedores: '+sourceAudit.map(x=>x.source+' '+x.status+
    ' ('+x.offers+' observaciones)').join('; ')+'.'
  const auditCard:ChatBlock={...researchCard,props:{...researchCard.props,
    note:(auditSummary+' '+String(researchCard.props.note??'')).slice(0,1000),
  }}
  const checked={...base,card:auditCard,sourceAudit,quotedLegs,
    missingQuotes:count-quotedLegs}
  if(!specialistComplete)return{...checked,complete:false,
    explanation:'Borrador INCOMPLETO: '+researchedLegs+'/'+count+
      ' expedientes deportivos individuales suficientemente documentados. '+
      specialistChecks.filter(x=>x.status!=='researched').map(x=>
        x.sport+' '+x.eventId+': '+x.pendingSteps.slice(0,2).join('; ')).join(' | ')+
      '. No se cotiza ticket como investigación completa.'}
  if(!research.complete)return{...checked,
    explanation:'Borrador INCOMPLETO: '+research.verifiedEvents+'/'+count+
      ' partidos con tendencia histórica documentada, '+
      quotedLegs+' con precio cotejado. '+
      (research.multisportSatisfied?'':'No cumple diversidad de deportes. ')+
      'No se cotiza una combinada incompleta.'}
  if(quotedLegs!==count)return{...checked,
    explanation:'Fuentes auditadas: '+quotedLegs+'/'+count+
      ' selecciones tienen precios verificables. No se fabrica la combinada restante.'}
  // A realistic combined price requires the SAME bookmaker to offer all legs.
  const common=groups.reduce<Set<string>>((set,rows,index)=>{
    const names=new Set(rows.map(q=>q.bookmaker))
    return index===0?names:new Set([...set].filter(book=>names.has(book)))
  },new Set())
  if(!common.size)return{...checked,quotedLegs,missingQuotes:0,
    explanation:'Los precios corresponden a distintas casas sin un operador común; no se multiplican como si existiera una combinada disponible.'}
  const best=[...common].map(book=>{
    const choices=groups.map(rows=>rows.filter(q=>q.bookmaker===book)
      .sort((a,b)=>b.price-a.price)[0]).filter((q):q is KeylessQuote=>q!==undefined)
    return{book,choices,combined:choices.reduce((acc,q)=>acc*q.price,1)}
  }).filter(x=>x.choices.length===count).sort((a,b)=>b.combined-a.combined)[0]
  if(!best)return checked
  const marketQuotes:MarketOutcome[]=best.choices.map((q,index)=>({
    eventId:q.eventId,bookmaker:q.bookmaker,market:q.market,selection:q.selection,point:q.point,
    price:q.price,home:q.home,away:q.away,time:q.time,updatedAt:q.updatedAt,
    observedAt:q.observedAt,source:q.source,sportKey:leagueSportKey[research.events[index]?.league??'']??routing[research.events[index]?.sport??'']?.oddsSportKey??'sports_keyless',
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
      specialistResearch:specialistChecks[index]??null,
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
    ...priced.card.props,legs,requestedLegs:count,modelAudit,
    subtitle:'Cuotas verificadas · '+best.book+' · análisis de forma con datos ESPN',
    note:'COTIZACIÓN DE INVESTIGACIÓN CON DOSSIER DEPORTIVO POR PATA, NO APUESTA APROBADA NI GANADORA. '+(marketPreference==='double_chance'
      ?'Fútbol: la doble oportunidad cubre empate (1X/X2), NO asegura ganar. ':'')+
      'TheRundown Free informa cuotas con retraso aproximado de 5 min; observedAt es consulta del proveedor, updatedAt es último cambio de la casa. Confirmar precio actual antes de apostar. '+
      'Contradicciones de Bet Better: '+modelDisagreements+
      ' (predicción independiente, no cuota). Formas y descanso históricos NO son probabilidades calibradas. El expediente deportivo puede señalar titulares, bajas y estadísticas PENDIENTES; confirmar la casa antes de apostar. '+priced.warning,
    askPrompt:'Kira, comprueba lesiones, titulares, estadísticas específicas, correlación y vigencia de las '+count+' cuotas antes de recomendar este ticket.',
  }}
  return{card,priced:true,placed:false,complete:true,verifiedEvents:research.verifiedEvents,
    quotedLegs:count,missingQuotes:0,sourceAudit,approvedLegs:0,
    specialistChecks,researchedLegs,modelAudit,
    multisportSatisfied:research.multisportSatisfied,
    explanation:'Las '+count+' selecciones tienen cuota vigente y la misma casa '+best.book+
      '. Cada pata pasó por su expediente deportivo; NO equivale a aprobación de apuesta ni es modelo de acierto calibrado. Validar lesiones, titulares, restricciones y precios antes de apostar.'}
}
