import { genesisDatabasePath } from './phoenix-genesis-paths.mjs'
/**
 * Genesis Console: authenticated, loopback-only web UI and API.
 * This is an institutional planning surface, not a clinical system or
 * a network scanner. It NEVER binds a public address.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { createHash,timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { GenesisWorkbench } from './phoenix-genesis-workbench.mjs'
import { genesisCatalogSummary,searchGenesisCatalog } from './phoenix-genesis-healthcare-catalog.mjs'
import { importGenesisManifest } from './phoenix-genesis-importer.mjs'
import { previewGenesisDocument,inspectGenesisDocument,listGenesisDocumentFindings,decideGenesisFinding } from './phoenix-genesis-document-intake.mjs'
import { previewGenesisLegacyCsv, importGenesisLegacyCsv } from './phoenix-genesis-legacy-csv.mjs'
import { fabricRequest } from './phoenix-fabric-client.mjs'

const authDigest=secret=>createHash('sha256').update(secret).digest()
const valid=secret=>typeof secret==='string'&&secret.length>=32&&secret.length<=1024
const css=readFileSync(new URL('./phoenix-genesis-console.css',import.meta.url),'utf8')
const js=readFileSync(new URL('./phoenix-genesis-console-ui.js',import.meta.url),'utf8')
const html=readFileSync(new URL('./phoenix-genesis-console.html',import.meta.url),'utf8')
const safePath=new Set(['/','/app.js','/style.css','/healthz'])
const send=(res,status,value,contentType='application/json; charset=utf-8')=>{
  res.writeHead(status,{
    'content-type':contentType,
    'cache-control':'no-store','x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer','x-frame-options':'DENY',
    'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
  })
  res.end(typeof value==='string'?value:JSON.stringify(value))
}
const problem=(res,status,message)=>send(res,status,{error:message})
async function json(req){
  if(req.headers['content-type']?.split(';',1)[0]?.trim()!=='application/json')
    throw Object.assign(Error('Se requiere JSON'),{status:415})
  let bytes=0;const chunks=[]
  for await(const c of req){bytes+=c.length
    if(bytes>65536)throw Object.assign(Error('Solicitud demasiado grande'),{status:413})
    chunks.push(c)
  }
  try{const v=JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if(!v||typeof v!=='object'||Array.isArray(v))throw Error()
    return v
  }catch{throw Object.assign(Error('JSON inválido'),{status:400})}
}
export function createGenesisConsole({dbPath,adminToken,port=0,host='127.0.0.1'}){
  if(host!=='127.0.0.1'&&host!=='::1')throw Error('Genesis Console solo funciona en loopback')
  if(!valid(adminToken))throw Error('Clave Genesis obligatoria, mínimo 32 caracteres')
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw Error('Puerto inválido')
  const workbench=new GenesisWorkbench(dbPath)
  let server
  const handler=async(req,res)=>{
    try{
      if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))
        return problem(res,403,'Solo acceso local')
      const expectedHost=(host==='::1'?'[::1]':host)+':'+server.address().port
      if(req.headers.host!==expectedHost)return problem(res,403,'Host no autorizado')
      const target=new URL(req.url??'/', 'http://genesis.invalid')
      const path=target.pathname
      if(safePath.has(path)&&req.method==='GET'){
        if(path==='/')return send(res,200,html,'text/html; charset=utf-8')
        if(path==='/app.js')return send(res,200,js,'text/javascript; charset=utf-8')
        if(path==='/style.css')return send(res,200,css,'text/css; charset=utf-8')
        return send(res,200,{ok:true,service:'genesis-console'})
      }
      // Require a fresh per-session bearer token, never store in cookies.
      const bearer=/^Bearer ([^\s]+)$/u.exec(req.headers.authorization??'')
      if(!bearer||!valid(bearer[1])||
        !timingSafeEqual(authDigest(bearer[1]),authDigest(adminToken)))
        return problem(res,401,'Clave de administración incorrecta')
      if(req.method==='POST'&&req.headers.origin){
        const hostHeader=req.headers.host||''
        if(req.headers.origin!=='http://'+hostHeader)
          return problem(res,403,'Origen no autorizado')
      }
      if(path==='/v1/fabric/status'&&req.method==='GET'){
        const org=target.searchParams.get('organizationId')
        workbench.dashboard(org)
        if(!process.env.PHOENIX_FABRIC_ADMIN_TOKEN)
          return send(res,200,{configured:false,connected:false,
            nodes:[],reason:'Se necesita configurar el token administrativo Fabric'})
        try{
          const response=await fabricRequest('/v1/admin/nodes',{admin:true})
          const active=Date.now()
          const nodes=(response.nodes??[]).filter(n=>n.org===org).map(n=>({
            nodeId:n.node_id,siteId:n.site,state:n.state,
            lastSeen:n.last_seen??null,
            connected:n.last_seen!==null&&active-Date.parse(n.last_seen)<60000,
            capabilities:n.capabilities
          }))
          return send(res,200,{configured:true,connected:true,
            brokerReachable:true,nodes,connectionSource:'verified-fabric-api',
            caveat:'Nodos sin heartbeat reciente no se declaran conectados'})
        }catch{
          return send(res,200,{configured:true,connected:false,nodes:[],
            reason:'El broker Fabric no responde o las credenciales no están autorizadas'})
        }
      }
      if(path==='/v1/fabric/enroll'&&req.method==='POST'){
        const input=await json(req)
        if(input.approved!==true)throw Error('El administrador debe confirmar el enrolamiento')
        const org=input.organizationId
        const state=workbench.dashboard(org)
        if(!state.sites.some(s=>s.siteId===input.siteId))
          throw Error('Sede inexistente')
        if(!state.units.some(u=>u.unitId===input.unitId&&u.siteId===input.siteId))
          throw Error('Unidad no registrada en Genesis')
        if(!Array.isArray(input.capabilities)||!Array.isArray(input.receivesFrom))
          throw Error('Capacidades y emisores requeridos')
        const result=await fabricRequest('/v1/admin/nodes',{admin:true,
          method:'POST',data:{
            nodeId:input.nodeId,organizationId:org,siteId:input.siteId,
            capabilities:input.capabilities,receivesFrom:input.receivesFrom
          }})
        return send(res,201,{
          ...result,oneTimeToken:true,
          warning:'Guarde el token en un gestor de secretos; esta operación NO instala el nodo.'
        })
      }
      if(path==='/v1/catalog/summary'&&req.method==='GET'){
        const org=workbench.dashboard(target.searchParams.get('organizationId'))
        return send(res,200,genesisCatalogSummary(org.organization.industry))
      }
      if(path==='/v1/catalog'&&req.method==='GET'){
        const org=workbench.dashboard(target.searchParams.get('organizationId'))
        const limit=Number(target.searchParams.get('limit')??40)
        const offset=Number(target.searchParams.get('offset')??0)
        return send(res,200,searchGenesisCatalog({
          industry:org.organization.industry,
          category:target.searchParams.get('category'),
          query:target.searchParams.get('query')??'',limit,offset
        }))
      }
      if(path==='/v1/organizations'&&req.method==='GET')
        return send(res,200,{organizations:workbench.organizations()})
      if(path==='/v1/organizations'&&req.method==='POST')
        return send(res,201,{result:workbench.createOrganization(await json(req))})
      const organizationId=target.searchParams.get('organizationId')
      if(path==='/v1/dashboard'&&req.method==='GET')
        return send(res,200,workbench.dashboard(organizationId))
      if(path==='/v1/recommendations'&&req.method==='GET')
        return send(res,200,workbench.recommendations(organizationId,target.searchParams.get('siteId')))
      if(path==='/v1/deployment'&&req.method==='GET')
        return send(res,200,workbench.deployment(organizationId))
      if(path==='/v1/poa'&&req.method==='GET')
        return send(res,200,workbench.poa({
          organizationId,period:target.searchParams.get('period')}))
      if(path==='/v1/legacy-csv/preview'&&req.method==='POST'){
        const input=await json(req)
        return send(res,200,{result:previewGenesisLegacyCsv(workbench,input)})
      }
      if(path==='/v1/legacy-csv/import'&&req.method==='POST'){
        const input=await json(req)
        return send(res,201,{result:importGenesisLegacyCsv(workbench,input)})
      }
      if(path==='/v1/documents/preview'&&req.method==='POST')
        return send(res,200,{result:previewGenesisDocument(workbench,await json(req))})
      if(path==='/v1/documents/inspect'&&req.method==='POST')
        return send(res,201,{result:inspectGenesisDocument(workbench,await json(req))})
      if(path==='/v1/documents/findings'&&req.method==='GET')
        return send(res,200,listGenesisDocumentFindings(workbench,
          target.searchParams.get('organizationId'),target.searchParams.get('documentId')))
      if(path==='/v1/documents/decide'&&req.method==='POST')
        return send(res,200,{result:decideGenesisFinding(workbench,await json(req))})
      const operations={
        '/v1/sites':x=>workbench.addSite(x),
        '/v1/answers':x=>workbench.answer(x),
        '/v1/units':x=>workbench.unit(x),
        '/v1/systems':x=>workbench.system(x),
        '/v1/costs':x=>workbench.cost(x),
        '/v1/goals':x=>workbench.goal(x),
        '/v1/obligations':x=>workbench.obligation(x),
        '/v1/evidence':x=>workbench.registry.registerEvidence(x),
        '/v1/import':x=>importGenesisManifest(workbench,x),
        '/v1/providers':x=>workbench.provider(x),
        '/v1/indicators':x=>workbench.registry.recordIndicator(x)
      }
      if(req.method==='POST'&&operations[path])
        return send(res,201,{result:operations[path](await json(req))})
      return problem(res,404,'Ruta inexistente')
    }catch(error){
      const status=Number.isInteger(error.status)?error.status:
        /inexistente|desconocido|no encontrada/iu.test(error.message)?404:
        /duplicad|ya registrada|CONSTRAINT/iu.test(error.message)?409:400
      return problem(res,status,status===400?String(error.message).slice(0,260):
        status===404?'Recurso no encontrado':status===409?'Conflicto de registro':'Error')
    }
  }
  server=createServer((req,res)=>{void handler(req,res)})
  return {
    start:()=>new Promise((resolve,reject)=>{
      server.once('error',reject)
      server.listen(port,host,()=>{
        server.off('error',reject)
        const address=server.address()
        resolve({url:'http://'+(host==='::1'?'[::1]':host)+':'+address.port})
      })
    }),
    close:()=>new Promise((resolve,reject)=>server.close(error=>{
      try{workbench.close()}catch(e){error=error??e}
      if(error)reject(error);else resolve()
    }))
  }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const secret=process.env.PHOENIX_GENESIS_ADMIN_TOKEN
  if(!secret)throw Error('Configure PHOENIX_GENESIS_ADMIN_TOKEN (32 caracteres mínimo)')
  const dbPath=genesisDatabasePath()
  const port=Number(process.env.PHOENIX_GENESIS_PORT||8767)
  const app=createGenesisConsole({dbPath,adminToken:secret,port})
  app.start().then(a=>console.log('PHOENIX Genesis Console: '+a.url))
    .catch(e=>{console.error(e.message);process.exitCode=1})
  const stop=()=>app.close().then(()=>process.exit(0)).catch(()=>process.exit(1))
  process.once('SIGINT',stop);process.once('SIGTERM',stop)
}
