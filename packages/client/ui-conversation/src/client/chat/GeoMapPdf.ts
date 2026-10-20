import type { GeoLayer } from './GeoMap.tsx'

/**
 * Two-page original vector map report. No fabricated basemap or elevation;
 * captions, layout, legend and tables derive from existing validated features.
 */
type Pos = readonly [number,number]
const ink = '#25323d'
const accent = '#bd5a2b'
function plain(value:string,max=500):string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\u00b7/g,' - ').replace(/[\u2010-\u2015]/g,'-')
    .replace(/[^\x20-\x7E]/g,' ').slice(0,max)
}
const literal=(v:string):string => plain(v).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')
function rgb(input:string):string{
  const c=/^#[a-f0-9]{6}$/i.test(input)?input:'#d26634'
  return [1,3,5].map(i=>(parseInt(c.slice(i,i+2),16)/255).toFixed(3)).join(' ')
}
function tint(input:string,ratio=.14):string{
  const c=/^#[a-f0-9]{6}$/i.test(input)?input:'#d26634'
  return '#'+[1,3,5].map(i=>{
    const v=parseInt(c.slice(i,i+2),16)
    return Math.round(255*(1-ratio)+v*ratio).toString(16).padStart(2,'0')
  }).join('')
}
function label(value:string,x:number,y:number,size=10,bold=false,color=ink):string{
  return rgb(color)+' rg BT /'+(bold?'B':'R')+' '+size+' Tf '+x.toFixed(1)+' '+y.toFixed(1)+' Td ('+literal(value)+') Tj ET\n'
}
function rect(x:number,y:number,w:number,h:number,fill:string):string{
  return rgb(fill)+' rg '+x+' '+y+' '+w+' '+h+' re f\n'
}
function strokeLine(x:number,y:number,x2:number,y2:number,color='#e0e5e6',width=.8):string{
  return rgb(color)+' RG '+width+' w '+x+' '+y+' m '+x2+' '+y2+' l S\n'
}
function circle(x:number,y:number,r:number,color:string):string{
  const k=.55228475*r
  return rgb(color)+' rg '
    +(x-r).toFixed(1)+' '+y.toFixed(1)+' m '
    +(x-r).toFixed(1)+' '+(y+k).toFixed(1)+' '+(x-k).toFixed(1)+' '+(y+r).toFixed(1)+' '+x.toFixed(1)+' '+(y+r).toFixed(1)+' c '
    +(x+k).toFixed(1)+' '+(y+r).toFixed(1)+' '+(x+r).toFixed(1)+' '+(y+k).toFixed(1)+' '+(x+r).toFixed(1)+' '+y.toFixed(1)+' c '
    +(x+r).toFixed(1)+' '+(y-k).toFixed(1)+' '+(x+k).toFixed(1)+' '+(y-r).toFixed(1)+' '+x.toFixed(1)+' '+(y-r).toFixed(1)+' c '
    +(x-k).toFixed(1)+' '+(y-r).toFixed(1)+' '+(x-r).toFixed(1)+' '+(y-k).toFixed(1)+' '+(x-r).toFixed(1)+' '+y.toFixed(1)+' c f\n'
}
function numbers(n:number):string{return n.toLocaleString('es-DO',{maximumFractionDigits:1})}
function lines(text:string,chars:number,max=3):string[]{
  const words=plain(text,800).split(/\s+/)
  const out:string[]=[];let line=''
  for(const word of words){
    if((line+' '+word).trim().length>chars){
      if(line)out.push(line)
      line=word
    }else line=(line+' '+word).trim()
  }
  if(line)out.push(line)
  return out.slice(0,max).map((s,i)=>i===max-1&&out.length>max?s.slice(0,chars-3)+'...':s)
}
function multiline(value:string,x:number,y:number,chars:number,max=3,size=10):string{
  return lines(value,chars,max).map((str,i)=>label(str,x,y-i*(size+6),size)).join('')
}
function pageBase(section:string,page:number):string{
  return rect(0,0,612,792,'#ffffff')
    +rect(0,740,612,52,ink)
    +label('PHOENIX GEO',52,758,17,true,'#ffffff')
    +label(section,450,760,10,true,'#e8f2ef')
    +strokeLine(52,46,560,46,'#dce3e6')
    +label('Geo Intelligence  |  Datos y metodo documentados',52,31,9,false,'#677680')
    +label(String(page)+' / 2',533,31,9,false,'#677680')
}
function drawMap(layers:readonly GeoLayer[]):string{
  const all=layers.flatMap(layer=>layer.features.flatMap(feature=>feature.coordinates))
  if(!all.length)throw Error('No hay coordenadas verificadas para dibujar un mapa')
  const lons=all.map(p=>p[0]),lats=all.map(p=>p[1])
  const minLng=Math.min(...lons),maxLng=Math.max(...lons),minLat=Math.min(...lats),maxLat=Math.max(...lats)
  const latMid=(minLat+maxLat)/2
  const scaleX=Math.cos(latMid*Math.PI/180)
  const spanX=Math.max((maxLng-minLng)*scaleX,.0003)
  const spanY=Math.max(maxLat-minLat,.0003)
  const area={x:52,y:328,w:508,h:298}
  const scale=Math.min((area.w-52)/spanX,(area.h-50)/spanY)
  const xy=(p:Pos):Pos=>[
    area.x+area.w/2+(p[0]-(minLng+maxLng)/2)*scaleX*scale,
    area.y+area.h/2+(p[1]-(minLat+maxLat)/2)*scale,
  ]
  let page=rect(area.x,area.y,area.w,area.h,'#f4f7f6')
  for(let i=1;i<9;i++){
    const x=area.x+area.w*i/9
    page+=strokeLine(x,area.y,x,area.y+area.h,'#e3ebea',.5)
  }
  for(let i=1;i<6;i++){
    const y=area.y+area.h*i/6
    page+=strokeLine(area.x,y,area.x+area.w,y,'#e3ebea',.5)
  }
  // Back-to-front layer order ensures thematic polygons never cover markers.
  const priority=(kind:string):number=>kind==='polygon'?0:kind==='line'?1:2
  for(const layer of layers.slice().sort((a,b)=>priority(a.kind)-priority(b.kind))){
    for(const feature of layer.features){
      const pts=feature.coordinates.map(xy),c=feature.color??'#d26634'
      if(layer.kind==='points'||layer.kind==='heat'){
        for(const pt of pts){page+=circle(pt[0],pt[1],6,'#ffffff')+circle(pt[0],pt[1],layer.kind==='heat'?4.5:3.8,c)}
        continue
      }
      if(pts.length<2)continue
      const first=pts[0]!
      page+=rgb(c)+' RG '+(layer.kind==='polygon'?1.7:2.7)+' w '
        +first[0].toFixed(1)+' '+first[1].toFixed(1)+' m\n'
      for(const pt of pts.slice(1))page+=pt[0].toFixed(1)+' '+pt[1].toFixed(1)+' l\n'
      if(layer.kind==='polygon')page+=rgb(tint(c,.13))+' rg h B\n'
      else page+='S\n'
    }
  }
  page+=label('Coordenadas WGS84  |  Cartografia vectorial sin mapa base',area.x+12,area.y+12,8,false,'#626e73')
  page+=label('N',area.x+area.w-20,area.y+area.h-24,12,true,'#415862')
  return page
}
function firstPage(layers:readonly GeoLayer[],title:string,source:string,metric?:string):string{
  let p=pageBase('ESTUDIO CARTOGRAFICO',1)
  const titleRows=lines(title,52,2)
  titleRows.forEach((t,i)=>{p+=label(t,52,708-i*23,18,true)})
  p+=label('MAPA TEMATICO   /   EPSG:4326',52,644,10,true,accent)
  p+=drawMap(layers)
  p+=label('LEYENDA',52,303,11,true,accent)
  p+=label('INDICADORES',320,303,11,true,accent)
  const entries=layers.filter(l=>l.features.length>0)
  let y=281
  for(const layer of entries.slice(0,9)){
    const sample=layer.features[0]
    p+=rect(53,y-2,10,10,sample?.color??'#d26634')
    p+=label(plain(layer.name,37),70,y,9)
    p+=label(numbers(layer.features.length),266,y,9,true)
    y-=19
  }
  const features=layers.flatMap(layer=>layer.features)
  const data=features.flatMap(x=>x.value===undefined?[]:[x.value])
  const sum=data.reduce((n,v)=>n+v,0)
  const metrics:[string,string][]=[
    ['Geometrias',numbers(features.length)],['Capas',numbers(entries.length)],
    ['Valores numericos',numbers(data.length)],['Media',data.length?numbers(sum/data.length):'No aplica'],
    ['Minimo',data.length?numbers(Math.min(...data)):'No aplica'],
    ['Maximo',data.length?numbers(Math.max(...data)):'No aplica'],
  ]
  y=281
  for(const [name,val] of metrics){
    p+=label(name,320,y,9)
    p+=label(val,505,y,9,true)
    y-=21
  }
  p+=rect(52,73,508,34,'#f9efe7')
  p+=label('Interpretacion: fuente y limites del estudio en la pagina siguiente.',62,91,9)
  p+=label('No se infieren rutas, alturas topograficas ni causalidad.',62,78,9)
  return p
}
function secondPage(layers:readonly GeoLayer[],title:string,source:string,metric?:string):string{
  let p=pageBase('FICHA TECNICA',2)
  p+=label('Metodologia y datos del mapa',52,706,19,true)
  const blocks:[string,string][]=[
    ['TITULO',title],
    ['FUENTE',source],
    ['VARIABLE',metric??'Geometrias y coordenadas proporcionadas por la fuente'],
    ['SISTEMA ESPACIAL','WGS84 EPSG:4326, longitud y latitud. Coordenadas verificadas en la entrada.'],
    ['SIMBOLOGIA','La leyenda refleja las capas y colores recibidos. Las areas son ilustraciones vectoriales de las geometrías aportadas.'],
    ['LIMITACIONES','Sin mapa base en la exportacion. Las asociaciones territoriales no prueban causalidad, cobertura ni distancia por carretera.'],
  ]
  let y=667
  for(const [heading,value] of blocks){
    p+=label(heading,52,y,9,true,accent)
    p+=multiline(value,52,y-17,95,2,9)
    y-=64
  }
  p+=label('MUESTRA DE REGISTROS',52,272,11,true,accent)
  p+=rect(52,243,508,24,'#edf2f3')
  p+=label('Ubicacion / Area',62,252,9,true)
  p+=label('Capa',301,252,9,true)
  p+=label('Valor',504,252,9,true)
  const sample=layers.flatMap(layer=>layer.features.map(f=>({layer,feature:f}))).slice(0,9)
  y=228
  for(const {layer,feature} of sample){
    p+=label(plain(feature.label,33),62,y,8)
    p+=label(plain(layer.name,27),301,y,8)
    p+=label(feature.value===undefined?'--':numbers(feature.value),507,y,8,true)
    p+=strokeLine(52,y-7,560,y-7,'#e1e8ea',.6)
    y-=18
  }
  const count=layers.reduce((n,l)=>n+l.features.length,0)
  if(count>sample.length)p+=label('Muestra de '+sample.length+' / '+count+' elementos. GeoJSON contiene el total.',52,58,9,false,'#697781')
  return p
}
function encode(pages:readonly string[]):Uint8Array<ArrayBuffer>{
  const objects:string[]=[]
  const put=(body:string):number=>{objects.push(body);return objects.length}
  const catalog=put('')
  const root=put('')
  const regular=put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const bold=put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const pageIds:number[]=[]
  for(const stream of pages){
    const source=plain(stream,5_000_000)
    const content=put('<< /Length '+source.length+' >>\nstream\n'+source+'\nendstream')
    pageIds.push(put('<< /Type /Page /Parent '+root+' 0 R /MediaBox [0 0 612 792]'
      +' /Resources << /Font << /R '+regular+' 0 R /B '+bold+' 0 R >> >>'
      +' /Contents '+content+' 0 R >>'))
  }
  objects[catalog-1]='<< /Type /Catalog /Pages '+root+' 0 R >>'
  objects[root-1]='<< /Type /Pages /Count '+pageIds.length+' /Kids ['+pageIds.map(x=>x+' 0 R').join(' ')+'] >>'
  let output='%PDF-1.4\n%\xD3\xD4\xD5\xD6\n'
  const offsets=[0]
  for(let i=0;i<objects.length;i++){
    offsets.push(output.length)
    output+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n'
  }
  const at=output.length
  output+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'
  for(const pos of offsets.slice(1))output+=String(pos).padStart(10,'0')+' 00000 n \n'
  output+='trailer\n<< /Size '+(objects.length+1)+' /Root '+catalog+' 0 R >>\nstartxref\n'+at+'\n%%EOF\n'
  const binary=new Uint8Array(output.length)
  for(let i=0;i<output.length;i++)binary[i]=output.charCodeAt(i)&255
  return binary
}
export function generateGeoPdf(layers:readonly GeoLayer[],title:string,source:string,metric?:string):Blob{
  if(!layers.some(l=>l.features.length))throw Error('No hay geometrías para exportar')
  return new Blob([encode([firstPage(layers,title,source,metric),
    secondPage(layers,title,source,metric)])],{type:'application/pdf'})
}
