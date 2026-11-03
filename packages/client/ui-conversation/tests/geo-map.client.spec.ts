import { describe, expect, it } from 'vitest'
import { parseGeoMapSpec } from '../src/client/chat/GeoMap.tsx'
const example = () => ({
  component:'geo_map', version:1,
  props: { id:'geotest', conversationId:'test-conversation', title:'Mapa de prueba', source:'datos simulados',
    center:{ lng:-70.7, lat:19.45 }, zoom:11,
    layers:[{id:'a',name:'Marcadores',kind:'points',features:[{
      id:'p1', label:'Prueba',coordinates:[[-70.7,19.45]],value:12,color:'#1a986c',
    }]}] },
})
describe('Geo Intelligence / generative-ui', () => {
  it('acepta un mapa declarativo sin scripts', () => expect(parseGeoMapSpec(example())).not.toBeNull())
  it('rechaza coordenadas fuera de rango', () => {
    const m = example(); m.props.center.lat = 94; expect(parseGeoMapSpec(m)).toBeNull()
  })
  it('rechaza claves adicionales con autoridad', () => {
    const m = { ...example(), props: { ...example().props, onClick:'eval(1)' } }
    expect(parseGeoMapSpec(m)).toBeNull()
  })
  it('rechaza capas de tipos desconocidos', () => {
    const m = example(); m.props.layers[0]!.kind = 'iframe'; expect(parseGeoMapSpec(m)).toBeNull()
  })
  it('exige ID de conversación', () => {
    const m = example(); m.props.conversationId = ''; expect(parseGeoMapSpec(m)).toBeNull()
  })
})
