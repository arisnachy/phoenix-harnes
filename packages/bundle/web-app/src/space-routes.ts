/** Private loopback API for PHOENIX Space. No LAN exposure, no CORS, no arbitrary paths. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@phoenix-ai/cordis'
import type {} from '@phoenix-ai/dsh-host-webserver'
import { parseSpaceClipboard, syntheticSpaceDataset } from './space-workflows.ts'
import { PhoenixSpaceStore } from './space-store.ts'
import { exportPptx, exportXlsx } from './space-office.ts'
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, extname } from 'node:path'
import openNative from 'open'

const HEADERS:Record<string,string>={
  'content-type':'application/json; charset=utf-8','cache-control':'no-store, max-age=0',
  'x-content-type-options':'nosniff','x-frame-options':'DENY',
  'cross-origin-resource-policy':'same-origin','referrer-policy':'no-referrer',
}
function reply(res:ServerResponse,status:number,data:unknown):void {
  res.writeHead(status,HEADERS);res.end(JSON.stringify(data))
}
export function spacePeer(req:IncomingMessage):boolean {
  const address=req.socket.remoteAddress||''
  const host=req.headers.host||''
  return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address)
    && /^127\.0\.0\.1:\d{1,5}$/u.test(host)
}
function mutationAllowed(req:IncomingMessage):boolean {
  return req.headers.origin==='http://'+(req.headers.host||'')
    && req.headers['x-phoenix-space']==='1'
    && req.headers['content-type']?.split(';',1)[0]?.trim()==='application/json'
}
async function body(req:IncomingMessage):Promise<Record<string,unknown>> {
  let count=0;const chunks:Buffer[]=[]
  for await(const raw of req){
    const part=Buffer.isBuffer(raw)?raw:Buffer.from(raw)
    count+=part.length
    if(count>14_000_000)throw new Error('PAYLOAD_LIMIT')
    chunks.push(part)
  }
  let parsed:unknown
  try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new Error('JSON inválido')}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('JSON inválido')
  return parsed as Record<string,unknown>
}
function revision(value:unknown):number {
  if(!Number.isInteger(value)||Number(value)<1||Number(value)>1000000)throw new Error('Revisión inválida')
  return Number(value)
}
function preview(item:ReturnType<PhoenixSpaceStore['create']>) {
  const {content,...rest}=item
  return {...rest,excerpt:content.slice(0,150)}
}
function download(res:ServerResponse,bytes:Buffer,mime:string,name:string):void {
  const safe=encodeURIComponent(name.slice(0,180))
  res.writeHead(200,{...HEADERS,'content-type':mime,'content-length':String(bytes.length),
    'content-security-policy':"default-src 'none'; sandbox",
    'content-disposition':"attachment; filename*=UTF-8''"+safe})
  res.end(bytes)
}
const NATIVE_DOCUMENT_EXTENSIONS=new Set(['.pdf','.docx','.xlsx','.pptx','.odt','.ods','.odp','.rtf','.txt','.csv','.epub','.png','.jpg','.jpeg','.webp','.gif','.tif','.tiff','.heic','.mp4','.mov','.webm','.mp3','.wav','.flac','.ogg','.glb','.gltf','.obj','.stl','.fbx','.blend','.dcm','.dicom','.nii','.nrrd','.sqlite','.sqlite3','.db','.parquet','.sav','.dta','.dwg','.dxf','.step','.stp','.kml','.kmz','.geojson','.shp','.psd','.xcf','.zip','.rar','.7z','.tar','.gz'])
export function nativeDocumentExtension(title:string,bytes:Buffer):string|undefined {
  const ext=extname(title).toLowerCase()
  if(!NATIVE_DOCUMENT_EXTENSIONS.has(ext)||bytes.length<1)return undefined
  // Block executable signatures even if renamed as a document.
  if(bytes.subarray(0,2).toString('ascii')==='MZ'||bytes.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46]))
    ||['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca'].includes(bytes.subarray(0,4).toString('hex'))
    ||bytes.subarray(0,2).toString('ascii')==='#!')return undefined
  return ext
}
function statusFor(error:unknown):number {
  const message=error instanceof Error?error.message:''
  if(message==='CONFLICT')return 409
  if(/no encontrado|no encontrada/u.test(message))return 404
  if(/demasiado grande|PAYLOAD_LIMIT/u.test(message))return 413
  if(/invalid|inválid|desconocid|demasiad|límite|Revisión/u.test(message))return 400
  return 500
}
export function registerSpaceRoutes(ctx:Context):void {
  if(ctx.webServer.host!=='127.0.0.1'){
    ctx.logger.warn('PHOENIX Space solo está disponible en 127.0.0.1.')
    return
  }
  let store:PhoenixSpaceStore|undefined
  const open=():PhoenixSpaceStore=>store??(store=new PhoenixSpaceStore())
  const dispose=ctx.webServer.register({
    kind:'prefix',path:'/space-api',
    handler:async(req:IncomingMessage,res:ServerResponse)=>{
      if(!spacePeer(req)){reply(res,403,{error:'Acceso local requerido'});return}
      const url=new URL(req.url||'/','http://127.0.0.1')
      const path=url.pathname
      const method=req.method||''
      if(!['GET','POST','PUT'].includes(method)){res.writeHead(405,{...HEADERS,allow:'GET, POST, PUT'});res.end();return}
      if(method!=='GET'&&!mutationAllowed(req)){reply(res,403,{error:'Origen y encabezados de seguridad requeridos'});return}
      try{
        const catalog=open()
        if(path==='/space-api/items'&&method==='GET'){
          const q=url.searchParams.get('q')||''
          const kind=url.searchParams.get('kind')||'all'
          const space=url.searchParams.get('space')||'all'
          const deleted=url.searchParams.get('deleted')==='1'
          reply(res,200,{items:catalog.list({q,kind,space,deleted}).map(preview)})
          return
        }
        if(path==='/space-api/items'&&method==='POST'){
          const data=await body(req)
          const created=catalog.create(data)
          reply(res,201,{item:created})
          return
        }
        if(path==='/space-api/clipboard'&&method==='POST'){
          const data=await body(req)
          const sheet=parseSpaceClipboard(data.text)
          reply(res,201,{item:catalog.create({kind:'sheet',space:'personal',title:'Tabla desde portapapeles',mime:'application/vnd.phoenix.sheet+json',content:JSON.stringify(sheet)})});return
        }
        if(path==='/space-api/synthetic'&&method==='POST'){
          const data=await body(req)
          const sheet=syntheticSpaceDataset(data.seed,data.count)
          // Same seed and count produce the same stored fixture; preserve user edits.
          reply(res,201,{item:catalog.create({kind:'sheet',space:'simulacion',title:'FICTICIO · Demanda hospitalaria',mime:'application/vnd.phoenix.sheet+json',content:JSON.stringify(sheet),sourceKey:'synthetic-demand-v1:'+String(data.seed)+':'+String(data.count)})});return
        }
        if(path==='/space-api/portable-import'&&method==='POST'){
          const data=await body(req)
          if(data.format!=='phoenix-space-portable-v1')throw new Error('Formato inválido')
          reply(res,201,{item:catalog.create({kind:data.kind,space:'personal',title:data.title,mime:data.mime,content:data.content})});return
        }
        if(path==='/space-api/import'&&method==='POST'){
          const data=await body(req)
          if(typeof data.base64!=='string'||data.base64.length>13_400_000||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(data.base64))
            throw new Error('Archivo inválido')
          const bytes=Buffer.from(data.base64,'base64')
          if(bytes.toString('base64')!==data.base64)throw new Error('Archivo inválido')
          const item=catalog.importFile(data.title,data.mime,bytes,
            typeof data.space==='string'?data.space:'personal')
          reply(res,201,{item})
          return
        }
        const match=/^\/space-api\/items\/([a-f0-9-]{36})(?:\/(file|export|history|restore|open-native|version|fork|merge|dependencies|derive))?$/u.exec(path)
        if(!match){reply(res,404,{error:'Ruta desconocida'});return}
        const id=match[1]!
        const operation=match[2]||''
        const item=catalog.get(id)
        if(!item){reply(res,404,{error:'Elemento no encontrado'});return}
        if(operation===''&&method==='GET'){reply(res,200,{item});return}
        if(operation===''&&method==='PUT'){
          const data=await body(req)
          const expected=revision(data.revision)
          const {revision:_,...change}=data
          reply(res,200,{item:catalog.update(id,expected,change)})
          return
        }
        if(operation==='history'&&method==='GET'){reply(res,200,{versions:catalog.history(id)});return}
        if(operation==='restore'&&method==='POST'){
          const data=await body(req)
          reply(res,200,{item:catalog.restore(id,revision(data.restoreRevision),revision(data.revision))})
          return
        }

        if(operation==='version'&&method==='GET'){
          const result=catalog.version(id,revision(Number(url.searchParams.get('revision'))))
          if(!result){reply(res,404,{error:'Versión no encontrada'});return}
          reply(res,200,{version:result});return
        }
        if(operation==='fork'&&method==='POST'){
          const data=await body(req)
          reply(res,201,{item:catalog.fork(id,revision(data.revision),data.title)});return
        }
        if(operation==='fork'&&method==='GET'){
          reply(res,200,{origin:catalog.forkOrigin(id)});return
        }
        if(operation==='merge'&&method==='POST'){
          const data=await body(req)
          if(data.confirm!==true){reply(res,400,{error:'Se requiere confirmación explícita'});return}
          reply(res,200,{item:catalog.mergeFork(id,revision(data.revision),revision(data.parentRevision))});return
        }
        if(operation==='derive'&&method==='POST'){
          const data=await body(req)
          if(data.confirm!==true)throw Error('Confirmación inválida')
          reply(res,201,{item:catalog.deriveSummary(id,revision(data.revision),data.kind)});return
        }
        if(operation==='dependencies'&&method==='GET'){
          reply(res,200,catalog.dependencies(id));return
        }
        if(operation==='dependencies'&&method==='PUT'){
          const data=await body(req)
          catalog.setDependencies(id,revision(data.revision),data.sources)
          reply(res,200,catalog.dependencies(id));return
        }
        if(operation==='open-native'&&method==='POST'){
          const data=await body(req)
          if(data.confirm!==true){reply(res,400,{error:'Se requiere confirmación explícita'});return}
          const bytes=catalog.importedBytes(id)
          const ext=bytes?nativeDocumentExtension(item.title,bytes):undefined
          if(!bytes||!ext){reply(res,400,{error:'Formato no autorizado para apertura nativa. Descarga el original.'});return}
          const root=join(catalog.root,'native-open')
          mkdirSync(root,{recursive:true,mode:0o700})
          const directory=mkdtempSync(join(root,'file-'))
          const target=join(directory,'document'+ext)
          writeFileSync(target,bytes,{flag:'wx',mode:0o600})
          await openNative(target,{wait:false})
          reply(res,200,{opened:true})
          return
        }
        if(operation==='file'&&method==='GET'){
          const bytes=catalog.importedBytes(id)
          if(!bytes){reply(res,404,{error:'Archivo no disponible'});return}
          download(res,bytes,item.mime,item.title)
          return
        }
        if(operation==='export'&&method==='GET'&&!item.deleted){
          const format=url.searchParams.get('format')
          if(format==='pptx'&&item.kind==='slides'){
            download(res,exportPptx(item.content),
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',item.title+'.pptx')
            return
          }
          if(format==='xlsx'&&item.kind==='sheet'){
            download(res,exportXlsx(item.content),
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',item.title+'.xlsx')
            return
          }
          if(format==='portable'&&item.bytes===0){
            // Export the portable source only. No local IDs, credentials, paths or connector tokens are added.
            // The source itself may require dependencies; this is not a verified executable package.
            download(res,Buffer.from(JSON.stringify({format:'phoenix-space-portable-v1',kind:item.kind,title:item.title,mime:item.mime,content:item.content},null,2),'utf8'),'application/json',item.title+'.phoenix.json')
            return
          }
          if(format==='json'){
            download(res,Buffer.from(item.content,'utf8'),'application/json',item.title+'.json')
            return
          }
        }
        reply(res,404,{error:'Acción no disponible'})
      }catch(error){
        const status=statusFor(error)
        reply(res,status,{error:status===500?'No se pudo completar la operación':
          error instanceof Error?error.message:'Solicitud inválida'})
      }
    },
  })
  ctx.effect(()=>()=>{dispose();store?.close()},'PHOENIX Space private route and durable store')
}
