import { createHmac } from 'node:crypto'
import { describe,expect,it,vi } from 'vitest'
import { BinanceSpotRealReadOnly } from '../src/binance-spot-real-auth.ts'

const creds=()=>({apiKey:'PROD_KEY_HMAC_1234567',secret:'PROD_SECRET_HMAC_1234567'})
describe('Binance REAL Spot read-only HMAC validation',()=>{
  it('reads only the real signed account endpoint, never TESTNET or a write',async()=>{
    const transport=vi.fn(async(input:string,init:RequestInit)=>{
      const url=new URL(input)
      expect(url.origin).toBe('https://api.binance.com')
      expect(url.pathname).toBe('/api/v3/account')
      expect(init.method).toBe('GET')
      expect(init.redirect).toBe('error')
      expect(init.headers).toEqual({'X-MBX-APIKEY':'PROD_KEY_HMAC_1234567'})
      const params=new URLSearchParams(url.search)
      const signature=params.get('signature')
      expect(signature).toBeTruthy()
      params.delete('signature')
      expect(signature).toBe(createHmac('sha256',creds().secret).update(params.toString()).digest('hex'))
      return new Response(JSON.stringify({canTrade:true,balances:[]}),{status:200})
    })
    const reader=new BinanceSpotRealReadOnly(creds,transport as never,()=>1700000000000)
    expect(await reader.status()).toMatchObject({
      mode:'real-readonly',configured:true,connected:true,canRead:true,tradingAuthorized:false,
    })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(await reader.status())).not.toContain(creds().secret)
  })
  it('distinguishes provider IP/permission and geo restrictions from bad keys',async()=>{
    for(const [code,http,issue] of [
      [-2015,401,'ip-or-permission'],[-1022,400,'signature-rejected'],
      [-2014,400,'invalid-key-format'],[undefined,403,'access-restricted'],
    ] as const){
      const reader=new BinanceSpotRealReadOnly(creds,async()=>new Response(
        JSON.stringify({code,msg:'secret value '+creds().secret}),{status:http}))
      const status=await reader.status()
      expect(status).toMatchObject({connected:false,issue,tradingAuthorized:false})
      expect(JSON.stringify(status)).not.toContain(creds().secret)
    }
  })
  it('cannot authenticate without private HMAC credentials',async()=>{
    const reader=new BinanceSpotRealReadOnly(()=>undefined,vi.fn() as never)
    expect(await reader.status()).toMatchObject({configured:false,connected:false})
    expect('order' in reader).toBe(false)
  })
})
