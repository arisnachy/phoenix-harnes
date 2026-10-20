import type { GeoLayer } from './GeoMap.tsx'
/** Inline single-page map PDF, all graphics from validated GeoMap layer geometry. */
const clean=(value: string,max=140): string => value.normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'?').slice(0,max)
const quote=(str: string): string => clean(str).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')
const color=(input: string | undefined): string => {
  const valid = /^#[a-fA-F0-9]{6}$/.test(input ?? '') ? input! : '#d3652c'
  return [1,3,5].map(i=>(parseInt(valid.slice(i,i+2),16)/255).toFixed(3)).join(' ')
}
function print(str:string,x:number,y:number,size=11,bold=false,fill='#333333'): string {
  return color(fill)+' rg BT /'+(bold?'B':'R')+' '+size+' Tf '+x.toFixed(1)+' '+y.toFixed(1)+' Td ('+quote(str)+') Tj ET\n'
}
function pdfBytes(strings: readonly string[]): Uint8Array<ArrayBuffer> {
  const content=strings.join('')
  const streamLength=content.length
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /R 5 0 R /B 6 0 R >> >> >>',
    '<< /Length '+streamLength+' >>\nstream\n'+content+'\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ]
  let out='%PDF-1.4\n%\xD3\xD4\xD5\xD6\n'
  const offsets=[0]
  for(let i=0;i<objects.length;i++){
    offsets.push(out.length)
    out+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n'
  }
  const xref=out.length
  out+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'
  for(const offset of offsets.slice(1))out+=String(offset).padStart(10,'0')+' 00000 n \n'
  out+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n'
  const buffer = new Uint8Array(out.length)
  for(let i=0;i<out.length;i++)buffer[i]=out.charCodeAt(i)&255
  return buffer
}
export function generateGeoPdf(layers: readonly GeoLayer[], title: string, source: string, metric?: string): Blob {
  const all=layers.flatMap(l=>l.features.flatMap(f=>f.coordinates))
  if(all.length===0)throw Error('No hay geometrías para PDF')
  const lng=all.map(p=>p[0]),lat=all.map(p=>p[1])
  const minX=Math.min(...lng),minY=Math.min(...lat),dx=Math.max(Math.max(...lng)-minX,.0002),dy=Math.max(Math.max(...lat)-minY,.0002)
  const xy=(p: readonly [number,number]): readonly [number,number]=>[68+475*(p[0]-minX)/dx,345+270*(p[1]-minY)/dy]
  const commands: string[]=[]
  commands.push('1 1 1 rg 0 0 612 792 re f\n')
  commands.push('.16 .18 .21 rg 0 742 612 50 re f\n')
  commands.push(print('PHOENIX GEO INTELLIGENCE',48,760,15,true,'#ffffff'))
  commands.push(print(title,48,699,19,true))
  commands.push(print('Mapa vectorial WGS84 / EPSG:4326',48,671,10))
  commands.push('.95 .96 .95 rg 52 335 508 297 re f\n')
  for(const layer of layers)for(const f of layer.features){
    const coords=f.coordinates.map(xy),c=color(f.color)
    if(layer.kind==='points'||layer.kind==='heat'){
      for(const pt of coords)commands.push(c+' rg '+(pt[0]-4).toFixed(1)+' '+(pt[1]-4).toFixed(1)+' 8 8 re f\n')
    } else if(coords.length>1){
      commands.push(c+' RG '+c+' rg 1.5 w '+coords[0]![0].toFixed(1)+' '+coords[0]![1].toFixed(1)+' m\n')
      for(const pt of coords.slice(1))commands.push(pt[0].toFixed(1)+' '+pt[1].toFixed(1)+' l\n')
      commands.push(layer.kind==='polygon'?'h B\n':'S\n')
    }
  }
  commands.push(print('LEYENDA',52,308,10,true,'#bb5b2b'))
  let y=289
  for(const l of layers.slice(0,9)){commands.push(print(l.name+' ('+l.features.length+')',52,y,10));y-=18}
  commands.push(print('INFORME Y METADATOS',312,308,10,true,'#bb5b2b'))
  commands.push(print('Fuente: '+source,312,289,9))
  commands.push(print('Metrica: '+(metric??'sin metrica'),312,273,9))
  commands.push(print('Elementos: '+layers.reduce((s,l)=>s+l.features.length,0),312,257,9))
  commands.push(print('Las ubicaciones siguen sus fuentes.',312,237,9))
  commands.push(print('No implica rutas ni elevacion del terreno.',312,222,9))
  commands.push(print('Datos sensibles: agregarlos antes de publicar.',52,68,9))
  commands.push(print('Cartografia original vectorial, sin base raster externa.',52,51,9))
  return new Blob([pdfBytes(commands)],{type:'application/pdf'})
}
