/** NFL settlement arithmetic only. Caller must verify official boxscore,
 * sportsbook rulebook, allowed OT, void and player participation policy.
 */
export type NflScore={home:number;away:number;period:'regulation'|'including_ot';final:boolean}
export type NflMarket=
  |{kind:'moneyline';pick:'home'|'away'|'draw';period:'regulation'|'including_ot'}
  |{kind:'spread';pick:'home'|'away';line:number;period:'regulation'|'including_ot'}
  |{kind:'total';pick:'over'|'under';line:number;period:'regulation'|'including_ot'}
export type NflSettlement={status:'win'|'loss'|'push'|'pending';reason:string}
export function settleNflScore(score:NflScore,market:NflMarket):NflSettlement{
  if(!Number.isSafeInteger(score.home)||!Number.isSafeInteger(score.away)||
    score.home<0||score.away<0||score.home>300||score.away>300)
    throw Error('Marcador NFL inválido')
  if(market.period!==score.period)throw Error('Período del marcador no coincide con el mercado')
  if(market.kind!=='moneyline'&&(!Number.isFinite(market.line)||
    Math.abs(market.line)>300||
    Math.abs(market.line*2-Math.round(market.line*2))>1e-9))
    throw Error('Línea inválida')
  if(!score.final)return{status:'pending',reason:'Marcador de período no oficial todavía'}
  const delta=score.home-score.away
  let margin:number
  if(market.kind==='moneyline'){
    if(!['home','away','draw'].includes(market.pick))throw Error('Selección NFL inválida')
    const picked=market.pick==='home'?delta>0:market.pick==='away'?delta<0:delta===0
    return{status:picked?'win':'loss',
      reason:'Resultado por período declarado; verificar reglas de empate y prórroga de la casa'}
  }else if(market.kind==='spread'){
    if(!['home','away'].includes(market.pick))throw Error('Equipo NFL inválido')
    margin=(market.pick==='home'?delta:-delta)+market.line
  }else{
    if(!['over','under'].includes(market.pick))throw Error('Total NFL inválido')
    margin=market.pick==='over'?score.home+score.away-market.line:
      market.line-score.home-score.away
  }
  return{status:margin>0?'win':margin<0?'loss':'push',
    reason:'Aritmética de marcador verificado, sin incorporar reglas particulares de la casa'}
}
export type NflPropType='passingYards'|'rushingYards'|'receivingYards'|
  'receptions'|'passingTouchdowns'|'rushingTouchdowns'|'receivingTouchdowns'|
  'interceptionsThrown'|'rushAttempts'|'passAttempts'|'fieldGoalsMade'
export type NflPlayerBoxscore={
  eventId:string;playerId:string;period:'regulation'|'including_ot';
  league:'nfl';final:boolean;participation:'played'|'dnp'|'unknown';
  stats:Partial<Record<NflPropType,number>>
}
export type NflPropMarket={
  eventId:string;playerId:string;league:'nfl';
  period:'regulation'|'including_ot';kind:NflPropType;line:number;
  pick:'over'|'under';dnpPolicy:'void'|'loss'|'unknown'
}
export type NflPropSettlement={status:'win'|'loss'|'push'|'pending'|'void';
  observed:number|null;reason:string}
export function settleNflPlayerProp(box:NflPlayerBoxscore,
  market:NflPropMarket):NflPropSettlement{
  if(!/^\d{1,18}$/u.test(market.eventId)||!/^\d{1,18}$/u.test(market.playerId)||
    box.eventId!==market.eventId||box.playerId!==market.playerId||
    box.league!==market.league||box.period!==market.period)
    throw Error('Identidad NFL, jugador o período incompatible')
  if(!Number.isFinite(market.line)||market.line<0||market.line>1000||
    Math.abs(market.line*2-Math.round(market.line*2))>1e-9)
    throw Error('Línea del prop inválida')
  if(!box.final||box.participation==='unknown')return{
    status:'pending',observed:null,reason:'Resultado o participación no finalizado'}
  if(box.participation==='dnp'){
    return market.dnpPolicy==='unknown'?
      {status:'pending',observed:null,reason:'Regla DNP de casa no verificada'}:
      {status:market.dnpPolicy==='void'?'void':'loss',
        observed:null,reason:'Regla DNP de casa declarada explícitamente'}
  }
  const observed=box.stats[market.kind]
  if(!Number.isFinite(observed)||observed===undefined||observed<0||
    observed>1500)return{status:'pending',observed:null,
    reason:'No hay estadística oficial válida para ese atleta y prop'}
  const gap=market.pick==='over'?observed-market.line:market.line-observed
  return{status:gap>0?'win':gap<0?'loss':'push',observed,
    reason:'Cálculo con boxscore por jugador, pendiente de certificación de reglas de casa'}
}
