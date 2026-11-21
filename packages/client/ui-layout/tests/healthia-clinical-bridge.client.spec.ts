import { describe, expect, it, vi } from 'vitest'
import { probeClinicalSession } from '../src/client/HealthiaClinicalBridge.ts'

const response = (status:number, value:unknown):Response => new Response(JSON.stringify(value), {
  status,headers:{'content-type':'application/json'},
})
describe('Healthia readonly authenticated bridge', () => {
  it('projects only the authenticated role, never CSRF or patient identity', async () => {
    const fetcher=vi.fn(async()=>response(200,{
      actor:{username:'private-clinician',org:'private-hospital',role:'clinician'},
      csrf:'SENSITIVE_SENTINEL',patient:{name:'private-patient'},
    }))
    const result=await probeClinicalSession(fetcher as unknown as typeof fetch)
    expect(result).toEqual({status:'authenticated',role:'clinician',patientPortal:'not-verified'})
    const serialized=JSON.stringify(result)
    for(const secret of ['SENSITIVE_SENTINEL','private-clinician','private-hospital','private-patient']) {
      expect(serialized).not.toContain(secret)
    }
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]?.[0]).toBe('/health/api/session')
  })
  it('rejects stale, unauthenticated and unknown roles without inferring access', async () => {
    expect(await probeClinicalSession(async()=>response(401,{error:'denied'}))).toMatchObject({status:'locked',role:null})
    expect(await probeClinicalSession(async()=>response(404,{error:'not-enabled'}))).toMatchObject({status:'unavailable',role:null})
    expect(await probeClinicalSession(async()=>response(200,{actor:{role:'patient'},csrf:'SENSITIVE'}))).toMatchObject({status:'locked',role:null})
    expect(await probeClinicalSession(async()=>{throw new Error('offline')})).toMatchObject({status:'unavailable'})
  })
})
