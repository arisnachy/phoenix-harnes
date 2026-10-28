import {MAX_PER_TICK, MAX_UNIVERSE, SIMULATED_SLIPPAGE, FEE_RATE,
  analyze, exitPlan, freshState, marketValue, paperFill, parseKlines,
  pickUniverse, riskBudget} from './strategy.mjs';

const BASE='https://data-api.binance.vision';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const emit=(state,kind,summary,now,symbol='')=>{
  const id=kind+':'+now+':'+symbol;
  if(!state.events.some(e=>e.id===id)){
    const event={id,kind,summary,at:now,symbol};
    state.events.push(event);
    state.pendingEvents=[...(state.pendingEvents||[]),event];
  }
  state.events=state.events.slice(-300);
};
async function market(path){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),7000);
  try{
    const response=await fetch(BASE+path,{signal:controller.signal});
    if(!response.ok)throw new Error(response.status===429?'market-rate-limited':'market-http-'+response.status);
    return await response.json();
  }finally{clearTimeout(timeout)}
}
async function read(db){
  await db.prepare('INSERT OR IGNORE INTO engine_state(id,revision,document) VALUES(1,0,?)')
    .bind(JSON.stringify(freshState())).run();
  const row=await db.prepare('SELECT revision,document FROM engine_state WHERE id=1').first();
  if(!row)throw new Error('missing-ledger');
  const state=JSON.parse(row.document);
  if(state.schema!==1 || typeof state.positions!=='object'||!Array.isArray(state.journal))
    throw new Error('incompatible-ledger');
  state.revision=row.revision;return state;
}
async function write(db,state){
  const previous=state.revision;
  const next={...state,revision:previous+1};
  const result=await db.prepare('UPDATE engine_state SET document=?,revision=revision+1 WHERE id=1 AND revision=?')
    .bind(JSON.stringify(next),previous).run();
  if(result.meta?.changes!==1)throw new Error('optimistic-lock-conflict');
  return next;
}
async function flushEvents(db,state){
  if(!state.pendingEvents?.length)return;
  for(const event of state.pendingEvents){
    await db.prepare('INSERT OR IGNORE INTO event_log(id,at,payload) VALUES(?,?,?)')
      .bind(event.id,event.at,JSON.stringify(event)).run();
  }
  // This clear becomes durable on the next state update; replays before then
  // are harmless because event_log.id has a UNIQUE constraint.
  state.pendingEvents=[];
}
async function discover(state,now){
  if(state.universe.length && now-state.universeUpdated<86_400_000)return;
  const [exchange,tickers]=await Promise.all([
    market('/api/v3/exchangeInfo'),market('/api/v3/ticker/24hr')]);
  const symbols=pickUniverse(exchange,tickers,MAX_UNIVERSE);
  if(symbols.length<3)throw new Error('insufficient-market-universe');
  state.universe=symbols;state.universeUpdated=now;state.cursor=0;
}
function select(state){
  const n=Math.min(MAX_PER_TICK,state.universe.length), out=[];
  for(let i=0;i<n;i++)out.push(state.universe[(state.cursor+i)%state.universe.length]);
  state.cursor=(state.cursor+n)%state.universe.length;return out;
}
function mark(state,quotes){
  marketValue(state,quotes);
  for(const p of Object.values(state.positions)){
    p.unrealizedPnl=p.quantity*quotes[p.symbol]-p.cost;
    p.unrealizedPct=100*p.unrealizedPnl/p.cost;
  }
}
async function cycle(env,now=Date.now()){
  if(!env.DB)throw new Error('D1_NOT_CONFIGURED');
  const state=await read(env.DB);
  if(!state.enabled||state.halted){
    if(state.pendingEvents?.length){
      await flushEvents(env.DB,state);
      await write(env.DB,state);
    }
    return {status:'disabled'};
  }
  // Complete any interrupted event publication before processing new signals.
  await flushEvents(env.DB,state);
  const slot=Math.floor(now/60_000);
  // Unique fence makes overlapping or retried Cron events no-ops.
  const fence=await env.DB.prepare('INSERT OR IGNORE INTO run_fence(slot,at) VALUES(?,?)')
    .bind(slot,now).run();
  if(fence.meta?.changes!==1)return {status:'duplicate',slot};
  try{
    const day=new Date(now).toISOString().slice(0,10);
    if(day!==state.day){state.day=day;state.dayLoss=0;state.dayStartEquity=state.equity;}
    await discover(state,now);
    const names=Object.keys(state.positions);
    const selected=select(state);
    const quotesRaw=names.length?await market('/api/v3/ticker/price?symbols='+
      encodeURIComponent(JSON.stringify(names))):[];
    const quotes=Object.fromEntries(quotesRaw.map(q=>[q.symbol,Number(q.price)]));
    mark(state,quotes);
    let decision='hold';
    for(const p of Object.values(state.positions)){
      const current=quotes[p.symbol];
      if(!(current>0))throw new Error('missing-position-mark');
      const reason=current<=p.plan.stop?'stop-loss':
        current>=p.plan.tp2?'tp2':
          current>=p.plan.tp1&&!p.plan.tp1Done?'tp1':null;
      if(!reason)continue;
      const quantity=reason==='tp1'?p.quantity*p.plan.takeFraction:p.quantity;
      const after=paperFill(state,{id:'virtual:'+slot+':'+p.symbol+':'+reason,at:now,
        symbol:p.symbol,side:'sell',price:current*(1-SIMULATED_SLIPPAGE),quantity,
        strategy:p.strategy,reason});
      Object.assign(state,after);decision=reason;
      emit(state,'paper-exit',reason+' virtual '+p.symbol,now,p.symbol);
      break;
    }
    if(decision==='hold'){
      const scanned=await Promise.allSettled(selected.map(symbol=>market(
        '/api/v3/klines?symbol='+symbol+'&interval=15m&limit=80').then(raw=>
          analyze(symbol,parseKlines(raw,now,900_000)))));
      const signals=scanned.map((res,i)=>res.status==='fulfilled'?res.value:
        {symbol:selected[i],action:'hold',score:0,strategy:'market-error',
          reason:'Market evidence unavailable'});
      signals.sort((a,b)=>b.score-a.score);
      state.signals=signals;
      const candidate=signals.find(s=>s.action==='buy' && s.score>=70);
      if(candidate){
        const budget=riskBudget(state,candidate,quotes);
        if(budget>=10){
          const price=candidate.price*(1+SIMULATED_SLIPPAGE);
          const quantity=budget/(price*(1+FEE_RATE));
          const next=paperFill(state,{id:'virtual:'+slot+':'+candidate.symbol+':buy',at:now,
            symbol:candidate.symbol,side:'buy',price,quantity,
            strategy:candidate.strategy,reason:candidate.reason,
            plan:exitPlan(price,candidate.atr,candidate.strategy)});
          Object.assign(state,next);decision='buy';
          emit(state,'paper-entry','Entry virtual '+candidate.symbol,now,candidate.symbol);
        }else emit(state,'risk-review','Entry blocked by deterministic risk gate',
          now,candidate.symbol);
      }
    }
    const marks={...quotes};
    for(const p of Object.values(state.positions))if(!(marks[p.symbol]>0))marks[p.symbol]=p.mark;
    mark(state,marks);
    if((state.maxEquity>0&&state.equity<=state.maxEquity*.95)||
       state.dayLoss>=state.dayStartEquity*.03){
      state.enabled=false;state.halted=true;emit(state,'risk-halt','Drawdown/daily-loss circuit breaker',now);
    }
    state.lastScan=now;state.lastError=null;state.failureCount=0;
    await write(env.DB,state);
    await flushEvents(env.DB,state);
    return {status:state.halted?'halted':'ok',slot,decision,scanned:selected.length,
      universe:state.universe.length,positions:Object.keys(state.positions).length};
  }catch(error){
    state.lastError=error instanceof Error?error.message:'unknown-market-error';
    state.failureCount++;
    if(state.failureCount>=3){
      state.halted=true;state.enabled=false;
      emit(state,'risk-halt','3 consecutive provider/execution failures',now);
    }
    try{
      await write(env.DB,state);
      await flushEvents(env.DB,state);
    }catch{ /* never conceal error as a confirmed fill */ }
    return {status:'error',reason:state.lastError,halted:state.halted};
  }
}
function tokenMatches(req,env){
  const token=env.ADMIN_TOKEN;
  const actual=req.headers.get('authorization');
  if(typeof token!=='string'||token.length<32||typeof actual!=='string')return false;
  const expected='Bearer '+token;
  let mismatch=actual.length^expected.length;
  for(let i=0;i<Math.max(actual.length,expected.length);i++)
    mismatch|=(actual.charCodeAt(i)||0)^(expected.charCodeAt(i)||0);
  return mismatch===0;
}
async function route(req,env){
  const url=new URL(req.url);
  if(url.pathname==='/health'&&req.method==='GET')
    return json({service:'phoenix-trading-cloud',mode:'paper',status:'reachable'});
  if(!tokenMatches(req,env))return json({error:'unauthorized'},401);
  const state=await read(env.DB);
  if(url.pathname==='/snapshot'&&req.method==='GET')
    return json({mode:'paper',revision:state.revision,enabled:state.enabled,halted:state.halted,
      cash:state.cash,equity:state.equity,realizedPnl:state.realized,
      lastScan:state.lastScan,lastError:state.lastError,universeCount:state.universe.length,
      positions:state.positions,signals:state.signals,journal:state.journal.slice(-50),
      warning:'Virtual trading only; software stops execute at the next Cron, not at Binance.'});
  if(url.pathname==='/events'&&req.method==='GET'){
    const cursor=Number(url.searchParams.get('after')||0);
    if(!Number.isSafeInteger(cursor)||cursor<0)return json({error:'invalid-cursor'},400);
    const rows=await env.DB.prepare(
      'SELECT seq,payload FROM event_log WHERE seq>? ORDER BY seq ASC LIMIT 100'
    ).bind(cursor).all();
    const events=(rows.results||[]).map(row=>({...JSON.parse(row.payload),seq:row.seq}));
    return json({events,nextCursor:events.at(-1)?.seq??cursor,revision:state.revision});
  }
  if(url.pathname==='/admin/control'&&req.method==='POST'){
    if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'json-only'},400);
    if(Number(req.headers.get('content-length')||0)>2048)return json({error:'too-large'},413);
    let body;try{body=await req.json()}catch{return json({error:'invalid-json'},400)}
    if(!body||typeof body!=='object'||Object.keys(body).some(k=>k!=='action')||
       !['start','stop'].includes(body.action))return json({error:'invalid-command'},400);
    if(body.action==='start'&&state.halted)return json({error:'risk-halt-needs-review'},409);
    state.enabled=body.action==='start';
    await write(env.DB,state);
    return json({mode:'paper',enabled:state.enabled,halted:state.halted});
  }
  return json({error:'not-found'},404);
}
export {cycle,route};
export default {
  fetch:route,
  scheduled(event,env,ctx){ctx.waitUntil(cycle(env,event.scheduledTime));},
};
