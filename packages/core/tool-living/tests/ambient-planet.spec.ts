import { describe, expect, it } from 'vitest'
import { advertisement, discoverAdvertisements, naturalEvents, orbit, sky, voiceCandidate } from '../src/ambient-planet.ts'
describe('ambient planet',()=>{
  it('recognizes service classes without disclosing identity or initiating scans',async()=>{
    const h=Buffer.alloc(12);h[2]=128
    expect(advertisement('mdns',Buffer.concat([h,Buffer.from([4]),Buffer.from('_ipp'),Buffer.from([4]),Buffer.from('_tcp')]))).toEqual(['_ipp._tcp'])
    expect(advertisement('ssdp',Buffer.from('NOTIFY * HTTP/1.1\r\nNT: urn:schemas-upnp-org:device:MediaRenderer:1\r\nLOCATION: http://private/\r\n'))).toEqual(['upnp:mediarenderer'])
    expect(await discoverAdvertisements(false)).toEqual({status:'permission-not-configured'})
  })
  it('distinguishes orbital elements from live satellite position',()=>{
    const epoch='2026-11-26T12:00:00'
    expect(orbit([{NORAD_CAT_ID:25544,EPOCH:epoch,INCLINATION:51.6,MEAN_MOTION:15.5,ECCENTRICITY:0.0001}],Date.parse(epoch+'Z'))).toMatchObject({periodMinutes:92.9,positionComputed:false,stale:false})
  })
  it('projects EONET point observations and computes geometric star altitude',()=>{
    expect(naturalEvents({events:[{id:'E1',title:'Event',geometry:[{type:'Point',coordinates:[-70,19],date:'2026-11-26T12:00:00Z'}]}]})).toMatchObject([{point:{lat:19,lon:-70}}])
    const stars=sky(19,-70,Date.UTC(2026,10,26,12))
    expect(stars.length).toBeGreaterThan(0)
    expect(stars.every(x=>x.altitudeDegrees>5&&x.azimuthDegrees>=0&&x.azimuthDegrees<=360)).toBe(true)
  })
  it('does not announce cached or stale data',()=>{
    const now=Date.UTC(2026,10,26,12),data={kp:6,observedAt:new Date(now).toISOString()}
    expect(voiceCandidate('space',{status:'cached',data},now)).toBeNull()
    expect(voiceCandidate('space',{status:'retrieved',data},now)?.key).toBe('kp:6')
  })
})
