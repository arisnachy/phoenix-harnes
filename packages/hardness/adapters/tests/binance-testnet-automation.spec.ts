import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,describe,expect,it} from 'vitest'
import {BinanceTestnetAutomation} from '../src/binance-testnet-automation.ts'
import type {BinanceSpotTestnet,BinanceTestnetOrderReceipt} from '../src/binance-spot-testnet.ts'
import type {BinancePublicMarket,BinanceCandle} from '../src/binance-paper.ts'

const BAR=900_000
const NOW=80*BAR
const roots:string[]=[]
afterEach(()=>{for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true})})
function candles():BinanceCandle[]{
  return Array.from({length:80},(_,i)=>{
    const close=100+i*.5+(i===79?2:0)
    return {openTime:i*BAR,closeTime:(i+1)*BAR-1,
      open:close,high:close*1.005,low:close*.995,close,
      volume:i===79?20:10,quoteVolume:close*10,trades:100}
  })
}
function makeMarket():BinancePublicMarket{
  return {async price(){return 141.5},async prices(){return {BTCUSDT:141.5}},
    async candles(){return candles()}}
}
function setup(){
  const root=mkdtempSync(join(tmpdir(),'phoenix-testnet-autonomous-'))
  roots.push(root)
  let price=141.5
  let usdt=1000
  let btc=0
  let orderAttempts=0
  let acknowledge=true
  const receipts=new Map<string,BinanceTestnetOrderReceipt>()
  const sent:Array<{side:string;symbol:string;clientOrderId?:string}>=[]
  const testnet={
    async status(){return {mode:'testnet' as const,configured:true,connected:true,canTrade:true,
      balances:[{asset:'USDT',free:String(usdt),locked:'0'},
        {asset:'BTC',free:String(btc),locked:'0'}],nextAction:'ready'}},
    async quote(){return price},
    async lotSize(){return {stepSize:'0.00000100',minQty:'0.00000100',maxQty:'100'}},
    async order(input:{symbol:string;side:'BUY'|'SELL';clientOrderId?:string;
      quoteUsdt?:number;quantity?:number}){
      orderAttempts++
      sent.push({side:input.side,symbol:input.symbol,clientOrderId:input.clientOrderId})
      const quantity=input.side==='BUY'?input.quoteUsdt!/price:input.quantity!
      const quote=quantity*price
      if(input.side==='BUY'){usdt-=quote;btc+=quantity}
      else{usdt+=quote;btc-=quantity}
      const receipt:BinanceTestnetOrderReceipt={mode:'testnet',symbol:input.symbol,side:input.side,
        orderId:orderAttempts,status:'FILLED',executedQty:String(quantity),cummulativeQuoteQty:String(quote)}
      if(input.clientOrderId)receipts.set(input.clientOrderId,receipt)
      if(!acknowledge)throw new Error('response lost after provider accepted')
      return receipt
    },
    async orderStatus({clientOrderId}:{clientOrderId:string}){
      const receipt=receipts.get(clientOrderId)
      if(!receipt)throw new Error('not found')
      return receipt
    },
  }
  const file=join(root,'testnet-automation.json')
  const worker=new BinanceTestnetAutomation(file,testnet as unknown as BinanceSpotTestnet,makeMarket())
  return {worker,file,testnet,price:(value:number)=>{price=value},
    acknowledge:(value:boolean)=>{acknowledge=value},sent,
    get attempts(){return orderAttempts},
  }
}
describe('Binance Spot TESTNET autonomous operation',()=>{
  it('stays OFF by default, executes a verified fake-funds BUY and then TP2 SELL',async()=>{
    const {worker,price,sent}=setup()
    await worker.restore()
    expect(worker.snapshot()).toMatchObject({mode:'testnet',enabled:false,journal:[]})
    await worker.step(NOW)
    expect(sent).toHaveLength(0)
    const started=await worker.start(['BTCUSDT'])
    // start() uses the live clock; mock candles are deliberately stale today,
    // so the fixed-cycle call below must instead be used to produce a closed-bar signal.
    expect(started.enabled).toBe(true)
    await worker.step(NOW)
    expect(worker.snapshot().journal.at(-1)?.side).toBe('BUY')
    expect(worker.snapshot().positions.BTCUSDT?.quantity).toBeGreaterThan(0)
    price(155)
    await worker.step(NOW+60_000)
    const snapshot=worker.snapshot()
    expect(snapshot.journal.map(x=>x.side)).toEqual(['BUY','SELL'])
    expect(snapshot.positions.BTCUSDT).toBeUndefined()
    expect(snapshot.realizedPnlUsdt).toBeGreaterThan(0)
    expect(sent.every(x=>x.clientOrderId?.startsWith('px'))).toBe(true)
    await worker.stop()
  })
  it('never resubmits after an accepted order response was lost; preserves intention over restart',async()=>{
    const {worker,file,testnet,acknowledge,sent}=setup()
    acknowledge(false)
    await worker.start(['BTCUSDT'])
    await worker.step(NOW)
    expect(worker.snapshot()).toMatchObject({mode:'testnet',enabled:false,halted:true,
      lastError:'testnet-order-needs-reconciliation'})
    expect(worker.snapshot().pending?.clientOrderId).toMatch(/^px[a-f0-9]{30}$/)
    expect(sent).toHaveLength(1)
    const restarted=new BinanceTestnetAutomation(file,testnet as unknown as BinanceSpotTestnet,makeMarket())
    await restarted.restore()
    await restarted.step(NOW+60_000)
    expect(restarted.snapshot().pending?.clientOrderId).toBe(worker.snapshot().pending?.clientOrderId)
    expect(sent).toHaveLength(1)
    await restarted.dispose()
  })
  it('cannot create orders without exchange authentication and test funds',async()=>{
    const {worker,testnet,sent}=setup()
    testnet.status=async()=>({mode:'testnet' as const,configured:true,connected:false,
      canTrade:false,balances:[],nextAction:'no-auth'})
    await expect(worker.start(['BTCUSDT'])).rejects.toThrow('not authenticated')
    expect(worker.snapshot().enabled).toBe(false)
    expect(sent).toHaveLength(0)
  })
})
