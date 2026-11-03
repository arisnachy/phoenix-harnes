/** Deterministic settlement of NBA/WNBA player markets against identified
 * official boxscore values. This is NOT a prediction, offer or sportsbook rule.
 * A bookmaker-specific DNP policy MUST be explicitly supplied.
 */
export type BasketballProp='points'|'rebounds'|'assists'|'threes'|'steals'|'blocks'|
  'turnovers'|'PRA'|'PR'|'PA'|'RA'
export type BasketballBoxStats={
  playerId:string;eventId:string;league:'nba'|'wnba';
  period:'regulation'|'including_ot';
  participation:'played'|'dnp'|'unknown';
  stats:Partial<Record<'points'|'rebounds'|'assists'|'threes'|
    'steals'|'blocks'|'turnovers',number>>;
  source:string;observedAt:string;final:boolean
}
export type BasketballPropMarket={
  playerId:string;eventId:string;league:'nba'|'wnba';
  kind:BasketballProp;selection:'over'|'under';line:number;
  period:'regulation'|'including_ot';
  dnpRule:'void'|'loss'|'unverified'
}
export type BasketballPropSettlement={
  status:'win'|'loss'|'push'|'void'|'pending';
  observed:number|null;reason:string
}
const keys:Record<BasketballProp,readonly string[]>={
  points:['points'],rebounds:['rebounds'],assists:['assists'],
  threes:['threes'],steals:['steals'],blocks:['blocks'],turnovers:['turnovers'],
  PRA:['points','rebounds','assists'],PR:['points','rebounds'],
  PA:['points','assists'],RA:['rebounds','assists'],
}
export function settleBasketballPlayerProp(
  outcome:BasketballBoxStats,market:BasketballPropMarket,
):BasketballPropSettlement{
  if(!/^\d{1,18}$/u.test(market.playerId)||!/^\d{1,18}$/u.test(market.eventId)||
    outcome.playerId!==market.playerId||outcome.eventId!==market.eventId||
    outcome.league!==market.league||outcome.period!==market.period)
    throw Error('Jugador, evento, liga o período no coinciden')
  if(!Number.isFinite(market.line)||market.line<0||market.line>1000||
    Math.abs(market.line*2-Math.round(market.line*2))>1e-9)
    throw Error('Línea del prop inválida')
  if(!Object.hasOwn(keys,market.kind)||!['over','under'].includes(market.selection))
    throw Error('Selección de prop desconocida')
  if(!outcome.final||outcome.participation==='unknown')
    return{status:'pending',observed:null,reason:'Boxscore aún no oficial o participación sin confirmar'}
  if(outcome.participation==='dnp'){
    if(market.dnpRule==='void')
      return{status:'void',observed:null,reason:'DNP con regla de devolución verificada'}
    if(market.dnpRule==='loss')
      return{status:'loss',observed:null,reason:'DNP bajo regla de pérdida explícita'}
    return{status:'pending',observed:null,reason:'DNP requiere consultar reglas oficiales de la casa'}
  }
  const fields=keys[market.kind]
  if(!fields)throw Error('Prop inválido')
  const values=fields.map(key=>outcome.stats[key as keyof typeof outcome.stats])
  if(values.some(v=>!Number.isSafeInteger(v)||v===undefined||v<0||v>300))
    return{status:'pending',observed:null,reason:'Falta estadística oficial del atleta o combinación'}
  const observed=(values as number[]).reduce((sum,v)=>sum+v,0)
  const edge=market.selection==='over'?observed-market.line:market.line-observed
  return{status:edge>0?'win':edge<0?'loss':'push',observed,
    reason:'Liquidación aritmética sujeta a reglas de la casa y correcciones oficiales del boxscore'}
}
