import React from 'react'
import { createRoot } from 'react-dom/client'
import { SceneMap } from '../../packages/client/ui-conversation/src/client/chat/SceneMap.tsx'
import type { SceneMapSpec } from '../../packages/client/ui-conversation/src/client/chat/SceneMap.tsx'
const island:SceneMapSpec={
 component:'scene_map',version:1,
 props:{
  id:'isla-bruma',title:'Isla Bruma',theme:'fantasy',
  subtitle:'Atlas ilustrado de una isla fantástica · Mapa de prueba',
  description:'Explora cinco lugares para descubrir sus historias. No es un mapa del mundo real.',
  places:[
   {id:'puerto',name:'Puerto de la Niebla',x:24,y:66,kind:'port',description:'Puerto antiguo al oeste, con barcas que aparecen al amanecer.'},
   {id:'bosque',name:'Bosque Susurrante',x:36,y:49,kind:'forest',description:'Un bosque de árboles milenarios y ruinas cubiertas de musgo.'},
   {id:'torre',name:'Torre del Viento',x:66,y:28,kind:'tower',description:'La torre en las montañas guarda los antiguos nombres del viento.'},
   {id:'ruinas',name:'Ruinas del Alba',x:72,y:67,kind:'ruins',description:'Un templo sumergido en niebla y leyendas.'},
   {id:'capital',name:'Ciudad de Sal',x:55,y:51,kind:'city',description:'Capital de los cartógrafos y comerciantes.'},
  ],
  routes:[{from:'puerto',to:'bosque',label:'Camino del musgo'},{from:'bosque',to:'capital'},
    {from:'capital',to:'torre'},{from:'capital',to:'ruinas'}],
 }
}
const el=document.getElementById('app')
if(!el)throw Error('Missing scene atlas mount')
createRoot(el).render(<SceneMap spec={island}/>)
