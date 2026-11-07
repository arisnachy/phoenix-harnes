/** Validate an uploaded GLB 2.0 container; never certify anatomy. */
export function inspectAnatomicalGlb(bytes: Buffer): {meshes:number;geometryStatus:'unreviewed'} {
  if(bytes.length<32||bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)
    throw new Error('Modelo GLB 2.0 inválido')
  const size=bytes.readUInt32LE(12)
  if(size<16||size%4!==0||size>bytes.length-20||bytes.toString('ascii',16,20)!=='JSON')
    throw new Error('Cabecera JSON del GLB inválida')
  let parsed:unknown
  try{parsed=JSON.parse(bytes.toString('utf8',20,20+size))}catch{throw new Error('Metadatos GLB inválidos')}
  if(parsed===null||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Estructura GLB inválida')
  const doc=parsed as Record<string,unknown>
  if(!doc.asset||typeof doc.asset!=='object'||(doc.asset as {version?:unknown}).version!=='2.0')
    throw new Error('Versión GLB no admitida')
  if(!Array.isArray(doc.meshes)||doc.meshes.length===0||doc.meshes.length>200)
    throw new Error('Modelo sin mallas o demasiado complejo')
  if(doc.extensionsRequired!==undefined&&(!Array.isArray(doc.extensionsRequired)||doc.extensionsRequired.length!==0))
    throw new Error('Extensiones externas o no disponibles en el visor')
  for(const group of ['buffers','images']){
    const list=doc[group]
    if(list===undefined)continue
    if(!Array.isArray(list))throw new Error('Recursos GLB inválidos')
    for(const item of list){
      if(item===null||typeof item!=='object'||Array.isArray(item)||'uri' in item)
        throw new Error('Se rechazan recursos GLB externos o basados en URL')
    }
  }
  let offset=20+size
  while(offset<bytes.length){
    if(offset+8>bytes.length)throw new Error('Segmento GLB truncado')
    const chunk=bytes.readUInt32LE(offset)
    if(chunk%4!==0||chunk>bytes.length-offset-8||bytes.toString('ascii',offset+4,offset+8)!=='BIN\u0000')
      throw new Error('Segmento binario GLB inválido')
    offset+=chunk+8
  }
  return {meshes:doc.meshes.length,geometryStatus:'unreviewed'}
}
