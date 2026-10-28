import {it, describe} from 'node:test';
import assert from 'node:assert/strict';
import {route,cycle} from '../src/worker.mjs';
import {freshState} from '../src/strategy.mjs';

const TOKEN='test-only-admin-token-123456789012345678901234567890';
const NOW=1_700_000_000_000;
class D1Fake {
  state=null;
  revision=0;
  fences=new Set();
  eventLog=[];
  prepare(sql) {
    return {
      first:async()=>{
        if(sql.startsWith('SELECT revision,document FROM engine_state'))
          return this.state?{revision:this.revision,document:JSON.stringify(this.state)}:null;
        throw new Error('unhandled-select');
      },
      bind:(...params)=>({
      all:async()=>{
        if(sql.startsWith('SELECT seq,payload FROM event_log')){
          return {results:this.eventLog.filter(x=>x.seq>params[0]).slice(0,100)};
        }
        throw new Error('unhandled-all');
      },
      run:async()=>{
        if(sql.startsWith('INSERT OR IGNORE INTO engine_state')){
          if(!this.state)this.state=JSON.parse(params[0]);
          return {meta:{changes:1}};
        }
        if(sql.startsWith('INSERT OR IGNORE INTO run_fence')){
          if(this.fences.has(params[0]))return {meta:{changes:0}};
          this.fences.add(params[0]);return {meta:{changes:1}};
        }
        if(sql.startsWith('UPDATE engine_state')){
          if(params[1]!==this.revision)return {meta:{changes:0}};
          this.state=JSON.parse(params[0]);
          this.revision++;
          return {meta:{changes:1}};
        }
        if(sql.startsWith('INSERT OR IGNORE INTO event_log')){
          if(this.eventLog.some(x=>x.id===params[0]))return {meta:{changes:0}};
          this.eventLog.push({seq:this.eventLog.length+1,id:params[0],at:params[1],payload:params[2]});
          return {meta:{changes:1}};
        }
        throw new Error('unhandled-sql');
      },
      first:async()=>{
        if(sql.startsWith('SELECT revision,document FROM engine_state'))
          return this.state?{revision:this.revision,document:JSON.stringify(this.state)}:null;
        throw new Error('unhandled-select');
      },
    })};
  }
}
function request(path,token=TOKEN,method='GET',body) {
  return new Request('https://cloud.example'+path,{method,headers:{
    authorization:'Bearer '+token,
    ...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
}
function mockedMarket(now) {
  const symbols=['BTCUSDT','ETHUSDT','SOLUSDT'];
  const exchange={symbols:symbols.map(symbol=>({symbol,status:'TRADING',quoteAsset:'USDT'}))};
  const tickers=symbols.map((symbol,i)=>({symbol,quoteVolume:String(90000000-i*20000000),
    lastPrice:String(100+i*10)}));
  const rows=Array.from({length:80},(_,index)=>{
    const time=now-(80-index)*900000;
    const close=100+index*.1+Math.sin(index/2)*.5;
    return [time,''+close,''+(close+.8),''+(close-.8),''+close,'10',time+899999];
  });
  return async input=>{
    const u=new URL(input);
    if(u.origin!=='https://data-api.binance.vision')throw new Error('external-fetch-denied');
    const data=u.pathname.endsWith('/exchangeInfo')?exchange
      :u.pathname.endsWith('/ticker/24hr')?tickers
      :u.pathname.endsWith('/klines')?rows
      :u.pathname.endsWith('/ticker/price')?[]:null;
    if(data===null)return new Response('not-found',{status:404});
    return new Response(JSON.stringify(data),{status:200});
  };
}
describe('Cloud worker auth and scheduling',()=>{
  it('defaults to disabled, blocks unauthorized control, never claims REAL trades',async()=>{
    const env={DB:new D1Fake(),ADMIN_TOKEN:TOKEN};
    assert.equal((await (await route(request('/health',''),env)).json()).mode,'paper');
    assert.equal((await route(request('/snapshot','wrong-secret'),env)).status,401);
    assert.equal((await route(request('/admin/control','wrong-secret','POST',{action:'start'}),env)).status,401);
    const initial=await (await route(request('/snapshot'),env)).json();
    assert.equal(initial.enabled,false);
    assert.equal(initial.mode,'paper');
    assert.equal(await cycle(env,NOW).then(x=>x.status),'disabled');
    const start=await route(request('/admin/control',TOKEN,'POST',{action:'start'}),env);
    assert.equal(start.status,200);
    assert.equal((await start.json()).enabled,true);
    assert.equal((await route(request('/admin/control',TOKEN,'POST',{action:'real'}),env)).status,400);
  });
  it('checks each Cron slot once, stores universe and allows stop on a new session',async()=>{
    const env={DB:new D1Fake(),ADMIN_TOKEN:TOKEN};
    await route(request('/admin/control',TOKEN,'POST',{action:'start'}),env);
    const original=globalThis.fetch;
    globalThis.fetch=mockedMarket(NOW);
    try{
      const first=await cycle(env,NOW);
      assert.equal(first.status,'ok');
      assert.equal(first.scanned,3);
      assert.equal(first.universe,3);
      const duplicate=await cycle(env,NOW+1000);
      assert.equal(duplicate.status,'duplicate');
      assert.equal(env.DB.fences.size,1);
      const snapshot=await (await route(request('/snapshot'),env)).json();
      assert.equal(snapshot.universeCount,3);
      assert.equal(snapshot.lastScan,NOW);
      assert.equal(snapshot.mode,'paper');
      assert.equal(snapshot.enabled,true);
      const stop=await route(request('/admin/control',TOKEN,'POST',{action:'stop'}),env);
      assert.equal((await stop.json()).enabled,false);
      assert.equal((await cycle(env,NOW+60_000)).status,'disabled');
    }finally{globalThis.fetch=original;}
  });
  it('halts after three consecutive provider failures and refuses auto-restart',async()=>{
    const env={DB:new D1Fake(),ADMIN_TOKEN:TOKEN};
    await route(request('/admin/control',TOKEN,'POST',{action:'start'}),env);
    const original=globalThis.fetch;
    globalThis.fetch=async()=>new Response('unavailable',{status:429});
    try{
      for(let i=0;i<3;i++){
        const result=await cycle(env,NOW+i*60_000);
        assert.equal(result.status,'error');
      }
      const snapshot=await (await route(request('/snapshot'),env)).json();
      assert.equal(snapshot.halted,true);
      assert.equal(snapshot.enabled,false);
      const restart=await route(request('/admin/control',TOKEN,'POST',{action:'start'}),env);
      assert.equal(restart.status,409);
      const events=await (await route(request('/events'),env)).json();
      assert.ok(events.events.some(x=>x.kind==='risk-halt'));
      assert.ok(events.nextCursor > 0);
      const replay=await (await route(request('/events?after='+events.nextCursor),env)).json();
      assert.deepEqual(replay.events,[]);
      assert.equal(replay.nextCursor,events.nextCursor);
    }finally{globalThis.fetch=original;}
  });
});
