/** NHL settlement examples, not a sportsbook rules oracle.
 * Caller supplies an OFFICIAL score snapshot for exactly the selected period.
 * OT/shootout scores must never be silently used for 60-min 3-way markets.
 */
export type NhlSettlementMarket=
  |{kind:'regulation_3way';pick:'home'|'away'|'draw'}
  |{kind:'winner_with_ot';pick:'home'|'away'}
  |{kind:'total';period:'regulation'|'including_ot';pick:'over'|'under';line:number}
  |{kind:'puck_line';period:'regulation'|'including_ot';pick:'home'|'away';line:number}
export type NhlFinal={regulationHome:number;regulationAway:number;
  finalHome:number;finalAway:number;winner:'home'|'away'|null;
  completed:boolean;winnerVerified:boolean}
export type NhlSettlement={status:'win'|'loss'|'push'|'pending';reason:string}
export function settleNhlMarket(score:NhlFinal,m:NhlSettlementMarket):NhlSettlement{
  const nums=[score.regulationHome,score.regulationAway,score.finalHome,score.finalAway]
  if(nums.some(n=>!Number.isSafeInteger(n)||n<0||n>50))
    throw Error('Marcadores NHL inválidos')
  if(m.kind!=='regulation_3way'&&m.kind!=='winner_with_ot'&&
    (!Number.isFinite(m.line)||Math.abs(m.line)>50||
      Math.abs(m.line*2-Math.round(m.line*2))>1e-9))
    throw Error('Línea NHL inválida')
  if(!score.completed)return{status:'pending',reason:'Resultado oficial todavía no finalizado'}
  if(m.kind==='regulation_3way'){
    const diff=score.regulationHome-score.regulationAway
    const winner=diff>0?'home':diff<0?'away':'draw'
    return{status:winner===m.pick?'win':'loss',
      reason:'Liquidación aritmética exclusivamente tras 3×20 minutos'}
  }
  if(m.kind==='winner_with_ot'){
    if(!score.winnerVerified||!score.winner)return{
      status:'pending',reason:'Ganador con prórroga/shootout sin confirmar'}
    return{status:score.winner===m.pick?'win':'loss',
      reason:'Ganador oficial incluyendo prórroga/shootout si la casa lo dispone'}
  }
  const home=m.period==='regulation'?score.regulationHome:score.finalHome
  const away=m.period==='regulation'?score.regulationAway:score.finalAway
  const diff=m.kind==='total'?
    (m.pick==='over'?home+away-m.line:m.line-home-away):
    (m.pick==='home'?home-away+m.line:away-home+m.line)
  return{status:diff>0?'win':diff<0?'loss':'push',
    reason:'Aritmética de goles, sujeta a reglas de casa para shootout, anulaciones y puck line'}
}
