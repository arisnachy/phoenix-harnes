/** ATP/WTA settlement arithmetic with explicit retirement, match tiebreak and house policies.
 * Does NOT settle a wager in a bookmaker account or imply the bet was accepted.
 */
export type TennisSet={aGames:number;bGames:number;
  kind:'regular'|'match_tiebreak'}
export type TennisResult={playerAId:string;playerBId:string;sets:TennisSet[];
  winnerId:string|null;status:'completed'|'retired'|'walkover'|'suspended'|'unknown';
  official:boolean}
export type TennisMarket=
  |{kind:'match_winner';playerId:string;retirementRule:'void'|'action'|'unknown'}
  |{kind:'total_games';pick:'over'|'under';line:number;
    retirementRule:'void'|'action'|'unknown';matchTiebreakRule:'exclude'|'pending'}
  |{kind:'game_handicap';playerId:string;line:number;
    retirementRule:'void'|'action'|'unknown';matchTiebreakRule:'exclude'|'pending'}
export type TennisSettlement={status:'win'|'loss'|'push'|'void'|'pending';
  observed:number|null;reason:string}
export function settleTennisMarket(result:TennisResult,
  market:TennisMarket):TennisSettlement{
  const ids=[result.playerAId,result.playerBId]
  if(ids.some(x=>!/^\d{1,18}$/u.test(x))||ids[0]===ids[1]||
    ('playerId' in market&&!ids.includes(market.playerId)))
    throw Error('Identidad ATP/WTA de jugadores inválida')
  if(market.kind!=='match_winner'&&(!Number.isFinite(market.line)||
    Math.abs(market.line)>250||
    Math.abs(market.line*2-Math.round(market.line*2))>1e-9))
    throw Error('Línea de tenis inválida')
  if(!result.official||result.status==='suspended'||result.status==='unknown')
    return{status:'pending',observed:null,reason:'Sin marcador oficial completado'}
  if(result.status==='walkover')
    return{status:'pending',observed:null,
      reason:'Walkover requiere política explícita; no hubo encuentro iniciado'}
  if(result.status==='retired'){
    if(market.retirementRule==='void')
      return{status:'void',observed:null,reason:'Retiro bajo norma verificada de devolución'}
    if(market.retirementRule==='unknown')
      return{status:'pending',observed:null,reason:'Retiro sin reglas verificadas de la casa'}
  }
  if(market.kind==='match_winner'){
    if(!result.winnerId||!ids.includes(result.winnerId))
      return{status:'pending',observed:null,reason:'Ganador del encuentro no verificado'}
    return{status:result.winnerId===market.playerId?'win':'loss',
      observed:null,reason:'Resultado sujeto a ruleset de casa para retiro'}
  }
  const unknownSet=result.sets.some(s=>!Number.isSafeInteger(s.aGames)||
    !Number.isSafeInteger(s.bGames)||s.aGames<0||s.bGames<0||
    s.aGames>20||s.bGames>20)
  if(unknownSet||!result.sets.length)return{status:'pending',observed:null,
    reason:'Sets o games oficiales no verificables'}
  if(result.sets.some(s=>s.kind==='match_tiebreak')&&market.matchTiebreakRule==='pending')
    return{status:'pending',observed:null,
      reason:'Super-tiebreak decisivo exige política específica para total/handicap de juegos'}
  const sets=result.sets.filter(s=>s.kind==='regular')
  const a=sets.reduce((v,s)=>v+s.aGames,0)
  const b=sets.reduce((v,s)=>v+s.bGames,0)
  const delta=market.kind==='total_games'?
    (market.pick==='over'?a+b-market.line:market.line-a-b):
      (market.playerId===result.playerAId?a-b:b-a)+market.line
  return{status:delta>0?'win':delta<0?'loss':'push',
    observed:market.kind==='total_games'?a+b:
      market.playerId===result.playerAId?a-b:b-a,
    reason:'Cómputo de games verificados; confirmar definición de super-tiebreak y retiros en casa'}
}
