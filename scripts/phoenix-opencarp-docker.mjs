/**
 * Official openCARP container installer/probe. Docker Desktop is a prerequisite
 * on Windows; installing it may require OS privileges and is never hidden here.
 * No patient inputs or paths are sent to the image registry.
 */
import {spawn} from 'node:child_process'

export const OPENCARP_DOCKER_IMAGE='docker.opencarp.org/opencarp/opencarp:latest'
const IMAGE_ID=/^sha256:[a-f0-9]{64}$/i

/** Bounded, shell-free local Docker CLI execution. Injectable in tests. */
export async function dockerCommand(args,{timeoutMs=12000}={}){
 return await new Promise((resolve,reject)=>{
  let ended=false,stdout='',stderr=''
  const child=spawn('docker',args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']})
  const finish=(error)=>{
   if(ended)return
   ended=true;clearTimeout(timer)
   if(error)reject(error);else resolve({stdout,stderr})
  }
  const timer=setTimeout(()=>{child.kill();finish(Error('Docker command timeout'))},timeoutMs)
  child.stdout.on('data',d=>{stdout=(stdout+String(d)).slice(-4096)})
  child.stderr.on('data',d=>{stderr=(stderr+String(d)).slice(-4096)})
  child.on('error',finish)
  child.on('close',code=>finish(code===0?null:Error('Docker command failed (exit '+code+')')))
 })
}
/** Validate an existing local image through real openCARP executable execution. */
export async function probeOpenCarpDocker(command=dockerCommand,knownImageId=null){
 try{
  await command(['info','--format','{{.ServerVersion}}'],{timeoutMs:12000})
  let imageId=knownImageId
  if(!imageId){
   const image=await command(['image','inspect','--format','{{.Id}}',OPENCARP_DOCKER_IMAGE],
     {timeoutMs:12000})
   imageId=image.stdout.trim()
  }
  if(!IMAGE_ID.test(imageId))return null
  await command(['run','--rm','--network','none','--entrypoint','openCARP',
    imageId,'-buildinfo'],{timeoutMs:90000})
  return {mode:'docker',imageId,verifiedAt:new Date().toISOString()}
 }catch{return null}
}
/** A single explicit plugin click pulls the vendor image; no host package manager/elevation. */
export async function installOpenCarpDocker(command=dockerCommand){
 try{await command(['info','--format','{{.ServerVersion}}'],{timeoutMs:12000})}
 catch{return {status:'deferred',reason:'Docker Desktop is missing, stopped, or inaccessible. Install and start Docker Desktop, then retry.'}}
 try{await command(['pull',OPENCARP_DOCKER_IMAGE],{timeoutMs:30*60*1000})}
 catch{return {status:'error',reason:'Official openCARP image pull failed; check the Docker registry and local install.log.'}}
 const verified=await probeOpenCarpDocker(command)
 if(!verified)return {status:'error',reason:'Docker image downloaded, but openCARP -buildinfo could not be verified.'}
 return {status:'installed',...verified}
}
