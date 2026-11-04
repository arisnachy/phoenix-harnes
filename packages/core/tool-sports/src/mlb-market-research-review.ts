/**
 * Evidence-based MLB market review. It NEVER fabricates probabilities, an
 * expected total, betting edge, or sportsbook settlement rules. Kira receives
 * attributable strengths, contradictions and blockers for each real offer.
 */
import type {MlbCase,MlbAthlete} from './mlb-evidence-research.ts'
export type MlbReviewMarket={
  bookmaker:string;market:string;selection:string;line:number|null;price:number;
  updatedAt:string;status:'needs-review'|'blocked';
  favorableEvidence:string[];contradictoryEvidence:string[];
  missingEvidence:string[];researchQuestions:string[];
}
export type MlbMarketComparison={
  bookmaker:string;market:string;
  offers:Array<{selection:string;line:number|null;price:number;updatedAt:string}>;
  note:string;
}
export type MlbCrossBookComparison={
  market:string;selection:string;line:number|null;
  quotes:Array<{bookmaker:string;price:number;updatedAt:string}>;
  note:string;
}
export type MlbResearchReview={
  version:1;eventId:string;sport:'baseball';league:'mlb';
  eligibility:'research-only'|'insufficient';
  evidenceGates:Record<string,boolean>;
  reviewedMarkets:MlbReviewMarket[];marketComparisons:MlbMarketComparison[];
  crossBookComparisons:MlbCrossBookComparison[];conclusion:string;
  decision:'investigate'|'abstain';
  probabilitiesEstimated:false;eligibleForTicket:false;
  missingEvidence:string[];
}
const count=(v:unknown)=>Array.isArray(v)?v.length:0
const readyStat=(p:MlbAthlete|null,field:string)=>p?.season[field]!==undefined
/** Every market is checked against the verified evidence in the SAME dossier. */
export function reviewMlbResearch(d:MlbCase):MlbResearchReview{
  const h=d.starters.home,a=d.starters.away
  const nineVerified=(side:'home'|'away')=>{
    const hitters=d.rosters[side].filter(p=>p.role==='batter')
    return new Set(hitters.map(p=>p.id)).size>=9&&
      hitters.every(p=>p.teamId===d.fixture[side].id)
  }
  // Recheck timestamps at review time: a cached dossier may outlive its quotes.
  const checkedMs=Date.parse(d.checkedAt)
  const quoteIsCurrent=(q:{updatedAt:string})=>{
    const quoteMs=Date.parse(q.updatedAt)
    return Number.isFinite(checkedMs)&&Number.isFinite(quoteMs)&&
      quoteMs<=checkedMs&&checkedMs-quoteMs<=60*60*1000
  }
  const currentOffers=d.odds.filter(quoteIsCurrent)
  const gates={
    scheduledFuture:Number.isFinite(Date.parse(d.fixture.date))&&
      Number.isFinite(Date.parse(d.checkedAt))&&
      Date.parse(d.fixture.date)>Date.parse(d.checkedAt)&&
      ['Preview','Pre-Game','Scheduled'].includes(d.fixture.status),
    startersVerified:!!h&&!!a,
    teamRecordsVerified:!!d.seasonRecord.home&&!!d.seasonRecord.away,
    recentTeamFormVerified:!!d.teamForm.home?.games&&!!d.teamForm.away?.games,
    bothRostersVerified:nineVerified('home')&&nineVerified('away'),
    lineupsConfirmed:(['home','away'] as const).every(side=>{
      if(d.lineupStatus[side]!=='confirmed')return false
      const confirmed=d.rosters[side].filter(p=>p.role==='batter'&&p.lineupConfirmed)
      return confirmed.length===9&&new Set(confirmed.map(p=>p.id)).size===9&&
        new Set(confirmed.map(p=>p.lineupOrder)).size===9&&
        confirmed.every(p=>p.teamId===d.fixture[side].id&&
          p.lineupOrder!==null&&p.lineupOrder>=1&&p.lineupOrder<=9)
    }),
    starterStatsVerified:readyStat(h,'era')&&readyStat(a,'era'),
    reliefUsageObserved:[...d.bullpen.home,...d.bullpen.away].some(p=>p.reliefUsage72h.length>0),
    rosterMatchupsReviewed:(['home','away'] as const).every(side=>{
      const opposing=side==='home'?'away':'home'
      const batters=d.rosters[side].filter(p=>p.role==='batter'&&p.lineupConfirmed)
      const pitchers=[d.starters[opposing],...d.bullpen[opposing]].filter(
        (p):p is MlbAthlete=>p!==null)
      return batters.length===9&&pitchers.length>0&&
        batters.every(b=>pitchers.every(p=>d.matchups.some(m=>
          m.batterId===b.id&&m.pitcherId===p.id)))
    }),
    venueKnown:!!d.venue.name&&d.venue.name!=='Estadio no verificado',
    roofConstructionKnown:d.venue.roofType!=='unknown',
    gameRoofPositionVerified:false,
    weatherForecastAvailable:!!d.weather, // A forecast is not a game-time measurement
    realOffersVerified:currentOffers.length>0,
    specificExpertPicksVerified:false,
    bookmakerRulesVerified:false,
    probabilitiesValidated:false,
  }
  const opponentBvP=count(d.matchups.filter(m=>m.bvp&&Number(m.bvp.atBats??0)>=10))
  const coreEvidence=[
    ...(gates.teamRecordsVerified?['Récord oficial de ambos equipos disponible']:[]),
    ...(gates.recentTeamFormVerified?['Forma reciente con resultados fechados y localía']:[]),
    ...(gates.startersVerified?['Identidad de ambos abridores probables verificada']:[]),
    ...(gates.rosterMatchupsReviewed?['Cruces de bateadores y pitchers rivales identificados por MLB ID']:[]),
    ...(opponentBvP?['Muestras BvP con al menos 10 turnos: '+opponentBvP]:[]),
    ...(gates.weatherForecastAvailable?['Pronóstico meteorológico horario disponible (orientación del viento sin verificar)']:[]),
  ]
  const opposingFacts=[
    ...(!gates.scheduledFuture?['El partido ya no es elegible para investigación prepartido']:[]),
    ...(!gates.lineupsConfirmed?['Cambios de la alineación pueden invalidar cualquier ventaja individual']:[]),
    ...(!gates.reliefUsageObserved?['Sin evidencia suficiente del uso reciente del bullpen']:[]),
    ...(!gates.specificExpertPicksVerified?['No se ha verificado un pick específico atribuible de ESPN/Covers']:[]),
    ...(!gates.bookmakerRulesVerified?['Las reglas oficiales de liquidación de la casa no están verificadas']:[]),
    ...(!gates.probabilitiesValidated?['Sin probabilidad contrastada fuera de muestra no puede afirmarse ventaja sobre el precio']:[]),
  ]
  const reviewedMarkets=d.odds.slice(0,40).map(q=>{
    const market=q.market.toLowerCase()
    const line=q.point??null
    const total=/total|over|under/u.test(market+' '+q.selection)
    const strikeouts=/strikeout|ponches|pitcher.*k/u.test(market+' '+q.selection)
    const fullGame=/full|game|h2h|total/u.test(market)
    const researchQuestions=[
      ...(total?['¿Qué demuestra el expediente sobre carreras en este período y bajo estos abridores y relevistas?',
        'Una media prevista superior a la línea no demuestra probabilidad de cobrar; examinar escenarios inferiores e iguales.']:[]),
      ...(strikeouts?['¿Qué lanzador y línea exacta se cotizan, mano, lineup, tasa K y límite probable de lanzamientos?']:[]),
      ...(!total&&!strikeouts?['¿Por qué esta selección vence los argumentos contrarios y otras líneas del mismo encuentro?']:[]),
      ...(Number.isInteger(line)&&total?['Si se anotan exactamente '+line+
        ', ¿hay devolución/push según la casa? Verificar tiempo y entradas válidas.']:[]),
      ...(fullGame?['¿Qué cambia si el bullpen entra antes o si el local no batea la novena?']:[]),
    ]
    const missing=[
      ...(!gates.scheduledFuture?['Partido no programado en el futuro o estado prepartido inválido']:[]),
      ...(!quoteIsCurrent(q)?['Cotización vencida, futura o sin fecha verificable respecto al corte de investigación']:[]),
      ...(!gates.lineupsConfirmed?['Alineación confirmada de ambos clubes']:[]),
      ...(!gates.rosterMatchupsReviewed?['Matriz completa de nueve bateadores contra abridor y relevistas rivales']:[]),
      ...(!gates.starterStatsVerified?['Estadísticas comprobadas de ambos abridores']:[]),
      ...(!gates.venueKnown?['Identidad y características del estadio verificadas']:[]),
      ...(!gates.weatherForecastAvailable?['Pronóstico meteorológico horario para el encuentro']:[]),
    ...(!gates.roofConstructionKnown?['Tipo de techo del estadio sin verificación']:[]),
    ...(!gates.gameRoofPositionVerified?['Estado del techo al inicio del encuentro sin verificar']:[]),
      ...(!gates.reliefUsageObserved?['Uso reciente del bullpen y disponibilidad de relevistas']:[]),
      ...(!gates.bookmakerRulesVerified?['Reglas verificadas para este mercado y período']:[]),
      ...(!gates.probabilitiesValidated?['Evaluación probabilística validada para respaldar EV']:[]),
      ...(strikeouts?['Identidad del pitcher del prop y proyección contrastada de ponches']:[]),
    ]
    return{bookmaker:q.bookmaker,market:q.market,selection:q.selection,line,
      price:q.price,updatedAt:q.updatedAt,status:missing.length?'blocked' as const:'needs-review' as const,
      favorableEvidence:coreEvidence,
      contradictoryEvidence:opposingFacts,missingEvidence:missing,researchQuestions}
  })
  const comparisonGroups=new Map<string,MlbMarketComparison>()
  for(const q of currentOffers.slice(0,40)){
    const key=JSON.stringify([q.bookmaker,q.market])
    const group=comparisonGroups.get(key)??{
      bookmaker:q.bookmaker,market:q.market,offers:[],
      note:'Comparar selección, línea, período y reglas exactas. Cuotas de resultados distintos no son intercambiables.',
    }
    group.offers.push({selection:q.selection,line:q.point??null,
      price:q.price,updatedAt:q.updatedAt})
    comparisonGroups.set(key,group)
  }
  const marketComparisons=[...comparisonGroups.values()]
  // Cross-book prices are comparable only for the exact same market,
  // selection and line. Never collapse Over/Under or different run lines.
  const crossBookGroups=new Map<string,MlbCrossBookComparison>()
  for(const q of currentOffers.slice(0,40)){
    const line=q.point??null
    const key=JSON.stringify([q.market.trim().toLowerCase(),
      q.selection.trim().toLowerCase(),line])
    const group=crossBookGroups.get(key)??{market:q.market,selection:q.selection,
      line,quotes:[],note:'Precios observados para el mismo mercado, selección y línea; verificar período y reglas de cada casa.'}
    group.quotes.push({bookmaker:q.bookmaker,price:q.price,updatedAt:q.updatedAt})
    crossBookGroups.set(key,group)
  }
  const crossBookComparisons=[...crossBookGroups.values()]
  const basic=Object.entries(gates).filter(([key])=>
    ['scheduledFuture','startersVerified','teamRecordsVerified','recentTeamFormVerified',
      'bothRostersVerified','lineupsConfirmed','rosterMatchupsReviewed'].includes(key))
  const insufficient=basic.some(([,value])=>!value)
  return{version:1,eventId:String(d.fixture.gamePk),sport:'baseball',league:'mlb',
    eligibility:insufficient?'insufficient':'research-only',evidenceGates:gates,
    reviewedMarkets,marketComparisons,crossBookComparisons,conclusion:insufficient?
      'El juego no es prepartido elegible o faltan datos esenciales: no considerar ninguna selección para un ticket.':
      !gates.realOffersVerified?'No hay cuotas reales vigentes para comparar mercados; abstenerse.':
      'Expediente apto para discusión crítica de mercados, pero no demuestra ventaja apostable.',
    decision:insufficient||!gates.realOffersVerified?'abstain':'investigate',
    probabilitiesEstimated:false,eligibleForTicket:false,
    missingEvidence:[...new Set([...d.missingEvidence,...opposingFacts,
      ...(!gates.realOffersVerified?['Ofertas reales vigentes de casas para el encuentro']:[])])]}
}
