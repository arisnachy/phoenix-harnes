/**
 * Vector PDF report — 2 pages, standard Latin-1 PDF Helvetica fonts.
 * No fictitious basemap, routes, coordinates or statistics are introduced.
 */
function clean(x,max=240){return String(x??'').replace(/[\u0000-\u001f]/g,' ').normalize('NFKD')
 .replace(/[\u0300-\u036f]/g,'').replace(/[\u2010-\u2015]/g,'-').replace(/[^\x20-\x7e\xa0-\xff]/g,'?').slice(0,max)}
function escapePdf(x){return clean(x).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')}
function rgb(c){const m=/^#([a-fA-F0-9]{6})$/.exec(c??'')??[,'d76732'];return [0,2,4].map(i=>(parseInt(m[1].slice(i,i+2),16)/255).toFixed(3)).join(' ')}
function label(x,px,py,size=10,bold=false,c='#3d3832'){
 return rgb(c)+' rg BT /'+(bold?'FB':'FR')+' '+size+' Tf '+px.toFixed(1)+' '+py.toFixed(1)+' Td ('+escapePdf(x)+') Tj ET\n'
}
function box(x,y,w,h,color='#f8f4ee'){return rgb(color)+' rg '+x+' '+y+' '+w+' '+h+' re f\n'}
function path(points,color,filled=false){
 if(points.length<2)return ''
 let d=rgb(color)+' RG '+rgb(color)+' rg 1.5 w '+points[0][0].toFixed(1)+' '+points[0][1].toFixed(1)+' m\n'
 for(const p of points.slice(1))d+=p[0].toFixed(1)+' '+p[1].toFixed(1)+' l\n'
 if(filled)d+='h B\n';else d+='S\n'
 return d
}
function circle(x,y,c,r=3){
 const k=r*.55228475;return rgb(c)+' rg ' +
 (x-r).toFixed(1)+' '+y.toFixed(1)+' m '+
 (x-r).toFixed(1)+' '+(y+k).toFixed(1)+' '+(x-k).toFixed(1)+' '+(y+r).toFixed(1)+' '+x.toFixed(1)+' '+(y+r).toFixed(1)+' c '+
 (x+k).toFixed(1)+' '+(y+r).toFixed(1)+' '+(x+r).toFixed(1)+' '+(y+k).toFixed(1)+' '+(x+r).toFixed(1)+' '+y.toFixed(1)+' c '+
 (x+r).toFixed(1)+' '+(y-k).toFixed(1)+' '+(x+k).toFixed(1)+' '+(y-r).toFixed(1)+' '+x.toFixed(1)+' '+(y-r).toFixed(1)+' c '+
 (x-k).toFixed(1)+' '+(y-r).toFixed(1)+' '+(x-r).toFixed(1)+' '+(y-k).toFixed(1)+' '+(x-r).toFixed(1)+' '+y.toFixed(1)+' c f\n'
}
function drawMap(layers){
 const all=layers.flatMap(l=>l.features.flatMap(f=>f.coordinates))
 if(!all.length)throw Error('No hay geometria de mapa para generar PDF')
 const x=all.map(p=>p[0]),y=all.map(p=>p[1])
 const minX=Math.min(...x),minY=Math.min(...y),spanX=Math.max(Math.max(...x)-minX,.0002),spanY=Math.max(Math.max(...y)-minY,.0002)
 const xy=p=>[80+440*(p[0]-minX)/spanX,380+218*(p[1]-minY)/spanY]
 let s=box(56,356,500,270,'#f3f5f2')+label('WGS84 - coordenadas proporcionadas (sin mapa base)',65,363,8,false,'#756f66')
 for(const layer of layers)for(const f of layer.features){
  const coords=f.coordinates.map(xy),c=f.color??'#cf6a2e'
  if(layer.kind==='points'||layer.kind==='heat')for(const q of coords)s+=circle(q[0],q[1],c,layer.kind==='heat'?6:3.8)
  else s+=path(coords,c,layer.kind==='polygon')
 }
 return s
}
function wrap(value,max=91){
 const words=clean(value,8000).split(/\s+/);const lines=[];let current=''
 for(const w of words){if((current+' '+w).trim().length>max){if(current)lines.push(current);current=w}else current=(current+' '+w).trim()}
 if(current)lines.push(current);return lines
}
function desc(lines,x,y){let s='';for(const l of lines){s+=label(l,x,y,9);y-=14}return [s,y]}
function pageOne(r){
 const {title,source,metric,layers}=r.spec.props,st=r.statistics
 let p=box(0,0,612,792,'#fffefa')+box(0,742,612,50,'#252a31')
 p+=label('PHOENIX GEO INTELLIGENCE',54,760,15,true,'#ffffff')
 p+=label(title,54,706,21,true)+label('Informe geografico - WGS84 / EPSG:4326',54,679,11,false,'#746b60')
 p+=drawMap(layers)
 p+=label('FUENTE',55,333,10,true,'#c3632f')+label(source,55,317,10)
 p+=label('LEYENDA Y CAPAS',55,288,10,true,'#c3632f')
 let y=268
 for(const l of layers.slice(0,7)){p+=circle(63,y+3,l.features[0]?.color??'#cf6a2e',4)+label(l.name+' ('+l.features.length+')',78,y,10);y-=21}
 p+=label('ESTADISTICAS '+(metric??''),306,288,10,true,'#c3632f')
 y=268
 const pairs=[['Elementos',st.entities],['Registros validos',st.values],['Suma',st.sum],['Media',st.mean],['Mediana',st.median],['Minimo',st.min],['Maximo',st.max]]
 for(const [name,value] of pairs){p+=label(name,306,y,10)+label(value===null?'No aplica':Number(value).toLocaleString('es-DO',{maximumFractionDigits:2}),490,y,10,true);y-=21}
 p+=box(54,70,504,35,'#f9ede3')
 p+=label('Sin mapa base; datos y metodologia atribuibles a la fuente indicada.',64,88,9)
 p+=label('Las asociaciones espaciales no prueban causalidad.',64,76,9)
 return p+label('1 / 2',527,30,9)
}
function pageTwo(r){
 const {title,source,metric,layers}=r.spec.props
 let p=box(0,0,612,792,'#fffefa')+box(0,742,612,50,'#252a31')
 p+=label('PHOENIX GEO - METODOLOGIA',54,760,14,true,'#ffffff')
 p+=label('Ficha tecnica para publicacion',54,706,21,true)
 const rows=[
 ['Titulo',title],['Fuente original',source],
 ['Referencia espacial','EPSG:4326 WGS84; pares [longitud, latitud]'],
 ['Variables',metric??'Localizaciones y geometrias contenidas en los datos'],
 ['Geometria',layers.map(l=>l.name+': '+l.features.length).join('; ')],
 ['Representacion','Mapa vectorial sin base cartografica raster ni relieve supuesto'],
 ['Metodologia','Compilacion deterministica de las coordenadas de entrada. Las estadisticas descriptivas usan solo valores numericos presentes.'],
 ['Interpretacion','Los colores son simbologia tematica, no un juicio sobre causalidad, riesgo o calidad si no se documenta la polaridad.'],
 ['Proteccion de datos','Evitar publicar datos individuales de pacientes, hogares o ubicaciones sensibles. Agregar informacion para preservar privacidad.'],
 ['Limitaciones','Este PDF no demuestra accesibilidad vial ni distancias de red. Es cartografia para informe con trazabilidad.'],
 ]
 let y=663
 for(const [name,value] of rows){
  p+=label(name.toUpperCase(),54,y,10,true,'#c3632f');y-=19
  const d=desc(wrap(value),54,y);p+=d[0];y=d[1]-19
 }
 p+=label('Fuente y recuentos reproducibles en el GeoJSON complementario.',54,53,9,false,'#756f66')
 return p+label('2 / 2',527,30,9)
}
function encode(pages){
 const objs=[],add=obj=>(objs.push(obj),objs.length)
 const regular=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
 const bold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
 const parent=add('');const ids=[]
 for(const page of pages){
  const bytes=Buffer.from(page,'latin1')
  const payload=Buffer.concat([Buffer.from('<< /Length '+bytes.length+' >>\nstream\n'),bytes,Buffer.from('\nendstream')])
  const stream=add(payload)
  ids.push(add('<< /Type /Page /Parent '+parent+' 0 R /MediaBox [0 0 612 792] /Resources << /Font << /FR '+regular+' 0 R /FB '+bold+' 0 R >> >> /Contents '+stream+' 0 R >>'))
 }
 objs[parent-1]='<< /Type /Pages /Kids ['+ids.map(x=>x+' 0 R').join(' ')+'] /Count '+ids.length+' >>'
 const root=add('<< /Type /Catalog /Pages '+parent+' 0 R >>')
 const chunks=[Buffer.from('%PDF-1.4\n%\xd3\xd4\xd5\xd6\n','latin1')],offsets=[0]
 let pos=chunks[0].length
 for(let i=0;i<objs.length;i++){
  const data=Buffer.isBuffer(objs[i])?objs[i]:Buffer.from(objs[i],'latin1')
  const chunk=Buffer.concat([Buffer.from((i+1)+' 0 obj\n'),data,Buffer.from('\nendobj\n')])
  offsets.push(pos);chunks.push(chunk);pos+=chunk.length
 }
 const refs='xref\n0 '+(objs.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')
 chunks.push(Buffer.from(refs+'trailer\n<< /Size '+(objs.length+1)+' /Root '+root+' 0 R >>\nstartxref\n'+pos+'\n%%EOF\n'))
 return Buffer.concat(chunks)
}
export function renderGeoPDF(result){
 if(!result?.statistics||!result?.spec?.props?.layers)throw Error('Necesita el resultado de compileGeoJson')
 return encode([pageOne(result),pageTwo(result)])
}
