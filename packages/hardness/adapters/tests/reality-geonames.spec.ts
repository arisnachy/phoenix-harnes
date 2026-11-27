import { describe, expect, it } from 'vitest'
import { GazetteerIndex, parseAdminNames, parseGazetteer, resolveGazetteer, extractGazetteerZip } from '../src/reality-geonames.ts'

const line=(id:string,name:string,lat:number,lon:number,code:string,cc='DO',pop=0,admin2='01')=>
  [id,name,name,'',lat,lon,'P',code,cc,'','25',admin2,'','',pop,'','','America/Santo_Domingo','2026-01-01'].join('\t')
describe('offline reverse locality',()=>{
  it('names city, province, country and nearby sector without claiming boundaries',()=>{
    const global=new GazetteerIndex(parseGazetteer(line('1','Example city',19.45,-70.69,'PPLA','DO',500000)))
    const detail=new GazetteerIndex(parseGazetteer(line('2','Example district',19.411,-70.696,'PPLX')))
    const admin=parseAdminNames('DO.25\tExample province\tExample province\t1')
    expect(resolveGazetteer(global,detail,admin,19.412,-70.696,30)).toMatchObject({
      city:'Example city',region:'Example province',country:'Dominican Republic',sector:'Example district',
      precision:'nearest-mapped-place',source:'geonames-offline',
    })
    expect(resolveGazetteer(global,detail,admin,19.412,-70.696,600)?.sector).toBeNull()
  })
  it('rejects uncertain, far-away and cross-border results',()=>{
    const global=new GazetteerIndex(parseGazetteer([
      line('1','A',10,20,'PPLA','DO',20000),line('2','B',10.01,20,'PPLA','HT',20000),
    ].join('\n')))
    expect(resolveGazetteer(global,undefined,new Map(),10,20,20)).toBeUndefined()
    expect(resolveGazetteer(global,undefined,new Map(),0,0,20)).toBeUndefined()
    expect(resolveGazetteer(global,undefined,new Map(),10,20,20000)).toBeUndefined()
  })
  it('rejects unsupported or corrupt zip',()=>{
    expect(()=>extractGazetteerZip(Buffer.from('invalid'),'cities500.txt')).toThrow()
  })
})
