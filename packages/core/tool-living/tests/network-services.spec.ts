import { describe, expect, it } from 'vitest'
import { parseServiceTypes, discoverLocalServices } from '../src/network-services.ts'

describe('local service discovery',()=>{
  it('accepts bounded SSDP service types without returning arbitrary URLs',()=>{
    const packet=Buffer.from('HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\nLOCATION: http://private.local/secret\r\n\r\n')
    expect(parseServiceTypes('ssdp',packet)).toEqual(['urn:schemas-upnp-org:device:MediaRenderer:1'])
    expect(parseServiceTypes('ssdp',Buffer.from('HTTP/1.1 200 OK\r\nST: http://bad.example\r\n'))).toEqual([])
    expect(parseServiceTypes('ssdp',Buffer.alloc(8193))).toEqual([])
  })
  it('extracts DNS-SD PTR service types only',()=>{
    const name=(s:string)=>Buffer.concat([...s.split('.').map(x=>Buffer.concat([Buffer.from([x.length]),Buffer.from(x)])),Buffer.from([0])])
    const target=name('_ipp._tcp.local')
    const header=Buffer.from([0,0,0x84,0,0,0,0,1,0,0,0,0])
    const rr=Buffer.from([0,12,0,1,0,0,0,60,0,target.length])
    expect(parseServiceTypes('mdns',Buffer.concat([header,name('_services._dns-sd._udp.local'),rr,target]))).toEqual(['_ipp._tcp.local'])
    expect(parseServiceTypes('mdns',Buffer.concat([header,Buffer.from([0xc0,12])]))).toEqual([])
  })
  it('rejects public interfaces and cancelled requests before opening sockets',async()=>{
    expect(await discoverLocalServices('8.8.8.8',24)).toMatchObject({status:'denied',observations:[]})
    const c=new AbortController();c.abort()
    expect(await discoverLocalServices('192.168.1.2',24,c.signal)).toMatchObject({status:'denied',observations:[]})
  })
})
