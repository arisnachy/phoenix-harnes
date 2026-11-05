/**
 * PHOENIX Fabric operational broker (Node 24+, built-in SQLite).
 * Demo tasks are reference-only. No clinical records, models, scanning or
 * installation is performed. Non-loopback binding REQUIRES mutual TLS.
 */
import { DatabaseSync } from 'node:sqlite'
import { createServer as httpServer } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { createHash,randomBytes,randomUUID,timingSafeEqual } from 'node:crypto'
import { readFileSync,mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME=/^[a-z][a-z0-9._-]{0,63}$/u
const LOOP=new Set(['127.0.0.1','::1'])
const hash=x=>createHash('sha256').update(x).digest('hex')
const token=()=>randomBytes(32).toString('hex')
const time=()=>new Date().toISOString()
const bad=(status,message)=>Object.assign(new Error(message),{status})
function ident(value,label){
  if(typeof value!=='string'||!NAME.test(value))throw bad(400,label+' inválido')
  return value
}
function string(value,label,max=256){
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f]/u.test(value))
    throw bad(400,label+' inválido')
  return value.trim()
}
function object(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw bad(400,'Objeto inválido')
  return value
}
function ids(value,label,max=256){
  if(!Array.isArray(value)||value.length>max)throw bad(400,label+' inválido')
  const result=value.map(v=>ident(v,label))
  if(new Set(result).size!==result.length)throw bad(400,label+' duplicado')
  return result
}
function auth(req){
  const match=/^Bearer ([a-f0-9]{64})$/iu.exec(req.headers.authorization||'')
  if(!match)throw bad(401,'Token requerido')
  return match[1].toLowerCase()
}
function sameSecret(left,right){
  const a=Buffer.from(hash(left),'hex'),b=Buffer.from(hash(right),'hex')
  return timingSafeEqual(a,b)
}
async function body(req){
  if(req.headers['content-type']?.split(';',1)[0]?.trim()!=='application/json')
    throw bad(415,'Se requiere application/json')
  let n=0;const parts=[]
  for await(const part of req){
    n+=part.length
    if(n>16384)throw bad(413,'Solicitud demasiado grande')
    parts.push(part)
  }
  try{return object(JSON.parse(Buffer.concat(parts).toString('utf8')))}
  catch(error){if(error.status)throw error;throw bad(400,'JSON inválido')}
}
function send(res,status,data){
  res.writeHead(status,{
    'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','x-frame-options':'DENY',
    'referrer-policy':'no-referrer'
  })
  res.end(JSON.stringify(data))
}
function view(row){
  return row&&{taskId:row.task_id,organizationId:row.org,sourceNodeId:row.source,
    targetNodeId:row.target,capability:row.capability,purpose:row.purpose,
    references:JSON.parse(row.refs),idempotencyKey:row.idempotency_key,
    requiresApproval:!!row.approval,state:row.state,attempts:row.attempts,
    resultRef:row.result_ref||null,createdAt:row.created_at,updatedAt:row.updated_at}
}
export function createFabricBroker({dbPath,adminToken,host='127.0.0.1',port=0,tls}){
  if(typeof adminToken!=='string'||adminToken.length<32)
    throw new Error('PHOENIX_FABRIC_ADMIN_TOKEN necesita 32 caracteres o más')
  if(typeof dbPath!=='string'||!dbPath)throw new Error('dbPath obligatorio')
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw new Error('Puerto inválido')
  if((!LOOP.has(host)||tls)&&(!tls?.key||!tls?.cert||!tls?.ca))
    throw new Error('La red LAN o externa requiere TLS mutuo con key, cert y CA')
  mkdirSync(dirname(dbPath),{recursive:true,mode:0o700})
  const db=new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;')
  db.exec([
    'CREATE TABLE IF NOT EXISTS nodes (node_id TEXT PRIMARY KEY,org TEXT NOT NULL,site TEXT NOT NULL,capabilities TEXT NOT NULL,receives_from TEXT NOT NULL,secret_hash TEXT UNIQUE NOT NULL,state TEXT NOT NULL,last_seen TEXT);',
    'CREATE TABLE IF NOT EXISTS tasks (task_id TEXT PRIMARY KEY,org TEXT NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,capability TEXT NOT NULL,purpose TEXT NOT NULL,refs TEXT NOT NULL,idem TEXT NOT NULL,approval INTEGER NOT NULL,state TEXT NOT NULL,result_ref TEXT,attempts INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until INTEGER,created_ms INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(source,idem));',
    'CREATE INDEX IF NOT EXISTS idx_tasks_queue ON tasks(target,state,created_ms);'
  ].join('\n'))
  const q={
    node:db.prepare('SELECT * FROM nodes WHERE node_id=?'),
    token:db.prepare("SELECT * FROM nodes WHERE secret_hash=? AND state='active'"),
    nodes:db.prepare('SELECT node_id,org,site,capabilities,receives_from,state,last_seen FROM nodes ORDER BY node_id'),
    addNode:db.prepare("INSERT INTO nodes(node_id,org,site,capabilities,receives_from,secret_hash,state) VALUES(?,?,?,?,?,?,'active')"),
    revoke:db.prepare("UPDATE nodes SET state='revoked' WHERE node_id=?"),
    heartbeat:db.prepare('UPDATE nodes SET last_seen=? WHERE node_id=?'),
    task:db.prepare('SELECT * FROM tasks WHERE task_id=?'),
    idem:db.prepare('SELECT * FROM tasks WHERE source=? AND idem=?'),
    addTask:db.prepare('INSERT INTO tasks(task_id,org,source,target,capability,purpose,refs,idem,approval,state,created_ms,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    approve:db.prepare("UPDATE tasks SET state='queued',updated_at=? WHERE task_id=? AND state='pending-approval'"),
    reclaim:db.prepare("UPDATE tasks SET state='queued',lease=NULL,lease_until=NULL,updated_at=? WHERE target=? AND state='leased' AND lease_until<=?"),
    next:db.prepare("SELECT * FROM tasks WHERE target=? AND state='queued' ORDER BY created_ms,task_id LIMIT 1"),
    lease:db.prepare("UPDATE tasks SET state='leased',lease=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE task_id=? AND state='queued'"),
    finish:db.prepare("UPDATE tasks SET state=?,result_ref=?,lease=NULL,lease_until=NULL,updated_at=? WHERE task_id=? AND state='leased' AND lease=?"),
    metrics:db.prepare('SELECT state,COUNT(*) AS count FROM tasks GROUP BY state')
  }
  const principal=req=>{
    const row=q.token.get(hash(auth(req)))
    if(!row)throw bad(401,'Credencial no válida')
    return row
  }
  const administrator=req=>{
    if(!sameSecret(auth(req),adminToken))throw bad(403,'Administración no autorizada')
  }
  const atomic=fn=>{
    db.exec('BEGIN IMMEDIATE')
    try{const result=fn();db.exec('COMMIT');return result}
    catch(e){db.exec('ROLLBACK');throw e}
  }
  async function route(req,res){
    const p=new URL(req.url||'/', 'http://fabric.invalid').pathname
    if(p==='/healthz'&&req.method==='GET')
      return send(res,200,{ok:true,service:'phoenix-fabric',storage:'sqlite'})
    if(p==='/v1/admin/nodes'&&req.method==='POST'){
      administrator(req);const x=await body(req)
      const nodeId=ident(x.nodeId,'Nodo'),org=ident(x.organizationId,'Organización')
      const site=ident(x.siteId,'Sede'),caps=ids(x.capabilities,'Capacidades')
      const receives=ids(x.receivesFrom,'Emisores')
      if(q.node.get(nodeId))throw bad(409,'Nodo ya registrado')
      const secret=token()
      q.addNode.run(nodeId,org,site,JSON.stringify(caps),JSON.stringify(receives),hash(secret))
      return send(res,201,{nodeId,token:secret,connectionState:'registered'})
    }
    if(p==='/v1/admin/nodes'&&req.method==='GET'){
      administrator(req)
      return send(res,200,{nodes:q.nodes.all().map(row=>({...row,
        capabilities:JSON.parse(row.capabilities),
        receives_from:JSON.parse(row.receives_from)}))})
    }
    const revoke=/^\/v1\/admin\/nodes\/([a-z][a-z0-9._-]{0,63})\/revoke$/u.exec(p)
    if(revoke&&req.method==='POST'){
      administrator(req)
      if(!q.node.get(revoke[1]))throw bad(404,'Nodo inexistente')
      q.revoke.run(revoke[1]);return send(res,200,{nodeId:revoke[1],state:'revoked'})
    }
    const approve=/^\/v1\/admin\/tasks\/([0-9a-f-]{36})\/approve$/u.exec(p)
    if(approve&&req.method==='POST'){
      administrator(req)
      const item=q.task.get(approve[1])
      if(!item||item.state!=='pending-approval')throw bad(409,'Tarea no pendiente de aprobación')
      q.approve.run(time(),approve[1])
      return send(res,200,{task:view(q.task.get(approve[1])),
        warning:'Esta aprobación técnica no es una firma clínica'})
    }
    if(p==='/v1/tasks'&&req.method==='POST'){
      const sender=principal(req),x=await body(req)
      const target=ident(x.targetNodeId,'Destino'),cap=ident(x.capability,'Capacidad')
      const idem=ident(x.idempotencyKey,'Idempotencia')
      const refs=JSON.stringify(ids(x.references||[],'Referencias',32))
      const purpose=string(x.purpose,'Propósito')
      if(typeof x.requiresApproval!=='boolean')throw bad(400,'Requiere política explícita')
      if(['payload','patient','patients','medicalRecord','credentials','secret','record']
        .some(k=>Object.hasOwn(x,k)))throw bad(400,'Solo referencias, no registros sensibles')
      const node=q.node.get(target)
      if(!node||node.state!=='active'||node.org!==sender.org||
        !JSON.parse(node.capabilities).includes(cap)||
        !JSON.parse(node.receives_from).includes(sender.node_id))
        throw bad(403,'Destino o capacidad no autorizados')
      const prior=q.idem.get(sender.node_id,idem)
      if(prior){
        if(prior.target!==target||prior.capability!==cap||
          prior.refs!==refs||prior.purpose!==purpose||
          !!prior.approval!==x.requiresApproval)
          throw bad(409,'Clave reutilizada con otra tarea')
        return send(res,200,{task:view(prior),replayed:true})
      }
      const taskId=randomUUID(),at=time()
      try{q.addTask.run(taskId,sender.org,sender.node_id,target,cap,purpose,
        refs,idem,x.requiresApproval?1:0,
        x.requiresApproval?'pending-approval':'queued',Date.now(),at,at)}
      catch(e){if(String(e).includes('UNIQUE'))throw bad(409,'Colisión de idempotencia');throw e}
      return send(res,201,{task:view(q.task.get(taskId)),replayed:false})
    }
    if(p==='/v1/tasks/next'&&req.method==='GET'){
      const actor=principal(req)
      const assignment=atomic(()=>{
        const at=time()
        q.reclaim.run(at,actor.node_id,Date.now())
        const item=q.next.get(actor.node_id)
        if(!item)return null
        const lease=token()
        q.lease.run(lease,Date.now()+30000,at,item.task_id)
        return {task:view(q.task.get(item.task_id)),leaseToken:lease,leaseMs:30000}
      })
      return send(res,200,{assignment})
    }
    const finish=/^\/v1\/tasks\/([0-9a-f-]{36})\/finish$/u.exec(p)
    if(finish&&req.method==='POST'){
      const actor=principal(req),x=await body(req),item=q.task.get(finish[1])
      if(!item||item.org!==actor.org||item.target!==actor.node_id)
        throw bad(404,'Tarea no encontrada')
      if(!['completed','failed'].includes(x.outcome))throw bad(400,'Resultado inválido')
      if(typeof x.leaseToken!=='string'||!/^[a-f0-9]{64}$/iu.test(x.leaseToken))
        throw bad(400,'Lease inválida')
      const ref=x.resultRef==null?null:ident(x.resultRef,'Resultado')
      if(item.state!=='leased'||item.lease!==x.leaseToken||item.lease_until<=Date.now())
        throw bad(409,'Lease vencida o inválida')
      q.finish.run(x.outcome,ref,time(),item.task_id,x.leaseToken)
      return send(res,200,{task:view(q.task.get(item.task_id))})
    }
    const task=/^\/v1\/tasks\/([0-9a-f-]{36})$/u.exec(p)
    if(task&&req.method==='GET'){
      const actor=principal(req),item=q.task.get(task[1])
      if(!item||item.org!==actor.org||
        (item.source!==actor.node_id&&item.target!==actor.node_id))
        throw bad(404,'Tarea no encontrada')
      return send(res,200,{task:view(item)})
    }
    if(p==='/v1/nodes/heartbeat'&&req.method==='POST'){
      const actor=principal(req);q.heartbeat.run(time(),actor.node_id)
      return send(res,200,{nodeId:actor.node_id,heartbeat:time(),ok:true})
    }
    if(p==='/v1/admin/metrics'&&req.method==='GET'){
      administrator(req);return send(res,200,{states:q.metrics.all(),at:time()})
    }
    throw bad(404,'Ruta no encontrada')
  }
  const handler=(req,res)=>{void route(req,res).catch(e=>{
    if(!res.headersSent)send(res,e.status||500,{error:e.status?e.message:'Error interno'})
    else res.end()
  })}
  const server=tls?httpsServer({
    key:Buffer.isBuffer(tls.key)?tls.key:readFileSync(tls.key),
    cert:Buffer.isBuffer(tls.cert)?tls.cert:readFileSync(tls.cert),
    ca:Buffer.isBuffer(tls.ca)?tls.ca:readFileSync(tls.ca),
    requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.2'
  },handler):httpServer(handler)
  return {
    start:()=>new Promise((resolve,reject)=>{
      server.once('error',reject)
      server.listen(port,host,()=>{
        server.off('error',reject)
        const addr=server.address()
        resolve({url:(tls?'https':'http')+'://'+
          (host.includes(':')?'['+host+']':host)+':'+addr.port,
          host,port:addr.port,mutualTls:!!tls})
      })
    }),
    close:()=>new Promise((resolve,reject)=>{
      server.close(e=>{
        try{db.close()}catch(error){e=e||error}
        if(e)reject(e);else resolve()
      })
    })
  }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const host=process.env.PHOENIX_FABRIC_HOST||'127.0.0.1'
  const port=Number(process.env.PHOENIX_FABRIC_PORT||'8765')
  const dbPath=process.env.PHOENIX_FABRIC_DB||'./.phoenix/fabric.sqlite'
  const adminToken=process.env.PHOENIX_FABRIC_ADMIN_TOKEN
  const tls=process.env.PHOENIX_FABRIC_TLS_KEY?{
    key:process.env.PHOENIX_FABRIC_TLS_KEY,
    cert:process.env.PHOENIX_FABRIC_TLS_CERT,
    ca:process.env.PHOENIX_FABRIC_TLS_CA
  }:undefined
  const broker=createFabricBroker({host,port,dbPath,adminToken,tls})
  broker.start().then(v=>console.log('PHOENIX Fabric broker: '+v.url+
    ' | mTLS: '+v.mutualTls)).catch(e=>{console.error(e.message);process.exitCode=1})
  const shutdown=()=>{broker.close().then(()=>process.exit(0)).catch(()=>process.exit(1))}
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown)
}
