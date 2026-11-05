/**
 * PHOENIX Fabric worker — on-demand execution by explicit capabilities.
 *
 * Import a trusted, locally approved handler module. Arbitrary remote scripts
 * are never downloaded or evaluated. A handler must prove its side effect by
 * returning a verified result reference, or the task is marked failed.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { fabricRequest } from './phoenix-fabric-client.mjs'

const CAP=/^[a-z][a-z0-9._-]{0,63}$/u
const RESULT=/^[a-z][a-z0-9._-]{0,63}$/u
function ensureHandlers(handlers){
  if(!handlers||typeof handlers!=='object'||Array.isArray(handlers))
    throw Error('Handlers debe ser un objeto de capacidades')
  for(const [name,fn] of Object.entries(handlers)){
    if(!CAP.test(name)||typeof fn!=='function')
      throw Error('Handler inválido: '+name)
  }
}
export async function runFabricWorker({
  handlers,signal,intervalMs=1000,once=false,onResult=()=>{}
}){
  ensureHandlers(handlers)
  if(!Number.isInteger(intervalMs)||intervalMs<50||intervalMs>60000)
    throw Error('Intervalo inválido')
  let handled=0
  while(!signal?.aborted){
    await fabricRequest('/v1/nodes/heartbeat',{method:'POST',data:{}})
    const {assignment}=await fabricRequest('/v1/tasks/next')
    if(!assignment){
      if(once)break
      try{await sleep(intervalMs,undefined,{signal})}
      catch(error){if(error.name==='AbortError')break;throw error}
      continue
    }
    const {task,leaseToken}=assignment
    let resultRef='unsupported_capability',outcome='failed'
    const handler=handlers[task.capability]
    if(handler){
      try{
        const result=await Promise.race([
          Promise.resolve().then(()=>handler(Object.freeze({
            taskId:task.taskId,organizationId:task.organizationId,
            capability:task.capability,references:Object.freeze([...task.references]),
            purpose:task.purpose,sourceNodeId:task.sourceNodeId
          }))),
          sleep(20000).then(()=>{throw Error('Tiempo del handler agotado')})
        ])
        if(result?.verified===true&&typeof result.resultRef==='string'&&
          RESULT.test(result.resultRef)){
          resultRef=result.resultRef;outcome='completed'
        }else resultRef='unverified_result'
      }catch{resultRef='handler_failed'}
    }
    const reply=await fabricRequest('/v1/tasks/'+task.taskId+'/finish',{
      method:'POST',data:{leaseToken,outcome,resultRef}
    })
    handled++
    onResult({taskId:task.taskId,capability:task.capability,
      outcome:reply.task.state,resultRef:reply.task.resultRef})
    if(once)break
  }
  return {handled,stopped:!!signal?.aborted}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const controller=new AbortController()
  const stop=()=>controller.abort()
  process.once('SIGINT',stop);process.once('SIGTERM',stop)
  const modulePath=process.env.PHOENIX_FABRIC_HANDLER_MODULE
  // Only a developer-supplied local file can register business capabilities.
  // The default worker acknowledges only a synthetic ping.
  const handlers=modulePath?
    (await import(pathToFileURL(resolve(modulePath)).href)).handlers:{
      'fabric.ping':()=>({verified:true,resultRef:'fabric_pong'})
    }
  runFabricWorker({handlers,signal:controller.signal,
    onResult:record=>console.log(JSON.stringify(record))})
    .catch(error=>{console.error('Fabric worker: '+error.message);process.exitCode=1})
}
