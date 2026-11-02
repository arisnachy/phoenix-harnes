import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {parseKlines} from '../src/strategy.mjs';
import {STRATEGIES,replayStrategy,walkForward} from '../src/research.mjs';

const INTERVAL=900_000, NOW=1_710_000_000_000;
const fixture=(length=240)=>{
  const rows=Array.from({length},(_,i)=>{
    const p=100+i*.028+Math.sin(i*.55)*.9+(i%33===0?1:0);
    const t=NOW-(length-i)*INTERVAL;
    return [t,''+p,''+(p+1.2),''+(p-1.3),''+p,''+(10+i%4),t+INTERVAL-1];
  });
  return parseKlines(rows,NOW,INTERVAL);
};
describe('strategy walk-forward evidence gate',()=>{
  it('evaluates every registered family on train and one selected strategy on later holdout',()=>{
    const output=walkForward('BTCUSDT',fixture());
    assert.equal(output.train.length,STRATEGIES.length);
    assert.ok(STRATEGIES.includes(output.selected));
    assert.ok(Number.isFinite(output.holdout.netReturnPct));
    assert.ok(output.holdout.maxDrawdownPct>=0);
    assert.equal(typeof output.eligible,'boolean');
    for(const row of output.train){
      assert.ok(row.trades>=0);
      assert.ok(row.sampleSize>=0);
      assert.ok(Number.isFinite(row.netReturnPct));
    }
  });
  it('does not infer profitability or use under-length history as validation',()=>{
    assert.throws(()=>walkForward('BTCUSDT',fixture(100)),/need-180-verified-bars/);
    assert.throws(()=>replayStrategy('BTCUSDT',fixture(), 'fictitious-alpha',60,200),
      /invalid-research-window/);
    assert.throws(()=>replayStrategy('BTCUSDT',fixture(),STRATEGIES[0],30,90),
      /invalid-research-window/);
  });
});
