import React from 'react'
import { createRoot } from 'react-dom/client'
import { GeoMap } from '../../packages/client/ui-conversation/src/client/chat/GeoMap.tsx'
import type { GeoMapSpec } from '../../packages/client/ui-conversation/src/client/chat/GeoMap.tsx'
const spec: GeoMapSpec = {
  component: 'geo_map', version: 1,
  props: {
    id:'calidad-visual',conversationId:'qa-visual-propia',
    title:'Análisis territorial de las sucursales de Santiago',
    subtitle:'Ventas simuladas por sucursal. Las posiciones son puntos de ensayo, no ubicaciones comerciales reales.',
    source:'Datos de demostración · Phoenix QA · Octubre 2026',
    metric:'Ventas mensuales (RD$)', theme:'business',
    center:{lng:-70.700,lat:19.45},zoom:12,
    layers:[
      {id:'ventas',name:'Sucursales · ventas',kind:'points',features:[
        {id:'centro',label:'Centro',coordinates:[[-70.704,19.451]],value:120000,color:'#238466',detail:'Sucursales ficticias'},
        {id:'norte',label:'Norte',coordinates:[[-70.691,19.462]],value:95000,color:'#238466'},
        {id:'oeste',label:'Oeste',coordinates:[[-70.727,19.444]],value:40000,color:'#d86b3d'},
        {id:'este',label:'Este',coordinates:[[-70.677,19.451]],value:20000,color:'#bf4646'},
      ]},
      {id:'territorios',name:'Área comercial de referencia',kind:'polygon',features:[
        {id:'region',label:'Polígono ilustrativo',coordinates:[
          [-70.73,19.438],[-70.67,19.438],[-70.67,19.47],[-70.73,19.47]
        ],color:'#6472aa',detail:'Geometría ilustrativa (no es una división administrativa)'},
      ]},
    ],
  },
}
const root=document.getElementById('geo-qa-root')
if(!root)throw Error('Fixture Phoenix Geo missing mount')
createRoot(root).render(<GeoMap spec={spec}/>)
