import {analyze, exitPlan, FEE_RATE, SIMULATED_SLIPPAGE} from './strategy.mjs';

/** Research catalog; these rules are hypotheses until validated on holdout data. */
export const STRATEGIES=[
  'donchian-breakout','ema-pullback','bollinger-mean-reversion','momentum-continuation',
];
function metrics(returns, equityHistory, trades) {
  let peak=1,maxDrawdown=0;
  for(const e of equityHistory){
    peak=Math.max(peak,e);
    maxDrawdown=Math.max(maxDrawdown,(peak-e)/peak);
  }
  const wins=returns.filter(x=>x>0);
  const losses=returns.filter(x=>x<0);
  const average=returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:0;
  const variance=returns.length>1?returns.reduce((a,b)=>a+(b-average)**2,0)/(returns.length-1):0;
  const profitFactor=losses.length?
    wins.reduce((a,b)=>a+b,0)/Math.abs(losses.reduce((a,b)=>a+b,0)):
    wins.length?null:0;
  return {trades,netReturnPct:(equityHistory.at(-1)-1)*100,
    maxDrawdownPct:maxDrawdown*100,winRatePct:returns.length?100*wins.length/returns.length:null,
    profitFactor,avgTradeReturnPct:average*100,
    tradeStdDev:Math.sqrt(variance),sampleSize:returns.length};
}

/**
 * A conservative next-bar paper simulation. Signals use ONLY completed bars,
 * entries occur on the following bar open, and overlapping stop+TP assumes STOP.
 * Only one position; adverse spread/slippage and both exchange fees included.
 *
 * @param symbol - Valid public USDT market.
 * @param bars - Validated chronological closed OHLCV observations (>= 120).
 * @param strategy - One catalog hypothesis, not an optimized profit guarantee.
 * @param start - First candle permitted as a trade entry.
 * @param end - Exclusive end of evaluation period.
 */
export function replayStrategy(symbol,bars,strategy,start=60,end=bars.length) {
  if(!STRATEGIES.includes(strategy)||!Number.isInteger(start)||start<60
    ||!Number.isInteger(end)||end>bars.length||end<=start)throw new Error('invalid-research-window');
  let equity=1,position=null;
  const equityHistory=[equity],returns=[];
  let trades=0;
  for(let i=start;i<end;i++){
    const bar=bars[i];
    if(!bar||!(bar.open>0)||!(bar.high>=bar.open)||!(bar.low>0))throw new Error('invalid-research-bar');
    if(position){
      // Conservative outcome when stop and target touched in the same candle.
      const plan=position.plan;
      const stopHit=bar.low<=plan.stop;
      const tp2Hit=bar.high>=plan.tp2;
      const tp1Hit=!plan.tp1Done&&bar.high>=plan.tp1;
      let level=null, fraction=1;
      if(stopHit)level=plan.stop;
      else if(tp2Hit)level=plan.tp2;
      else if(tp1Hit){level=plan.tp1;fraction=.5;plan.tp1Done=true;}
      if(level!==null){
        const exitPrice=level*(1-SIMULATED_SLIPPAGE);
        const gross=exitPrice/position.entry;
        const net=(gross*(1-FEE_RATE)-1)*fraction*position.allocation;
        equity+=net;
        position.allocation-=position.allocation*fraction;
        if(fraction===1){
          returns.push((exitPrice/position.entry)*(1-FEE_RATE)*(1-FEE_RATE)-1);
          position=null;
        }
      }
    }
    // Today's bar is not known until it closes; a signal from bar i-1 can
    // only be filled at bar i open (no same-bar execution/look-ahead).
    if(!position){
      const signal=analyze(symbol,bars.slice(i-60,i));
      if(signal.action==='buy'&&signal.strategy===strategy&&signal.score>=70){
        const entry=bar.open*(1+SIMULATED_SLIPPAGE);
        if(entry>0&&signal.atr>0){
          const allocation=.05;
          equity-=allocation*FEE_RATE;
          position={entry,allocation,plan:exitPlan(entry,signal.atr,strategy)};
          trades++;
        }
      }
    }
    equityHistory.push(equity);
  }
  // Open positions are conservatively valued at the final candle close
  // after hypothetical exit fees. No unrealized profit is counted at entry.
  if(position){
    const terminal=bars[end-1].close*(1-SIMULATED_SLIPPAGE);
    const net=(terminal/position.entry*(1-FEE_RATE)-1)*position.allocation;
    equity+=net;equityHistory[equityHistory.length-1]=equity;
  }
  return metrics(returns,equityHistory,trades);
}
/**
 * Train/holdout gate: rank strategies ONLY on training history, then evaluate
 * the winner on unseen later bars. Poor sample sizes do not approve trading.
 */
export function walkForward(symbol,bars) {
  if(!Array.isArray(bars)||bars.length<180)throw new Error('need-180-verified-bars');
  const boundary=Math.floor(bars.length*.67);
  const train=STRATEGIES.map(strategy=>({
    strategy,
    ...replayStrategy(symbol,bars,strategy,60,boundary),
  }));
  train.sort((a,b)=>(b.netReturnPct-3*b.maxDrawdownPct)-(a.netReturnPct-3*a.maxDrawdownPct));
  const selected=train[0];
  const holdout=replayStrategy(symbol,bars,selected.strategy,boundary,bars.length);
  return {selected:selected.strategy,train,holdout,
    eligible:selected.trades>=20 && holdout.trades>=10
      && holdout.netReturnPct>0 && holdout.maxDrawdownPct<=8,
    rationale:'Eligibility requires 20 train trades, 10 holdout trades, positive net holdout and <=8% holdout drawdown; no inference of future profit.',
  };
}
