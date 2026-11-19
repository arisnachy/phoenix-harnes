/**
 * Genuine Studio 3D production bridge. The language model builds/obtains a
 * detailed local GLB in its workspace; this tool renders and publishes the
 * real asset with Blender Cycles, NEVER manufacturing primitive geometry.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, openSync, readSync, closeSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineTool, ToolArgsError, type ToolDefinition } from '@phoenix-ai/dsh-tools'
import { PHOENIX_STUDIO3D_MIME, inspectStudio3DAsset,
  publishStudio3DAssets, resolveStudio3DWorkspaceFile } from './studio3d-bundle.ts'

export interface Studio3DModelAudit {
  readonly meshes: number
  readonly triangles: number
  readonly materials: number
  readonly skins: number
  readonly animations: number
  readonly sourceGeometryVerified: true
  readonly appearanceReviewed: false
}
/** Structural glTF inspection without loading an untrusted 500 MB asset into JS memory. */
export function inspectStudio3DModel(file: string): Studio3DModelAudit {
  inspectStudio3DAsset(file,'scene.glb')
  const fd = openSync(file,'r')
  let payload: Buffer
  try {
    const header = Buffer.alloc(20)
    if (readSync(fd,header,0,20,0)!==20) throw Error('GLB incompleto')
    const length = header.readUInt32LE(12)
    if (length<20 || length>8*1024*1024 || header.toString('ascii',16,20)!=='JSON') {
      throw Error('GLB: metadatos JSON inválidos o excesivos.')
    }
    payload=Buffer.alloc(length)
    if (readSync(fd,payload,0,length,20)!==length) throw Error('GLB: chunk JSON truncado')
  } finally { closeSync(fd) }
  let data: unknown
  try {data=JSON.parse(payload.toString('utf8')) as unknown}
  catch {throw Error('GLB: metadatos no son JSON válido.')}
  if (data===null || typeof data!=='object' || Array.isArray(data)) throw Error('GLB: raíz inválida.')
  const root=data as Record<string,unknown>
  if (root.asset===null || typeof root.asset!=='object'
    || (root.asset as {version?:unknown}).version!=='2.0') throw Error('GLB: requiere glTF 2.0.')
  const meshes=Array.isArray(root.meshes)?root.meshes:[]
  const accessors=Array.isArray(root.accessors)?root.accessors:[]
  const materials=Array.isArray(root.materials)?root.materials:[]
  const skins=Array.isArray(root.skins)?root.skins:[]
  const animations=Array.isArray(root.animations)?root.animations:[]
  let triangles=0
  for (const item of meshes) {
    if (item===null || typeof item!=='object') continue
    const primitives=(item as {primitives?:unknown}).primitives
    if (!Array.isArray(primitives)) continue
    for (const primitive of primitives) {
      if (primitive===null || typeof primitive!=='object') continue
      const p=primitive as {mode?:number;indices?:number;attributes?:{POSITION?:number}}
      if (p.mode!==undefined && p.mode!==4) continue
      const index=p.indices ?? p.attributes?.POSITION
      const accessor=typeof index==='number'?accessors[index]:undefined
      const n=accessor!==null && typeof accessor==='object'
        ?(accessor as {count?:unknown}).count:undefined
      if(typeof n==='number' && Number.isSafeInteger(n) && n>=3)triangles+=Math.floor(n/3)
    }
  }
  if (meshes.length===0 || triangles<300) {
    throw new Error('Studio 3D: la malla tiene menos de 300 triángulos o no contiene meshes. Las primitivas son solo un boceto; crea una malla real antes de publicar.')
  }
  return {meshes:meshes.length,triangles,materials:materials.length,skins:skins.length,
    animations:animations.length,sourceGeometryVerified:true,appearanceReviewed:false}
}
export function studio3DBlenderScript(root:string):string {
  const configured=process.env.PHOENIX_STUDIO3D_SCRIPT?.trim()
  const repo=process.env.PHOENIX_REPO_ROOT?.trim()
  const candidates=[
    ...(configured?[configured]:[]),
    ...(repo?[join(repo,'scripts','phoenix-3d-studio.py')]:[]),
    join(process.cwd(),'scripts','phoenix-3d-studio.py'),
    join(root,'scripts','phoenix-3d-studio.py'),
  ]
  const found=candidates.find(path=>existsSync(path) && statSync(path).isFile())
  if (found===undefined) throw Error('Studio 3D: falta scripts/phoenix-3d-studio.py. Configura PHOENIX_STUDIO3D_SCRIPT con la ruta de instalación.')
  return realpathSync(found)
}
export interface Studio3DRunInput {
  readonly modelPath:string
  readonly outputDir:string
  readonly workspace:string
  readonly scenePath?:string
  readonly resolution:number
  readonly samples:number
  readonly animationPreview:boolean
  readonly signal:AbortSignal
}
/** Invoke one trusted repository script with fixed argument positions; no shell, no arbitrary Python. */
export async function renderStudio3D(input:Studio3DRunInput):Promise<void> {
  const blender=process.env.PHOENIX_BLENDER_PATH?.trim() || 'blender'
  const script=studio3DBlenderScript(input.workspace)
  const argv=[
    '--background','--factory-startup','--python',script,'--',
    '--output',input.outputDir,
    '--asset-glb',input.modelPath,
    '--resolution',String(input.resolution),
    '--samples',String(input.samples),
    ...(input.scenePath===undefined?[]:['--input',input.scenePath]),
    ...(input.animationPreview?['--animation-preview']:[]),
  ]
  await new Promise<void>((resolveDone,rejectDone)=>{
    let completed=false
    const process3D=spawn(blender,argv,{
      cwd:input.workspace,windowsHide:true,signal:input.signal,timeout:540_000,
      stdio:['ignore','pipe','pipe'],
    })
    let output=''
    const receive=(chunk:Buffer):void=>{output=(output+chunk.toString('utf8')).slice(-3000)}
    process3D.stdout?.on('data',receive)
    process3D.stderr?.on('data',receive)
    process3D.once('error',(error)=>{
      if(completed)return
      completed=true
      rejectDone(new Error('Blender Studio no pudo arrancar: '+error.message+
        '. Instala Blender y configura PHOENIX_BLENDER_PATH si no está en PATH.'))
    })
    process3D.once('close',(status)=>{
      if(completed)return
      completed=true
      if(status===0)resolveDone()
      else rejectDone(new Error('Blender Studio falló (exit '+String(status)+'): '+output))
    })
  })
}
/** Real 3D model publishing tool; the authoring agent must create a genuine GLB first. */
export function createPhoenixStudio3DTool():ToolDefinition {
  return defineTool({
    name:'phoenix_studio3d',
    description:'PHOENIX 3D Studio PRODUCTION: for any requested high-quality 3D model, character, animation, architecture, anatomy, game asset or professional 3D project, use REAL MESH ASSETS and Blender, never the primitive-only phoenix_3d preview. First plan and CREATE an actual detailed .glb inside the agent workspace using available coding/Blender/model-creation tools and/or authorized locally stored assets. The Blender Studio publisher takes model_path to that real GLB, validates its triangulated structure, runs the trusted Blender Cycles offline renderer, saves real scene.blend/scene.glb/render.png, optionally animation.mp4, and publishes a true visual chat artifact with download links. Use this tool AFTER generating the GLB; do not submit fake paths or JSON primitives. Blender is detected via PATH or PHOENIX_BLENDER_PATH; if unavailable, report installation/configuration explicitly and do not downgrade silently. The published image proves a render was generated, NOT that geometry matches a medical reference or that the artwork is artistically approved. Rigging and skeletal animation live in the original GLB/Blender project; the quick native viewer is only for simple blockouts. Never claim production completion from a primitive preview. For reference reconstruction request authoritative geometry and measurements.',
    timeoutMs:600_000,
    parameters:{
      title:{type:'string',required:true,description:'Name of the real Blender production asset.'},
      model_path:{type:'string',required:true,description:'Workspace-relative .glb produced by Blender or asset pipeline; must contain substantial mesh geometry.'},
      scene_path:{type:'string',description:'Optional workspace-relative PHOENIX scene3d.json additional environment objects.'},
      resolution:{type:'number',description:'Blender Cycles render width/height in px (512-2560, default 1280).'},
      samples:{type:'number',description:'Cycles render samples (8-256, default 64).'},
      animation_preview:{type:'boolean',description:'Also render a real MP4 preview of supplied animation.'},
      continueAfterDisplay:{type:'boolean',description:'Continue work after production output; default false.'},
    },
    output:{
      schema:{type:'object',additionalProperties:false,properties:{
        artifactId:{type:'string',required:true},
        title:{type:'string',required:true},
        renderUrl:{type:'string',required:true},
        modelUrl:{type:'string',required:true},
        projectUrl:{type:'string',required:true},
        animationUrl:{type:'string'},
        audit:{type:'json',required:true},
      }},
      render:(_args,value)=>[{type:'text',text:'Blender Studio: render Cycles y activos GLB/BLEND reales verificados estructuralmente. '+String(value.title)+'. Inspección visual humana pendiente; no se afirma calidad fotográfica automáticamente.'}],
      presentationMeta:(_args,value)=>({artifact:{
        id:value.artifactId,mime:PHOENIX_STUDIO3D_MIME,title:value.title,
        data:{renderUrl:value.renderUrl,modelUrl:value.modelUrl,projectUrl:value.projectUrl,
          ...(value.animationUrl===undefined?{}:{animationUrl:value.animationUrl}),
          audit:value.audit},executable:false,
      }}),
    },
    async execute(args,exec){
      const title=args.title.trim()
      if(title.length<1||title.length>140)throw new ToolArgsError(['Studio 3D: título inválido.'])
      const workspace=exec.agent?.session.header.cwd
      if(!workspace)throw new ToolArgsError(['Studio 3D: no hay workspace de agente.'])
      let modelPath:string,scenePath:string|undefined
      try{
        modelPath=resolveStudio3DWorkspaceFile(workspace,args.model_path,'.glb')
        scenePath=typeof args.scene_path==='string'
          ?resolveStudio3DWorkspaceFile(workspace,args.scene_path,'.json'):undefined
      }catch(error){throw new ToolArgsError([error instanceof Error?error.message:String(error)])}
      exec.signal.throwIfAborted()
      let audit:Studio3DModelAudit
      try{audit=inspectStudio3DModel(modelPath)}
      catch(error){throw new ToolArgsError([error instanceof Error?error.message:String(error)])}
      const resolution=typeof args.resolution==='number'?args.resolution:1280
      const samples=typeof args.samples==='number'?args.samples:64
      if(!Number.isInteger(resolution)||resolution<512||resolution>2560
        ||!Number.isInteger(samples)||samples<8||samples>256) {
        throw new ToolArgsError(['Studio 3D: resolución 512-2560 y samples 8-256.'])
      }
      const outputDir=join(workspace,'.artifacts','studio3d-'+randomBytes(8).toString('hex'))
      mkdirSync(outputDir,{recursive:true})
      await renderStudio3D({modelPath,outputDir,workspace,
        ...(scenePath===undefined?{}:{scenePath}),
        resolution,samples,animationPreview:args.animation_preview===true,signal:exec.signal})
      exec.signal.throwIfAborted()
      const receipt=publishStudio3DAssets(outputDir,workspace)
      if(args.continueAfterDisplay!==true)exec.concludeTurn()
      return {
        artifactId:'phoenix-studio3d:'+String(exec.callId),title,
        renderUrl:receipt.renderUrl,modelUrl:receipt.modelUrl,projectUrl:receipt.projectUrl,
        ...(receipt.animationUrl===undefined?{}:{animationUrl:receipt.animationUrl}),
        audit:{...audit,renderer:'Blender Cycles',renderGenerated:true,visualQualityCertified:false},
      }
    },
    presentCall(args){
      return {card:'generic',title:'Blender Studio · '+args.title,kind:'read',
        rawInput:'Construcción de activos 3D profesionales y render Cycles en PHOENIX'}
    },
  })
}
