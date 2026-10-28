import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { evaluateBinanceAdaptiveSignal, type BinanceAdaptiveSignal } from './binance-adaptive.ts'
import { BinancePublicMarketClient, type BinancePublicMarket } from './binance-paper.ts'
import { BinanceSpotTestnet, type BinanceTestnetOrderReceipt } from './binance-spot-testnet.ts'

const POLL_MS = 60_000
const MAX_SYMBOLS = 12
const ENTRY_SCORE = 75
const MAX_POSITIONS = 2
const MAX_DAILY_ORDERS = 10

type Position = {
  symbol: string
  quantity: number
  basisUsdt: number
  entryPrice: number
  stop: number
  tp1: number
  tp2: number
  tp1Done: boolean
  strategy: string
}
type PendingOrder = {
  clientOrderId: string
  symbol: string
  side: 'BUY' | 'SELL'
  requestedAt: string
  strategy: string
  reason: string
  signalBar: number
  quoteUsdt?: number
  quantity?: number
}
type FilledOrder = {
  clientOrderId: string
  orderId: number
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: number
  quoteUsdt: number
  strategy: string
  reason: string
  at: string
}
export type BinanceTestnetAutomationState = {
  schema: 1
  mode: 'testnet'
  enabled: boolean
  halted: boolean
  symbols: string[]
  lastAttemptAt?: string
  lastScanAt?: string
  lastDecision: string
  lastError?: string
  lastSignals: Array<{symbol: string; score: number; strategy: string; action: string; reason: string}>
  failureCount: number
  dailyOrders: number
  day: string
  dayStartEquity: number
  dayRealizedLoss: number
  lastEntryBar: Record<string, number>
  positions: Record<string, Position>
  pending?: PendingOrder
  journal: FilledOrder[]
  realizedPnlUsdt: number
}
const fresh = (): BinanceTestnetAutomationState => ({
  schema:1,mode:'testnet',enabled:false,halted:false,symbols:['BTCUSDT','ETHUSDT','SOLUSDT'],
  lastDecision:'Not armed: Testnet requires explicit authorization',
  lastSignals:[],failureCount:0,dailyOrders:0,day:'',dayStartEquity:0,
  dayRealizedLoss:0,lastEntryBar:{},positions:{},journal:[],realizedPnlUsdt:0,
})
const validSymbols = (symbols: readonly string[]): string[] => {
  const cleaned=symbols.map(x=>x.trim().toUpperCase())
  if(!cleaned.length||cleaned.length>MAX_SYMBOLS||new Set(cleaned).size!==cleaned.length
    ||cleaned.some(x=>!/^[A-Z0-9]{3,16}USDT$/u.test(x)))throw new Error('1-12 unique Spot USDT pairs required')
  return cleaned
}
const orderId = (symbol: string, side: string, reason: string, bar: number): string =>
  'px'+createHash('sha256').update(symbol+'/'+side+'/'+reason+'/'+bar).digest('hex').slice(0,30)
const finite = (x: number): boolean => Number.isFinite(x) && x>0
function sellQuantity(qty: number, rule: {stepSize:string;minQty:string;maxQty:string}): number {
  const step=Number(rule.stepSize),min=Number(rule.minQty),max=Number(rule.maxQty)
  if(!finite(step)||!finite(min)||!finite(max)||!finite(qty))return 0
  const decimals=Math.min(8,(rule.stepSize.split('.')[1]??'').length)
  const size=Number((Math.floor(qty/step+1e-9)*step).toFixed(decimals))
  return size>=min && size<=max && size<=100 && size<=qty+1e-9 ? size:0
}

/**
 * Authorized fake-funds Spot Testnet runner. It uses dedicated Testnet HMAC keys
 * only inside BinanceSpotTestnet; no REAL account route and no LLM polling.
 * A pre-persisted client-order intention is reconciled before another request,
 * preventing a restart/network timeout from silently doubling an order.
 */
