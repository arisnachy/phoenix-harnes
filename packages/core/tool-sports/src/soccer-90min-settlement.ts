/** Settlement arithmetic for regular-time (90 + stoppage) soccer markets.
 * Not a sportsbook rule oracle, not a predictor, and never a placed bet.
 * Caller must verify the bookmaker's official settlement terms separately.
 */
export type SoccerSettlementMarket=
  |{kind:'1x2';selection:'home'|'draw'|'away'}
  |{kind:'double_chance';selection:'1X'|'X2'|'12'}
  |{kind:'draw_no_bet';selection:'home'|'away'}
  |{kind:'both_score';selection:'yes'|'no'}
  |{kind:'total';selection:'over'|'under';line:number}
  |{kind:'asian_handicap';selection:'home'|'away';line:number}
export type SoccerSettlement={
  period:'regular_90'
  status:'win'|'half_win'|'push'|'half_loss'|'loss'
  winFraction:number
  pushFraction:number
  lossFraction:number
  note:string
}
type State='win'|'push'|'loss'
const classify=(d:number):State=>d>1e-9?'win':d< -1e-9?'loss':'push'
function safeGoals(n:number):boolean{return Number.isSafeInteger(n)&&n>=0&&n<=60}
function safeLine(n:number):boolean{return Number.isFinite(n)&&Math.abs(n)<=30&&
  Math.abs(n*4-Math.round(n*4))<1e-8}
function fractions(parts:State[]):SoccerSettlement{
  const winFraction=parts.filter(s=>s==='win').length/parts.length
  const pushFraction=parts.filter(s=>s==='push').length/parts.length
  const lossFraction=parts.filter(s=>s==='loss').length/parts.length
  const status=winFraction===1?'win':winFraction===0&&lossFraction===0?'push':
    lossFraction===1?'loss':winFraction===0?'half_loss':'half_win'
  return{period:'regular_90',status,winFraction,pushFraction,lossFraction,
    note:'Solo reglas aritméticas de 90 minutos más añadido. Verificar casa, suspensión, abandonos, anulaciones y especificaciones.'}
}
function quarters(line:number):number[]{
  if(!safeLine(line))throw Error('Línea asiática inválida')
  const scaled=Math.round(line*4)
  if(Math.abs(scaled%2)===1)return[(scaled-1)/4,(scaled+1)/4]
  return[line]
}
/** Score is official 90-minute result; never include extra time or penalties.
 * @param homeGoals - Home team goals at 90+stoppage (nonnegative integer).
 * @param awayGoals - Away team goals at 90+stoppage (nonnegative integer).
 * @param market - Explicit soccer market, selection and optional Asian line.
 * @returns Settlement fractions, independent of price, bookmaker and model.
 */
export function settleSoccer90(homeGoals:number,awayGoals:number,
  market:SoccerSettlementMarket):SoccerSettlement{
  if(!safeGoals(homeGoals)||!safeGoals(awayGoals))
    throw Error('Marcador de 90 minutos inválido')
  const diff=homeGoals-awayGoals,total=homeGoals+awayGoals
  let result:State[]=[]
  switch(market.kind){
    case '1x2':{
      const picked=market.selection==='home'?diff>0:
        market.selection==='away'?diff<0:market.selection==='draw'?diff===0:null
      if(picked===null)throw Error('Selección 1X2 inválida')
      result=[picked?'win':'loss'];break
    }
    case 'double_chance':{
      const picked=market.selection==='1X'?diff>=0:
        market.selection==='X2'?diff<=0:market.selection==='12'?diff!==0:null
      if(picked===null)throw Error('Doble oportunidad inválida')
      result=[picked?'win':'loss'];break
    }
    case 'draw_no_bet':{
      if(market.selection!=='home'&&market.selection!=='away')throw Error('DNB inválido')
      result=[diff===0?'push':
        market.selection==='home'?(diff>0?'win':'loss'):(diff<0?'win':'loss')];break
    }
    case 'both_score':{
      if(market.selection!=='yes'&&market.selection!=='no')throw Error('BTTS inválido')
      const yes=homeGoals>0&&awayGoals>0
      result=[(market.selection==='yes'?yes:!yes)?'win':'loss'];break
    }
    case 'total':{
      if(!['over','under'].includes(market.selection)||market.line<0)
        throw Error('Mercado de goles inválido')
      const lines=quarters(market.line)
      result=lines.map(line=>classify(market.selection==='over'?total-line:line-total))
      break
    }
    case 'asian_handicap':{
      if(market.selection!=='home'&&market.selection!=='away')throw Error('AH inválido')
      const lines=quarters(market.line)
      result=lines.map(line=>classify(
        market.selection==='home'?diff+line:-diff+line))
      break
    }
    default:throw Error('Mercado sin implementación de liquidación')
  }
  return fractions(result)
}
