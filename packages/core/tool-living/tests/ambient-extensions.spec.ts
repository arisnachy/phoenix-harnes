import { describe, expect, it } from 'vitest'
import { AmbientExtensions, geoFeatures, horizonsUrl, lunarEstimate, parseHorizons, validLocation } from '../src/ambient-extensions.ts'

describe('ambient extensions',()=>{
  const now=Date.parse('2026-11-26T12:00:00Z')
  it('requires opt-in and validates location freshness',async()=>{
    let calls=0
    const locate=async()=>{calls++;return {lat:19,lon:-70,accuracy:20,timestamp:new Date(now).toISOString()}}
    const denied=new AmbientExtensions(async()=>null,()=>({}),()=>now,locate)
    expect(await denied.observe('location','')).toMatchObject({status:'permission-not-configured'})
    expect(calls).toBe(0)
    const allowed=new AmbientExtensions(async()=>null,()=>({allowWindowsLocation:true}),()=>now,locate)
    expect(await allowed.observe('location','')).toMatchObject({status:'observed',accuracyMeters:20})
    expect(validLocation({lat:19,lon:-70,accuracy:20,timestamp:'2000-01-01'},now)).toBeNull()
  })
  it('uses a fixed JPL endpoint and preserves ephemeris rows',async()=>{
    expect(horizonsUrl('https://example.com',now)).toBeNull()
    expect(horizonsUrl('mars',now)).toContain('ssd.jpl.nasa.gov')
    const result='Date R.A.\n$$SOE\n2026-Nov-26, 12 00, 20\n$$EOE'
    expect(parseHorizons({result}).rows).toHaveLength(1)
    const x=new AmbientExtensions(async()=>({result}),()=>({}),()=>now)
    expect(await x.observe('ephemeris','mars')).toMatchObject({status:'retrieved',body:'mars'})
    expect(await x.observe('ephemeris','mars')).toMatchObject({status:'cached'})
    expect(lunarEstimate(Date.UTC(2000,0,6,18,14))).toMatchObject({phase:'new',illuminationPercent:0})
  })
  it('imports point features only and does not send coordinates by default',async()=>{
    expect(geoFeatures({type:'FeatureCollection',features:[{geometry:{type:'Point',coordinates:[-70,19]},properties:{name:'Hospital',amenity:'hospital'}}]})).toEqual([{lat:19,lon:-70,name:'Hospital',category:'hospital'}])
    const x=new AmbientExtensions(async()=>{throw Error('unexpected')},()=>({location:{lat:19,lon:-70}}),()=>now)
    expect(await x.observe('weather','')).toMatchObject({status:'permission-not-configured'})
  })
  it('deduplicates observation changes and does not claim alerts delivered',async()=>{
    const x=new AmbientExtensions(async()=>null,()=>({}),()=>now)
    await x.remember({status:'retrieved',data:{kp:6}})
    await x.remember({status:'cached',data:{kp:6}})
    await x.remember({status:'retrieved',data:{kp:8,stale:true}})
    expect(await x.observe('graph','')).toMatchObject({events:[{kind:'geomagnetic-kp',value:6}],suggestions:[{kind:'geomagnetic-kp',value:6}],notificationDelivered:false})
  })
})
