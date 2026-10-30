import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_UNIVERSE, analyze, exitPlan, freshState, paperFill, parseKlines,
  pickUniverse, riskBudget, marketValue, ema, rsi, atr,
} from '../src/strategy.mjs';
import {knownAssetRisk,spotAssetRisk} from '../src/asset-risk.mjs';

const H=900000, NOW=1700000000000;
function rows(now=NOW,flag='trend'){
  return Array.from({length:80},(_,i)=>{
    const close=flag==='flat'?100:100+i*.12+Math.sin(i*.9)*.8+(i===79?2.2:0);
    const volume=i===79?70:10;
    const time=now-(80-i)*H;
    return [time,String(close-.12),String(close+.7),String(close-1),String(close),
      String(volume),time+H-1,'0',10];
  });
}
describe('market evidence and strategy research',()=>{
  it('accepts confirmed Binance OHLCV but rejects stale, reversed and malformed history',()=>{
    const candles=parseKlines(rows(),NOW,H);
    assert.equal(candles.length,80);
    assert.ok(Number.isFinite(ema(candles.map(x=>x.close),21)));
    assert.ok(Number.isFinite(rsi(candles.map(x=>x.close),14)));
    assert.ok(atr(candles)>0);
    assert.throws(()=>parseKlines(rows(NOW-4*H),NOW,H),/stale-bars/);
    const bad=rows();bad[10][2]='NaN';
    assert.throws(()=>parseKlines(bad,NOW,H),/invalid-bars/);
    const reverse=rows();reverse[10][0]=reverse[9][0];
    assert.throws(()=>parseKlines(reverse,NOW,H),/invalid-bars/);
  });
  it('evaluates real closed candles without inventing an unavoidable buy',()=>{
    const signal=analyze('BTCUSDT',parseKlines(rows(),NOW,H));
    assert.equal(signal.symbol,'BTCUSDT');
    assert.ok(['hold','buy'].includes(signal.action));
    assert.ok(signal.score>=0&&signal.score<=100);
    const flat=analyze('ETHUSDT',parseKlines(rows(NOW,'flat'),NOW,H));
    assert.equal(flat.action,'hold');
    assert.equal(flat.score,0);
  });
  it('blocks official Monitoring and delisting snapshot, non-SPOT permissions and nonstandard risk markers',()=>{
    assert.equal(knownAssetRisk('BICOUSDT'),'monitoring-tag');
    assert.equal(knownAssetRisk('QUICKUSDT'),'announced-delisting');
    assert.equal(knownAssetRisk('BTCUSDT'),null);
    assert.equal(spotAssetRisk({symbol:'ETHUSDT',status:'HALT',quoteAsset:'USDT'}),'not-trading');
    assert.equal(spotAssetRisk({symbol:'ABCUSDT',status:'TRADING',quoteAsset:'USDT',
      permissionSets:[['MARGIN']]}),'no-spot-permission');
    assert.equal(spotAssetRisk({symbol:'XYZUSDT',status:'TRADING',quoteAsset:'USDT',
      tags:['MONITORING']}),'risk-tag');
    const markets={symbols:['BICOUSDT','QUICKUSDT','BTCUSDT'].map(symbol=>({
      symbol,status:'TRADING',quoteAsset:'USDT'}))};
    const tickers=['BICOUSDT','QUICKUSDT','BTCUSDT'].map(symbol=>({
      symbol,lastPrice:'100',quoteVolume:'90000000'}));
    assert.deepEqual(pickUniverse(markets,tickers),['BTCUSDT']);
  });
  it('discovers eligible Spot markets by actual exchange rules and liquidity',()=>{
    const exchange={symbols:[
      {symbol:'BTCUSDT',status:'TRADING',quoteAsset:'USDT'},
      {symbol:'ETHUSDT',status:'TRADING',quoteAsset:'USDT'},
      {symbol:'DOGEUPUSDT',status:'TRADING',quoteAsset:'USDT'},
      {symbol:'NOTUSDT',status:'BREAK',quoteAsset:'USDT'},
      {symbol:'BTCBUSD',status:'TRADING',quoteAsset:'BUSD'},
    ]};
    const quotes=[
      {symbol:'ETHUSDT',quoteVolume:'7000000',lastPrice:'2100'},
      {symbol:'BTCUSDT',quoteVolume:'8000000',lastPrice:'80000'},
      {symbol:'DOGEUPUSDT',quoteVolume:'90000000',lastPrice:'1'},
      {symbol:'NOTUSDT',quoteVolume:'90000000',lastPrice:'1'},
    ];
    assert.deepEqual(pickUniverse(exchange,quotes,MAX_UNIVERSE),['BTCUSDT','ETHUSDT']);
  });
});
describe('isolated simulated ledger and deterministic risk',()=>{
  it('enforces duplicate ID, fee, partial TP1, remaining TP2 and no overselling',()=>{
    let state=freshState();state.enabled=true;
    const entry=exitPlan(100,1.25,'ema-pullback');
    assert.ok(entry.stop<entry.entry&&entry.entry<entry.tp1&&entry.tp1<entry.tp2);
    const buy={id:'run1:BTCUSDT',at:NOW,symbol:'BTCUSDT',side:'buy',quantity:4,
      price:100,reason:'test',strategy:'ema-pullback',plan:entry};
    state=paperFill(state,buy);
    assert.equal(state.cash,9599.6);
    assert.equal(state.journal.length,1);
    assert.deepEqual(paperFill(state,buy),state);
    const tp1={id:'run2:BTCUSDT',at:NOW+H,symbol:'BTCUSDT',side:'sell',quantity:2,
      price:103,reason:'tp1',strategy:'ema-pullback'};
    state=paperFill(state,tp1);
    assert.equal(state.positions.BTCUSDT.quantity,2);
    assert.equal(state.positions.BTCUSDT.plan.tp1Done,true);
    state=paperFill(state,{...tp1,id:'run3:BTCUSDT',reason:'tp2',quantity:2});
    assert.equal(Object.keys(state.positions).length,0);
    assert.equal(state.journal.length,3);
    assert.throws(()=>paperFill(state,{...tp1,id:'run4'}),/virtual-oversell/);
  });
  it('permits four independently journaled PAPER positions but not a fifth',()=>{
    let state=freshState();state.enabled=true;
    const names=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT'];
    for(const [index,symbol] of names.entries()){
      const signal={symbol,action:'buy',score:80};
      const marks=Object.fromEntries(Object.keys(state.positions).map(name=>[name,100]));
      const budget=riskBudget(state,signal,marks);
      assert.ok(budget>=10);
      state=paperFill(state,{id:'multi-'+index,at:NOW+index,symbol,side:'buy',
        price:100,quantity:budget/(100*(1+0.001)),
        strategy:index%2?'ema-pullback':'donchian-breakout',
        reason:'deterministic paper test',plan:exitPlan(100,1.5,'test')});
      const total=Object.values(state.positions).reduce((sum,p)=>sum+p.quantity*100,0);
      const equity=state.cash+total;
      assert.ok(total<=equity*0.20+0.01);
    }
    assert.equal(Object.keys(state.positions).length,4);
    assert.equal(state.journal.length,4);
    assert.equal(riskBudget(state,{symbol:'XRPUSDT',action:'buy',score:90},
      Object.fromEntries(names.map(name=>[name,100]))),0);
  });
  it('marks PnL and limits exposure, open positions, drawdown and daily losses',()=>{
    let state=freshState();state.enabled=true;
    const signal={symbol:'ETHUSDT',action:'buy',score:80};
    assert.equal(riskBudget(state,signal,{}),500);
    state=paperFill(state,{id:'a',at:NOW,symbol:'BTCUSDT',side:'buy',
      price:100,quantity:5,strategy:'test',plan:exitPlan(100,2,'test')});
    marketValue(state,{BTCUSDT:0.01});
    assert.ok(state.equity<10000);
    assert.equal(riskBudget(state,signal,{BTCUSDT:0.01}),0);
    assert.ok(state.positions.BTCUSDT.cost>state.positions.BTCUSDT.quantity*100);
    state.halted=true;
    assert.equal(riskBudget(state,signal,{BTCUSDT:90}),0);
  });
});
