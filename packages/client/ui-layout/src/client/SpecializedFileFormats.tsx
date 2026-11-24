import { useEffect, useRef, useState } from 'react'

export type SpecializedFormat={category:string;adapter:string;extensions:readonly string[];internal:boolean}
export const SPECIALIZED_FORMATS:readonly SpecializedFormat[]=[
  {category:'Juegos',adapter:'Godot / Unity / Unreal',extensions:['godot','pck','tscn','unity','unitypackage','uproject','uasset'],internal:false},
  {category:'Juegos',adapter:'Python / Pygame',extensions:['py','pyw'],internal:false},
  {category:'3D',adapter:'Phoenix 3D',extensions:['glb','gltf'],internal:true},
  {category:'3D',adapter:'Blender / CAD',extensions:['blend','fbx','obj','stl','dae','3ds','dwg','dxf','step','stp','iges','igs'],internal:false},
  {category:'Medicina',adapter:'Visor DICOM / NIfTI',extensions:['dcm','dicom','nii','nrrd','mha','mhd'],internal:false},
  {category:'Datos',adapter:'SQLite / análisis',extensions:['db','sqlite','sqlite3','parquet','sav','dta','rdata','rds','mdb','accdb'],internal:false},
  {category:'Geografía',adapter:'SIG',extensions:['kml','kmz','geojson','shp','gpkg','gpx'],internal:false},
  {category:'Editorial',adapter:'Lector EPUB',extensions:['epub'],internal:true},
  {category:'Editorial',adapter:'Lector de libros',extensions:['mobi','azw','azw3'],internal:false},
  {category:'Diseño',adapter:'Editor gráfico',extensions:['psd','ai','xcf','tiff','tif','heic','avif'],internal:false},
  {category:'Archivos',adapter:'Descompresor',extensions:['rar','7z','tar','gz','bz2','xz','iso','img'],internal:false},
  {category:'Correo',adapter:'Cliente de correo',extensions:['eml','msg'],internal:false},
  {category:'Instalador',adapter:'Sistema operativo (no ejecutar)',extensions:['exe','msi','apk','dmg','app','bat','cmd','ps1','sh'],internal:false},
]
export function specializedFormat(title:string):SpecializedFormat|undefined{
  const extension=title.toLowerCase().split('.').pop()||''
  return SPECIALIZED_FORMATS.find(f=>f.extensions.includes(extension))
}
type DicomImage={width:number;height:number;pixels:Uint8ClampedArray}
export function readDicomPreview(bytes:Uint8Array):DicomImage{
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  if(bytes.length<132||String.fromCharCode(...bytes.subarray(128,132))!=='DICM')throw Error('DICOM sin preámbulo reconocido')
  let p=132,syntax='',width=0,height=0,bits=0,samples=1,signed=0,frames=1,photo='',pixelOffset=-1,pixelLength=0
  const str=(o:number,n:number)=>new TextDecoder().decode(bytes.subarray(o,o+n)).replace(/\0/g,'').trim()
  // Only explicit-VR little-endian, single-frame, uncompressed grayscale.
  // Unsupported encodings fail closed instead of guessing image geometry.
  for(let count=0;p+8<=bytes.length&&count<20000;count++){
    const group=v.getUint16(p,true),tag=v.getUint16(p+2,true)
    if(group!==2&&syntax!=='1.2.840.10008.1.2.1')throw Error('Sintaxis DICOM no compatible con vista básica')
    const vr=str(p+4,2),long=/^(OB|OD|OF|OL|OV|OW|SQ|UC|UR|UT|UN)$/u.test(vr)
    if(!/^[A-Z]{2}$/u.test(vr))throw Error('VR DICOM inválido')
    if(long&&p+12>bytes.length)throw Error('DICOM truncado')
    const n=long?v.getUint32(p+8,true):v.getUint16(p+6,true),start=p+(long?12:8)
    if(n===0xffffffff||start+n>bytes.length)throw Error('Secuencia DICOM no compatible')
    if(group===2&&tag===0x10)syntax=str(start,n)
    if(group===0x28){
      if(tag===0x10&&n===2)height=v.getUint16(start,true)
      if(tag===0x11&&n===2)width=v.getUint16(start,true)
      if(tag===0x100&&n===2)bits=v.getUint16(start,true)
      if(tag===2&&n===2)samples=v.getUint16(start,true)
      if(tag===0x103&&n===2)signed=v.getUint16(start,true)
      if(tag===8)frames=Number(str(start,n))
      if(tag===4)photo=str(start,n)
    }
    if(group===0x7fe0&&tag===0x10){pixelOffset=start;pixelLength=n;break}
    p=start+n
  }
  const count=width*height
  if(pixelOffset<0||width<1||height<1||count>4_194_304||samples!==1||frames!==1||![8,16].includes(bits)
    ||!['MONOCHROME1','MONOCHROME2'].includes(photo)||pixelLength<count*bits/8)throw Error('Imagen DICOM no compatible con vista básica')
  const get=(i:number)=>bits===8?(signed?v.getInt8(pixelOffset+i):v.getUint8(pixelOffset+i)):(signed?v.getInt16(pixelOffset+i*2,true):v.getUint16(pixelOffset+i*2,true))
  let lo=Infinity,hi=-Infinity
  for(let i=0;i<count;i++){const x=get(i);lo=Math.min(lo,x);hi=Math.max(hi,x)}
  const pixels=new Uint8ClampedArray(count*4)
  for(let i=0;i<count;i++){let x=(get(i)-lo)*255/(hi-lo||1);if(photo==='MONOCHROME1')x=255-x;pixels[i*4]=x;pixels[i*4+1]=x;pixels[i*4+2]=x;pixels[i*4+3]=255}
  return {width,height,pixels}
}
export function DicomBasicViewer({bytes}:{bytes:Uint8Array}){
  const canvas=useRef<HTMLCanvasElement>(null)
  const [error,setError]=useState('')
  useEffect(()=>{
    try{const data=readDicomPreview(bytes),el=canvas.current
      if(!el)return
      el.width=data.width;el.height=data.height
      const ctx=el.getContext('2d')
      if(!ctx)throw Error('Canvas no disponible')
      const img=ctx.createImageData(data.width,data.height);img.data.set(data.pixels);ctx.putImageData(img,0,0)
      setError('')
    }catch(e){setError(e instanceof Error?e.message:'DICOM no compatible')}
  },[bytes])
  return <section><p>Vista DICOM básica de píxeles · no diagnóstica. No aplica calibración, ventana clínica, LUT ni transformaciones de modalidad.</p>
    {error&&<p role="alert">{error}. Usa un visor DICOM especializado.</p>}
    <canvas ref={canvas} style={{maxWidth:'100%',maxHeight:'65vh',display:error?'none':'block',margin:'auto'}}/>
  </section>
}
export function readTarNames(bytes:Uint8Array):{name:string;size:number}[]{
  const dec=new TextDecoder(),result:{name:string;size:number}[]=[]
  const field=(start:number,end:number)=>dec.decode(bytes.subarray(start,end)).split('\0')[0]?.trim()||''
  for(let p=0;p+512<=bytes.length&&result.length<2000;){
    if(bytes.subarray(p,p+512).every(x=>x===0))break
    const name=field(p,p+100),prefix=field(p+345,p+500),raw=field(p+124,p+136)
    if(!/^[0-7]+$/u.test(raw))throw Error('Tamaño TAR inválido')
    const size=parseInt(raw,8),next=p+512+Math.ceil(size/512)*512
    if(next>bytes.length||next<=p)throw Error('TAR truncado')
    result.push({name:prefix?prefix+'/'+name:name,size});p=next
  }
  return result
}
