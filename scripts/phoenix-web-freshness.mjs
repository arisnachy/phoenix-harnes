/**
 * A source checkout can retain outdated apps/web/dist after a Git update.
 * In that state pnpm phoenix serves old frontend code, so validated sports
 * cards end up displayed as Markdown code. Rebuild before launching Phoenix.
 *
 * Packaged installs without .git continue to use their prepared frontend.
 */
import {execFileSync,spawnSync} from 'node:child_process'
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
const SOURCE_ROOT=fileURLToPath(new URL('../',import.meta.url))
const STAMP='.phoenix-web-source-revision.json'

/** Read repository revision without modifying the user's worktree. */
export function checkoutRevision(root=SOURCE_ROOT,git=execFileSync){
  try{
    return String(git('git',['rev-parse','--verify','HEAD'],{
      cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:2500,
    })).trim().match(/^[a-f0-9]{40}$/u)?.[0]??null
  }catch{return null}
}
/** A revision stamp is authoritative only when index.html is also present. */
export function frontendIsCurrent(root,revision){
  const dist=join(root,'apps','web','dist')
  if(!existsSync(join(dist,'index.html')))return false
  try{
    const marker=JSON.parse(readFileSync(join(dist,STAMP),'utf8'))
    return marker?.revision===revision&&marker?.successful===true
  }catch{return false}
}
/** Avoid a false-green UI: stamp the build only after all stages succeed. */
export function verifyFrontend({
  root=SOURCE_ROOT,
  readRevision=checkoutRevision,
  build,
  skip=process.env.PHOENIX_SKIP_WEB_FRESHNESS==='1',
}={}){
  const revision=readRevision(root)
  const index=join(root,'apps','web','dist','index.html')
  if(revision===null){
    // An installed app ships prebuilt assets rather than a Git checkout.
    if(!existsSync(index))throw new Error('Phoenix no tiene frontend compilado y este directorio no es un checkout Git. Instala una distribución completa.')
    return {status:'packaged',revision:null}
  }
  if(frontendIsCurrent(root,revision))return {status:'current',revision}
  if(skip){
    throw new Error('Phoenix detectó un frontend anterior al código actual. Se solicitó omitir la actualización automática con PHOENIX_SKIP_WEB_FRESHNESS=1; desactívalo para no mostrar generative-ui como código.')
  }
  const commands=[['run','build:lib:host'],['run','build:lib:client'],['run','build:web']]
  const runner=build??((args)=>{
    const out=spawnSync('pnpm',args,{cwd:root,stdio:'inherit',shell:process.platform==='win32',
      timeout:15*60*1000,env:process.env})
    if(out.error)throw out.error
    return out.status??1
  })
  process.stdout.write('[PHOENIX] Frontend de este commit no verificado. Reconstruyendo interfaz antes del arranque.\n')
  for(const args of commands){
    const status=runner(args)
    if(status!==0)throw new Error('Falló '+['pnpm',...args].join(' ')+'. No iniciaré la versión antigua del frontend. Verifica la compilación y las dependencias.')
  }
  if(!existsSync(index))throw new Error('Vite finalizó sin generar apps/web/dist/index.html; no iniciaré una interfaz desactualizada.')
  if(readRevision(root)!==revision)throw new Error('El checkout cambió durante la compilación. Vuelve a ejecutar pnpm phoenix.')
  const marker=join(dirname(index),STAMP)
  mkdirSync(dirname(marker),{recursive:true})
  writeFileSync(marker,JSON.stringify({revision,successful:true,builtAt:new Date().toISOString()})+'\n',{encoding:'utf8'})
  process.stdout.write('[PHOENIX] Interfaz actualizada para '+revision.slice(0,12)+'.\n')
  return {status:'rebuilt',revision}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  try{verifyFrontend()}catch(error){console.error('[PHOENIX] '+String(error?.message||error));process.exitCode=1}
}
