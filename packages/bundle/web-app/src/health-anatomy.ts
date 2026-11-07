import { createHash } from 'node:crypto'
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

/**
 * Validate file integrity and neutral provenance for an imported GLB.
 * This does NOT authenticate source images, annotator or medical accuracy.
 */
export function verifyAnatomicalEvidence(raw:unknown, bytes:Buffer) {
  if(raw===undefined||raw===null)return null
  if(raw===null||typeof raw!=='object'||Array.isArray(raw))
    throw new Error('Manifiesto anatómico inválido')
  const x=raw as Record<string,unknown>
  if(x.schema!==1||x.clinicalStatus!=='UNVALIDATED_RESEARCH_OUTPUT'||x.needsExpertReview!==true)
    throw new Error('Manifiesto sin estado experimental y revisión obligatoria')
  const hash=createHash('sha256').update(bytes).digest('hex')
  if(typeof x.glbSha256!=='string'||!/^[a-f0-9]{64}$/u.test(x.glbSha256)||
     x.glbSha256!==hash)
    throw new Error('La huella del GLB no coincide con el manifiesto anatómico')
  if(x.modality!=='ct'&&x.modality!=='mr')
    throw new Error('Modalidad anatómica no reconocida')
  const registration=['not-applicable','affected-region grid matched to anatomy grid']
  if(!registration.includes(String(x.sourceRegistration)))
    throw new Error('Registro espacial anatómico no verificado')
  if(!Array.isArray(x.structures)||x.structures.length===0||x.structures.length>200)
    throw new Error('Capas anatómicas inválidas')
  const layers=x.structures.map((item:unknown)=>{
    if(item===null||typeof item!=='object'||Array.isArray(item))
      throw new Error('Capa anatómica inválida')
    const layer=item as Record<string,unknown>
    if(typeof layer.structure!=='string'||!/^[A-Za-z0-9_-]{1,100}$/u.test(layer.structure)||
       !['anatomy','clinician-supplied-affected-region'].includes(String(layer.layer))||
       !['unreviewed','rejected'].includes(String(layer.state)))
      throw new Error('Etiqueta de capa o procedencia inválida')
    if(layer.state==='unreviewed'&&(
      typeof layer.sourceMaskSha256!=='string'||
      !/^[a-f0-9]{64}$/u.test(layer.sourceMaskSha256)))throw new Error('Falta huella de la máscara')
    const triangles=layer.triangles
    if(layer.state==='unreviewed'&&
      (typeof triangles!=='number'||!Number.isSafeInteger(triangles)||triangles<8))
      throw new Error('Geometría de capa inválida')
    const volumeMl=layer.volumeMl
    if(layer.state==='unreviewed'&&
      (typeof volumeMl!=='number'||!Number.isFinite(volumeMl)||volumeMl<0))
      throw new Error('Volumen de capa inválido')
    return {structure:layer.structure,layer:layer.layer,state:layer.state,
      ...(layer.state==='unreviewed'?{
        sourceMaskSha256:layer.sourceMaskSha256,
        triangles,volumeMl,
      }:{})}
  })
  const count=layers.filter(x=>x.layer==='clinician-supplied-affected-region').length
  if(typeof x.affectedRegions!=='number'||!Number.isSafeInteger(x.affectedRegions)||x.affectedRegions!==count||
    (count>0&&x.sourceRegistration!==registration[1]))
    throw new Error('El número o alineación de regiones afectadas no coincide')
  return {
    schema:1,modality:x.modality,glbSha256:hash,
    sourceRegistration:x.sourceRegistration,affectedRegions:count,
    structures:layers,needsExpertReview:true,
    clinicalStatus:'UNVALIDATED_RESEARCH_OUTPUT' as const,
    verification:'glb-manifest-integrity-only' as const,
  }
}