export class BinanceTestnetAutomation {
  private state: BinanceTestnetAutomationState = fresh()
  private loaded=false
  private timer: ReturnType<typeof setInterval>|undefined
  private active: Promise<void>|undefined
  private sink: ((event:{kind:'fill'|'risk-halt';detail:string;symbol:string})=>void)|undefined

  constructor(
    private readonly file: string,
    private readonly testnet: BinanceSpotTestnet,
    private readonly market: BinancePublicMarket = new BinancePublicMarketClient(),
  ) {}

  setAttentionSink(sink: typeof this.sink): void { this.sink=sink }
  private notify(kind: 'fill'|'risk-halt', detail: string, symbol: string): void {
    try{this.sink?.({kind,detail,symbol})}catch{/* notifications never affect trading */}
  }
  private async save(): Promise<void> {
    await mkdir(dirname(this.file),{recursive:true,mode:0o700})
    const temp=this.file+'.'+randomUUID()+'.tmp'
    await writeFile(temp,JSON.stringify(this.state)+'\n',{mode:0o600,encoding:'utf8'})
    await rename(temp,this.file)
  }
  async restore(): Promise<void> {
    if(this.loaded)return
    this.loaded=true
    try{
      const candidate:unknown=JSON.parse(await readFile(this.file,'utf8'))
      if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))throw new Error('Invalid persisted Testnet journal')
      const saved=candidate as Record<string,unknown>
      if(saved.schema!==1||saved.mode!=='testnet'||typeof saved.enabled!=='boolean'
        ||typeof saved.halted!=='boolean'||!Array.isArray(saved.symbols)
        ||!saved.symbols.every(x=>typeof x==='string')||!saved.positions
        ||typeof saved.positions!=='object'||Array.isArray(saved.positions)
        ||!Array.isArray(saved.journal)||!Array.isArray(saved.lastSignals)
        ||typeof saved.failureCount!=='number')throw new Error('Invalid persisted Testnet journal')
      validSymbols(saved.symbols)
      this.state=candidate as BinanceTestnetAutomationState
      if(this.state.enabled&&!this.state.halted){this.schedule();void this.step()}
    }catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT')return
      this.state={...fresh(),halted:true,lastError:'corrupt-testnet-ledger-needs-review'}
    }
  }
  private schedule(): void {
    if(this.timer!==undefined)clearInterval(this.timer)
    if(!this.state.enabled||this.state.halted)return
    this.timer=setInterval(()=>{void this.step()},POLL_MS)
    this.timer.unref()
  }
  async start(symbols: readonly string[]): Promise<BinanceTestnetAutomationState> {
    await this.restore()
    if(this.state.halted||this.state.pending)throw new Error('Testnet has a pending order or risk halt; manual reconciliation required')
    const ready=await this.testnet.status()
    if(!ready.connected||ready.canTrade!==true)throw new Error('Spot Testnet account is not authenticated for TESTING orders')
    this.state.symbols=validSymbols(symbols)
    this.state.enabled=true
    delete this.state.lastError
    this.state.failureCount=0
    await this.save()
    this.schedule()
    await this.step()
    return this.snapshot()
  }
  async stop(): Promise<BinanceTestnetAutomationState> {
    await this.restore()
    this.state.enabled=false
    if(this.timer!==undefined)clearInterval(this.timer)
    this.timer=undefined
    await this.active?.catch(()=>undefined)
    await this.save()
    return this.snapshot()
  }
  /** User-visible, READ-only recovery of uncertain Testnet order receipts. */
  async reconcilePending(): Promise<BinanceTestnetAutomationState> {
    await this.restore()
    const intent=this.state.pending
    if(!intent)return this.snapshot()
    try{
      const receipt=await this.testnet.orderStatus({
        symbol:intent.symbol,clientOrderId:intent.clientOrderId,
      })
      await this.settle(receipt)
      if(!this.state.pending){
        this.state.lastDecision='provider-order-reconciled'
        await this.save()
      }
    }catch{
      this.state.enabled=false
      this.state.halted=true
      this.state.lastError='testnet-order-needs-reconciliation'
      await this.save()
    }
    return this.snapshot()
  }

  /** A separate deliberate owner review can clear a Testnet-only safety halt. */
  async clearReviewedHalt(): Promise<BinanceTestnetAutomationState> {
    await this.restore()
    if(this.state.pending)throw new Error('Cannot clear Testnet halt with an unresolved exchange order')
    if(this.state.dayStartEquity>0
      && this.state.dayRealizedLoss>=this.state.dayStartEquity*.03)
      throw new Error('Daily Testnet loss cap remains active')
    if(this.state.enabled)throw new Error('Stop Testnet before clearing a safety halt')
    this.state.halted=false
    this.state.failureCount=0
    delete this.state.lastError
    await this.save()
    return this.snapshot()
  }

  snapshot(): BinanceTestnetAutomationState {return structuredClone(this.state)}
  private async halt(reason: string, symbol='BTCUSDT'): Promise<void> {
    this.state.enabled=false;this.state.halted=true;this.state.lastError=reason
    this.state.lastDecision=reason
    if(this.timer!==undefined)clearInterval(this.timer)
    this.timer=undefined
    await this.save()
    this.notify('risk-halt','Spot Testnet automatizado pausado: '+reason,symbol)
  }
  private async settle(receipt: BinanceTestnetOrderReceipt): Promise<void> {
    const intent=this.state.pending
    if(!intent||receipt.symbol!==intent.symbol||receipt.side!==intent.side)
      throw new Error('testnet-order-reconciliation-mismatch')
    if(receipt.status!=='FILLED') {
      if(receipt.status==='NEW'||receipt.status==='PARTIALLY_FILLED') {
        this.state.lastDecision='awaiting-provider-fill';await this.save();return
      }
      // Partial cancelled orders need manual review to avoid phantom balances.
      if(Number(receipt.executedQty)>0)throw new Error('partial-testnet-order-needs-review')
      if(['CANCELED','EXPIRED','REJECTED'].includes(receipt.status)){
        delete this.state.pending;this.state.lastDecision='provider-order-not-filled'
        await this.save();return
      }
      throw new Error('unknown-testnet-order-state')
    }
    const quantity=Number(receipt.executedQty),quote=Number(receipt.cummulativeQuoteQty)
    if(!finite(quantity)||!finite(quote))throw new Error('invalid-provider-fill-quantities')
    if(this.state.journal.some(row=>row.clientOrderId===intent.clientOrderId)){
      delete this.state.pending;await this.save();return
    }
    const price=quote/quantity
    if(receipt.side==='BUY'){
      if(this.state.positions[intent.symbol])throw new Error('unreconciled-existing-testnet-position')
      this.state.positions[intent.symbol]={
        symbol:intent.symbol,quantity,basisUsdt:quote,entryPrice:price,
        stop:price*.98,tp1:price*1.03,tp2:price*1.06,tp1Done:false,strategy:intent.strategy,
      }
      this.state.lastEntryBar[intent.symbol]=intent.signalBar
    }else{
      const position=this.state.positions[intent.symbol]
      if(!position||quantity>position.quantity+1e-8)throw new Error('untracked-testnet-sale')
      const fraction=Math.min(1,quantity/position.quantity)
      const basis=position.basisUsdt*fraction
      const pnl=quote-basis
      this.state.realizedPnlUsdt+=pnl
      this.state.dayRealizedLoss+=Math.max(0,-pnl)
      position.quantity=Math.max(0,position.quantity-quantity)
      position.basisUsdt=Math.max(0,position.basisUsdt-basis)
      // Exchange LOT_SIZE rounding can leave non-tradable fractional dust.
      // Keep the real provider balance authoritative, but do not carry a
      // phantom strategy position once a protective full exit is confirmed.
      if(position.quantity<1e-10
        || (intent.reason!=='tp1' && position.quantity<1e-6))
        delete this.state.positions[intent.symbol]
      else if(intent.reason==='tp1')position.tp1Done=true
    }
    this.state.journal.push({
      clientOrderId:intent.clientOrderId,orderId:receipt.orderId,symbol:intent.symbol,
      side:receipt.side,quantity,quoteUsdt:quote,strategy:intent.strategy,reason:intent.reason,
      at:new Date().toISOString(),
    })
    this.state.journal=this.state.journal.slice(-100)
    this.state.dailyOrders++
    delete this.state.pending
    this.state.lastDecision=receipt.side==='BUY'?'testnet-buy-filled':'testnet-sell-filled'
    await this.save()
    this.notify('fill',receipt.side+' Spot Testnet confirmado por Binance ('+intent.reason+')',intent.symbol)
  }
  private async submit(intent: PendingOrder): Promise<void> {
    // Write-ahead intent is durable BEFORE the exchange request.
    this.state.pending=intent
    await this.save()
    const receipt=await this.testnet.order({
      symbol:intent.symbol,side:intent.side,clientOrderId:intent.clientOrderId,
      ...(intent.side==='BUY'?{quoteUsdt:intent.quoteUsdt}:{quantity:intent.quantity}),
    })
    await this.settle(receipt)
  }
  private async run(now:number): Promise<void> {
    if(!this.state.enabled||this.state.halted)return
    this.state.lastAttemptAt=new Date(now).toISOString()
    await this.save()
    try{
      const account=await this.testnet.status()
      if(!account.connected||account.canTrade!==true) {
        await this.halt('testnet-account-unavailable');return
      }
      // Reconciliation always precedes new analysis, even after Host restart.
      if(this.state.pending){
        const intent=this.state.pending
        await this.settle(await this.testnet.orderStatus({
          symbol:intent.symbol,clientOrderId:intent.clientOrderId,
        }))
        if(this.state.pending)return
      }
      const today=new Date(now).toISOString().slice(0,10)
      const cash=Number(account.balances?.find(b=>b.asset==='USDT')?.free??0)
      if(this.state.day!==today){
        this.state.day=today;this.state.dailyOrders=0;this.state.dayRealizedLoss=0
        this.state.dayStartEquity=cash
      }
      if(this.state.dayStartEquity>0 && this.state.dayRealizedLoss>=this.state.dayStartEquity*.03){
        await this.halt('testnet-daily-loss-limit');return
      }
      if(this.state.dailyOrders>=MAX_DAILY_ORDERS){
        this.state.lastDecision='testnet-daily-order-limit';await this.save();return
      }
      // Always service existing software stops/TPs before considering a new BUY.
      for(const position of Object.values(this.state.positions)){
        const price=await this.testnet.quote(position.symbol)
        const reason=price<=position.stop?'stop-loss':
          price>=position.tp2?'tp2':!position.tp1Done&&price>=position.tp1?'tp1':undefined
        if(!reason)continue
        const limits=await this.testnet.lotSize(position.symbol)
        const available=Number(account.balances?.find(b=>b.asset===position.symbol.slice(0,-4))?.free??0)
        const desired=reason==='tp1'?position.quantity*.5:position.quantity
        const quantity=sellQuantity(Math.min(desired,available),limits)
        if(!finite(quantity) || quantity*price<10){
          this.state.lastDecision='exit-blocked-by-lot-size-or-balance'
          await this.save();return
        }
        await this.submit({
          symbol:position.symbol,side:'SELL',strategy:position.strategy,reason,
          quantity,requestedAt:new Date(now).toISOString(),signalBar:now,
          clientOrderId:orderId(position.symbol,'SELL',reason,now),
        })
        return
      }
      const signals:BinanceAdaptiveSignal[]=[]
      const barsBySymbol=new Map<string,number>()
      for(const symbol of this.state.symbols){
        try{
          const candles=await this.market.candles(symbol,'15m',80)
          const closed=candles.filter(bar=>bar.closeTime<=now).at(-1)
          if(closed)barsBySymbol.set(symbol,closed.closeTime)
          signals.push(evaluateBinanceAdaptiveSignal(symbol,candles,900_000,now))
        }catch{
          signals.push({symbol,regime:'range',strategy:'none',action:'hold',score:0,
            lastClose:0,reason:'Market candles unavailable'})
        }
      }
      this.state.lastSignals=signals.map(s=>({
        symbol:s.symbol,score:s.score,strategy:s.strategy,action:s.action,reason:s.reason,
      }))
      const verified=signals.filter(s=>!['Market candles unavailable',
        'Stale market data','No sufficient closed candles','Invalid or out-of-order market candles',
      ].includes(s.reason))
      if(verified.length===0)throw new Error('all-testnet-strategy-scans-failed')
      this.state.lastScanAt=new Date(now).toISOString()
      this.state.failureCount=0
      delete this.state.lastError
      const candidate=[...signals].sort((a,b)=>b.score-a.score).find(s=>s.action==='buy'
        && s.score>=ENTRY_SCORE && !this.state.positions[s.symbol]
        && this.state.lastEntryBar[s.symbol]!==barsBySymbol.get(s.symbol))
      if(!candidate){this.state.lastDecision='no-qualified-entry';await this.save();return}
      if(Object.keys(this.state.positions).length>=MAX_POSITIONS) {
        this.state.lastDecision='max-testnet-positions';await this.save();return
      }
      const quote=await this.testnet.quote(candidate.symbol)
      if(!finite(quote)||!finite(candidate.lastClose)||Math.abs(quote/candidate.lastClose-1)>.02){
        this.state.lastDecision='testnet-price-divergence';await this.save();return
      }
      // No more than 5% of available TESTNET cash, capped to 100 fake USDT.
      const exposure=Object.values(this.state.positions).reduce((s,p)=>s+p.quantity*p.entryPrice,0)
      const budget=Math.floor(Math.min(cash*.05,cash*.2-exposure,100)*100)/100
      if(!finite(budget)||budget<10||budget/quote>100) {
        this.state.lastDecision='insufficient-testnet-risk-budget';await this.save();return
      }
      await this.submit({
        symbol:candidate.symbol,side:'BUY',quoteUsdt:budget,strategy:candidate.strategy,
        reason:candidate.reason,signalBar:barsBySymbol.get(candidate.symbol)??0,
        requestedAt:new Date(now).toISOString(),
        clientOrderId:orderId(candidate.symbol,'BUY',candidate.strategy,barsBySymbol.get(candidate.symbol)??0),
      })
      delete this.state.lastError;this.state.failureCount=0
    }catch{
      // Never echo private provider failures or key-bearing requests.
      this.state.failureCount++
      this.state.lastError=this.state.pending?'testnet-order-needs-reconciliation':'testnet-cycle-failed'
      if(this.state.pending||this.state.failureCount>=3)await this.halt(this.state.lastError)
      else await this.save()
    }
  }
  async step(now=Date.now()): Promise<void> {
    await this.restore()
    if(this.active)return this.active
    const job=this.run(now)
    this.active=job
    try{await job}finally{if(this.active===job)this.active=undefined}
  }
  async dispose(): Promise<void> {
    if(this.timer!==undefined)clearInterval(this.timer)
    this.timer=undefined
    await this.active?.catch(()=>undefined)
  }
}

const byPath=new Map<string,{engine:BinanceTestnetAutomation;refs:number}>()
export function acquireBinanceTestnetAutomation(file:string,testnet:BinanceSpotTestnet):{
  readonly engine:BinanceTestnetAutomation
  release():void
}{
  const key=resolve(file)
  let entry=byPath.get(key)
  if(!entry){
    entry={engine:new BinanceTestnetAutomation(key,testnet),refs:0}
    byPath.set(key,entry)
  }
  entry.refs++
  const current=entry
  return {engine:current.engine,release(){
    current.refs--
    if(current.refs===0&&byPath.get(key)===current){
      byPath.delete(key);void current.engine.dispose()
    }
  }}
}
