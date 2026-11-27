import { describe, expect, it } from 'vitest'
import { AmbientPublicContext, nearbyPlaces, nearbyUrl, newsArticles, newsUrl, advertisement, discoverAdvertisements, naturalEvents, orbit, sky, voiceCandidate } from '../src/ambient-planet.ts'
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

describe('public city and news context',()=>{
  it('limits external queries and projects source links',()=>{
    expect(newsUrl('world')).toContain('api.gdeltproject.org')
    expect(newsUrl('private text')).toBeNull()
    expect(newsArticles({articles:[{title:'Example',url:'https://example.org/story'},{title:'Bad',url:'javascript:bad'}]})).toHaveLength(1)
    expect(nearbyUrl({lat:19.12345,lon:-70.12345},'hospital')).not.toContain('19.12345')
    expect(nearbyUrl({lat:19,lon:-70},'arbitrary')).toBeNull()
    expect(nearbyPlaces({elements:[{type:'node',id:1,lat:19,lon:-70,tags:{name:'Example',amenity:'hospital'}}]})).toMatchObject([{sourceUrl:'https://www.openstreetmap.org/node/1',category:'hospital'}])
  })
  it('does not send a location without opt-in and caches news',async()=>{
    let calls=0
    const x=new AmbientPublicContext(async()=>{calls++;return {articles:[]}},()=>Date.UTC(2026,10,26))
    expect(await x.get('nearby-online','hospital',{lat:19,lon:-70},false)).toMatchObject({status:'permission-not-configured'})
    expect(calls).toBe(0)
    expect(await x.get('news','world',null,false)).toMatchObject({status:'retrieved'})
    expect(await x.get('news','world',null,false)).toMatchObject({status:'cached'})
    expect(calls).toBe(1)
  })
})
