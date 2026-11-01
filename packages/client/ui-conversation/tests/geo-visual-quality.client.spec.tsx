// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GeoMap, parseGeoMapSpec } from '../src/client/chat/GeoMap.tsx'
import { fitGeoView, buildGeoLegend } from '../src/client/chat/GeoMapLayout.ts'
import type { GeoMapSpec } from '../src/client/chat/GeoMap.tsx'
afterEach(() => { cleanup();localStorage.clear();vi.restoreAllMocks() })
const example = (): GeoMapSpec => ({
 component:'geo_map',version:1,props:{
  id:'mapa-calidad',conversationId:'sesion-prueba',title:'Estudio comercial de Santiago de los Caballeros',
  subtitle:'Ubicaciones y ventas simuladas. No son registros oficiales.',
  source:'Datos simulados de prueba 2026',metric:'Ventas (RD$)',theme:'business',
  center:{lng:-70.704,lat:19.45},zoom:11,
  layers:[{id:'ventas',name:'Sucursales comerciales',kind:'points',features:[
   {id:'centro',label:'Centro',coordinates:[[-70.704,19.451]],value:120000,color:'#187b56'},
   {id:'sur',label:'Sur',coordinates:[[-70.701,19.437]],value:55000,color:'#de8729'},
   {id:'este',label:'Este',coordinates:[[-70.677,19.451]],value:20000,color:'#c34135'},
  ]}],
 }
})
describe('Phoenix Geo — calidad de presentación y adaptación',()=>{
 it('proporciona contenidos legibles y leyenda basada en datos reales',()=>{
   const spec=example()
   expect(parseGeoMapSpec(spec)).not.toBeNull()
   const legend=buildGeoLegend(spec.props.layers)
   expect(legend).toHaveLength(3)
   expect(legend.map(v=>v.color)).toEqual(['#187b56','#de8729','#c34135'])
   expect(legend.map(v=>v.label).join(' ')).toContain('Sucursales comerciales')
 })
 it('ajusta coordenadas y zoom a vista móvil y de escritorio sin ocultar extremos',()=>{
   for(const size of [{w:360,h:345},{w:1080,h:490}]){
     const fit=fitGeoView(example().props.layers,size)
     expect(fit.lng).toBeGreaterThan(-70.704)
     expect(fit.lng).toBeLessThan(-70.677)
     expect(fit.zoom).toBeGreaterThanOrEqual(2)
     expect(fit.zoom).toBeLessThanOrEqual(16)
     expect(fit.lat).toBeGreaterThan(19.437)
     expect(fit.lat).toBeLessThan(19.451)
   }
 })
 it('renderiza panel de métricas, capas, leyenda, exportaciones y cambio 2D/3D',()=>{
   render(<GeoMap spec={example()} />)
   expect(screen.getByRole('heading',{name:'Estudio comercial de Santiago de los Caballeros'})).not.toBeNull()
   expect(screen.getByLabelText('Indicadores del mapa')).not.toBeNull()
   expect(screen.getByLabelText('Leyenda cartográfica')).not.toBeNull()
   expect(screen.getByLabelText('Capas del mapa')).not.toBeNull()
   expect(screen.getByRole('button',{name:'Ver todo'})).not.toBeNull()
   expect(screen.getByRole('button',{name:'PDF · Informe'})).not.toBeNull()
   expect(screen.getByRole('button',{name:'Vista 3D'})).not.toBeNull()
   expect(screen.getByText((65000).toLocaleString('es-DO'))).not.toBeNull()
   fireEvent.click(screen.getByRole('button',{name:'Vista 3D'}))
   expect(screen.getByLabelText('Mapa 3D geográfico de geometrías verificadas y extrusión temática')).not.toBeNull()
   expect(screen.getByRole('button',{name:'Volver a 2D'})).not.toBeNull()
 })
 it('mantiene selección accesible y no pierde la capa al filtrar',()=>{
   render(<GeoMap spec={example()} />)
   fireEvent.click(screen.getByRole('button',{name:'Seleccionar Centro'}))
   expect(screen.getByText('Ventas (RD$): ' + (120000).toLocaleString('es-DO'))).not.toBeNull()
   fireEvent.click(screen.getByRole('checkbox'))
   expect(screen.getByText('Activa una capa para mostrar sus categorías')).not.toBeNull()
   expect(screen.getByRole('button',{name:'PDF · Informe'}).hasAttribute('disabled')).toBe(true)
 })
 it('respeta el aislamiento del estado por conversación',()=>{
   render(<GeoMap spec={example()} />)
   fireEvent.click(screen.getByRole('button',{name:'Acercar mapa'}))
   expect(localStorage.getItem('phoenix:geo:v1:sesion-prueba:mapa-calidad')).toContain('"zoom":12')
 })
})
