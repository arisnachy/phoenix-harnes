import { describe, expect, it } from 'vitest'
import { AmbientIntelligence, distanceKm, summarizeNeighbors } from '../src/ambient-intelligence.ts'

describe('ambient intelligence',()=>{
  it('does not invent location or contact providers for overview',async()=>{
    let calls=0
    const core=new AmbientIntelligence(async()=>{calls++;throw Error('offline')},async()=>[],()=>({}))
    expect(await core.observe('overview')).toMatchObject({location:null,cosmicAddress:['Earth','Solar System','Milky Way','Local Group','Observable universe']})
    expect(calls).toBe(0)
  })
  it('redacts and deduplicates private neighbors without scanning',()=>{
    const result=summarizeNeighbors([{IPAddress:'192.168.0.2',State:'Reachable'},{IPAddress:'192.168.0.2',State:'Stale'},{IPAddress:'8.8.8.8',State:'Reachable'}])
    expect(result).toMatchObject({knownPrivateNeighbors:1,reachable:1,scanPerformed:false})
    expect(JSON.stringify(result)).not.toContain('192.168')
  })
  it('ranks configured places and distinguishes straight line from route',async()=>{
    const core=new AmbientIntelligence(async()=>({code:'Ok',routes:[{distance:1000,duration:120}]}),async()=>[],()=>({location:{lat:19,lon:-70},places:[{name:'A',category:'hospital',lat:19.1,lon:-70},{name:'B',category:'hospital',lat:19.01,lon:-70}],osrmPort:5000}))
    expect(await core.observe('places','hospital')).toMatchObject({places:[{name:'B'},{name:'A'}]})
    expect(await core.observe('route','{"lat":19.1,"lon":-70}')).toMatchObject({status:'computed',durationSeconds:120,liveTraffic:false})
    expect(distanceKm({lat:0,lon:0},{lat:0,lon:1})).toBeCloseTo(111.2,1)
  })
  it('caches valid public observations and reports failures',async()=>{
    let calls=0,now=Date.parse('2026-11-26T12:00:00Z')
    const core=new AmbientIntelligence(async()=>{calls++;return [{time_tag:'2026-11-26T09:00:00',Kp:3}]},async()=>[],()=>({}),()=>now)
    expect(await core.observe('space')).toMatchObject({status:'retrieved',data:{kp:3,stale:false}})
    expect(await core.observe('space')).toMatchObject({status:'cached'})
    expect(calls).toBe(1)
    now+=360000
    expect(await core.observe('space')).toMatchObject({status:'retrieved'})
    expect(await core.observe('world')).toMatchObject({status:'unavailable'})
  })
})
