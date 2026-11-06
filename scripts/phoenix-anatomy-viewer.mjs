#!/usr/bin/env node
/** Private loopback-only research viewer for PHOENIX anatomy.glb. */
import {createServer} from 'node:http'
import {readFile,stat} from 'node:fs/promises'
import {existsSync,readFileSync} from 'node:fs'
import {randomBytes,timingSafeEqual} from 'node:crypto'
import {resolve,join} from 'node:path'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {rootFor} from './phoenix-anatomy-auto.mjs'

const html=fileURLToPath(new URL('./phoenix-anatomy-viewer.html',import.meta.url))
const maxBytes=350*1024*1024
const vendorFiles={
 'build/three.module.js':['build/three.module.js','text/javascript'],
 'build/three.core.js':['build/three.core.js','text/javascript'],
 'examples/jsm/loaders/GLTFLoader.js':['examples/jsm/loaders/GLTFLoader.js','text/javascript'],
 'examples/jsm/utils/BufferGeometryUtils.js':['examples/jsm/utils/BufferGeometryUtils.js','text/javascript'],
 'examples/jsm/controls/OrbitControls.js':['examples/jsm/controls/OrbitControls.js','text/javascript'],
}
function equal(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
export function modelFiles(folder){
 const target=resolve(folder),model=join(target,'anatomy.glb'),manifest=join(target,'anatomy-manifest.json')
 if(!existsSync(model)||!existsSync(manifest))throw Error('Missing anatomy.glb or anatomy-manifest.json')
 const data=JSON.parse(readFileSync(manifest,'utf8'))
 if(data?.clinicalStatus!=='UNVALIDATED_RESEARCH_OUTPUT'||data.needsExpertReview!==true)
  throw Error('Unrecognized or misleading clinical status; model must require clinician review')
 return {model,manifest}
}
async function serve(res,file,type){
 try{const s=await stat(file);if(!s.isFile()||s.size>maxBytes)throw Error('not found')
  const bytes=await readFile(file)
  res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length});res.end(bytes)
 }catch{res.writeHead(404);res.end('File unavailable')}
}
export async function startViewer({folder,host='127.0.0.1',port=0,open=false}){
 if(host!=='127.0.0.1')throw Error('Viewer only permits loopback access')
 const {model,manifest}=modelFiles(folder)
 const vendor=join(rootFor(),'viewer','node_modules','three')
 for(const [file] of Object.values(vendorFiles))
  if(!existsSync(join(vendor,file)))throw Error('Local three.js missing; run anatomy installer')
 const secret=randomBytes(32).toString('hex')
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store')
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('X-Frame-Options','DENY')
  res.setHeader('Referrer-Policy','no-referrer')
  res.setHeader('Cross-Origin-Resource-Policy','same-origin')
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'")
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
  if(req.headers.host!=='127.0.0.1:'+server.address().port){res.writeHead(403);res.end();return}
  let parts
  try{parts=new URL(req.url||'/','http://127.0.0.1').pathname.split('/')}catch{res.writeHead(400);res.end();return}
  if(parts[1]!=='view'||!equal(parts[2]||'',secret)){res.writeHead(404);res.end();return}
  const item=parts.slice(3).join('/')
  if(item===''||item==='index.html')return serve(res,html,'text/html; charset=utf-8')
  if(item==='anatomy.glb')return serve(res,model,'model/gltf-binary')
  if(item==='anatomy-manifest.json')return serve(res,manifest,'application/json')
  if(Object.hasOwn(vendorFiles,item)){
   const [file,type]=vendorFiles[item];return serve(res,join(vendor,file),type)
  }
  res.writeHead(404);res.end()
 })
 await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes)})
 const url='http://127.0.0.1:'+server.address().port+'/view/'+secret+'/'
 if(open){try{
  if(process.platform==='win32')spawn('cmd.exe',['/d','/c','start','',url],{stdio:'ignore',windowsHide:true,detached:true}).unref()
  else spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore',detached:true}).unref()
 }catch{/* printed URL can be opened by user */}}
 return {server,url}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const n=process.argv.indexOf('--folder'),folder=n>=0?process.argv[n+1]:null
 if(!folder){console.error('Usage: node scripts/phoenix-anatomy-viewer.mjs --folder <output> [--open]');process.exitCode=2}
 else startViewer({folder,open:process.argv.includes('--open')}).then(({url})=>
  console.log(JSON.stringify({status:'viewer-ready',url,clinicallyValidated:false}))
 ).catch(e=>{console.error('Anatomy viewer: '+e.message);process.exitCode=1})
}
