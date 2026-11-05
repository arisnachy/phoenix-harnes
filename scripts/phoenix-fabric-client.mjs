/**
 * PHOENIX Fabric command line client. Client-side mTLS works with a
 * separately provisioned client certificate and CA. No automatic discovery.
 *
 * Environment:
 *  PHOENIX_FABRIC_URL            http://127.0.0.1:8765 or private https URL
 *  PHOENIX_FABRIC_ADMIN_TOKEN    register/revoke/approve/nodes/metrics
 *  PHOENIX_FABRIC_NODE_TOKEN     send/next/task/finish/heartbeat
 *  PHOENIX_FABRIC_CLIENT_CERT, PHOENIX_FABRIC_CLIENT_KEY,
 *  PHOENIX_FABRIC_TLS_CA         needed for non-loopback HTTPS mutual TLS
 */
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function endpoint(){
  const input=process.env.PHOENIX_FABRIC_URL||'http://127.0.0.1:8765'
  const base=new URL(input)
  if(!['http:','https:'].includes(base.protocol))throw Error('Protocolo no permitido')
  if(base.protocol==='http:'&&!['127.0.0.1','[::1]'].includes(base.hostname))
    throw Error('Solo se permite HTTP en loopback; configure HTTPS/mTLS para red')
  if(base.username||base.password||base.search||base.hash||base.pathname!=='/')
    throw Error('PHOENIX_FABRIC_URL debe ser solo el origen')
  return base
}
export async function fabricRequest(path,{method='GET',admin=false,data}={}){
  const base=endpoint()
  if(!path.startsWith('/v1/')&&!path.startsWith('/healthz'))
    throw Error('Ruta no permitida')
  const token=process.env[admin?'PHOENIX_FABRIC_ADMIN_TOKEN':'PHOENIX_FABRIC_NODE_TOKEN']
  if(!token||!/^[a-f0-9]{64}$/iu.test(token))
    throw Error('Falta el token '+(admin?'administrativo':'del nodo'))
  const url=new URL(path,base)
  const body=data===undefined?undefined:JSON.stringify(data)
  const opts={method,headers:{authorization:'Bearer '+token,
    ...(body===undefined?{}:{'content-type':'application/json','content-length':Buffer.byteLength(body)})},
    timeout:10000}
  if(base.protocol==='https:'){
    const env=process.env
    if(!env.PHOENIX_FABRIC_CLIENT_CERT||!env.PHOENIX_FABRIC_CLIENT_KEY||
      !env.PHOENIX_FABRIC_TLS_CA)
      throw Error('La conexión HTTPS requiere certificado, clave y CA del cliente')
    Object.assign(opts,{
      cert:readFileSync(env.PHOENIX_FABRIC_CLIENT_CERT),
      key:readFileSync(env.PHOENIX_FABRIC_CLIENT_KEY),
      ca:readFileSync(env.PHOENIX_FABRIC_TLS_CA),
      rejectUnauthorized:true,minVersion:'TLSv1.2'
    })
  }
  const raw=await new Promise((resolve,reject)=>{
    const req=(base.protocol==='https:'?httpsRequest:httpRequest)(url,opts,res=>{
      let size=0,parts=[]
      res.on('data',chunk=>{size+=chunk.length
        if(size>65536){req.destroy(Error('Respuesta demasiado grande'));return}
        parts.push(chunk)
      })
      res.on('end',()=>resolve({status:res.statusCode,
        text:Buffer.concat(parts).toString('utf8')}))
    })
    req.on('timeout',()=>req.destroy(Error('Tiempo de espera agotado')))
    req.on('error',reject)
    req.end(body)
  })
  let dataOut
  try{dataOut=JSON.parse(raw.text)}catch{throw Error('Respuesta no JSON del servidor')}
  if(raw.status>=400)throw Error('HTTP '+raw.status+': '+(dataOut.error||'Error desconocido'))
  return dataOut
}
function args(need,actual){
  if(actual.length!==need)throw Error('Número de argumentos incorrecto')
}
export async function runFabricCommand(argv){
  const [action,...values]=argv
  if(action==='nodes'||action==='metrics'){
    args(0,values)
    return fabricRequest('/v1/admin/'+action,{admin:true})
  }
  if(action==='enroll'){
    args(5,values)
    const [nodeId,organizationId,siteId,caps,senders]=values
    return fabricRequest('/v1/admin/nodes',{admin:true,method:'POST',
      data:{nodeId,organizationId,siteId,
        capabilities:caps?caps.split(','):[],
        receivesFrom:senders?senders.split(','):[]}})
  }
  if(action==='revoke'){
    args(1,values)
    return fabricRequest('/v1/admin/nodes/'+values[0]+'/revoke',
      {admin:true,method:'POST',data:{}})
  }
  if(action==='approve'){
    args(1,values)
    return fabricRequest('/v1/admin/tasks/'+values[0]+'/approve',
      {admin:true,method:'POST',data:{}})
  }
  if(action==='send'){
    args(6,values)
    const [targetNodeId,capability,idempotencyKey,purpose,refs,approval]=values
    if(!['true','false'].includes(approval))throw Error('approval debe ser true o false')
    return fabricRequest('/v1/tasks',{method:'POST',data:{
      targetNodeId,capability,idempotencyKey,purpose,
      references:refs?refs.split(','):[],requiresApproval:approval==='true'
    }})
  }
  if(action==='next'){
    args(0,values);return fabricRequest('/v1/tasks/next')
  }
  if(action==='task'){
    args(1,values);return fabricRequest('/v1/tasks/'+values[0])
  }
  if(action==='finish'){
    if(values.length<3||values.length>4)throw Error('finish requiere tarea, lease, resultado y referencia opcional')
    return fabricRequest('/v1/tasks/'+values[0]+'/finish',{method:'POST',
      data:{leaseToken:values[1],outcome:values[2],resultRef:values[3]??null}})
  }
  if(action==='heartbeat'){
    args(0,values)
    return fabricRequest('/v1/nodes/heartbeat',{method:'POST',data:{}})
  }
  throw Error('Uso: enroll|nodes|metrics|revoke|approve|send|next|task|finish|heartbeat')
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  runFabricCommand(process.argv.slice(2)).then(result=>{
    process.stdout.write(JSON.stringify(result,null,2)+'\n')
  }).catch(error=>{console.error('Fabric: '+error.message);process.exitCode=1})
}
