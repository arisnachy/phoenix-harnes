#!/usr/bin/env node
/** Phoenix Business Mission: intent, product recipe and live MCP capability routing.
 * Planning only: never invokes MCP tools, browser, purchases, publishing or payments.
 */
import { readFile, lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RECIPES } from './phoenix-business-factory.mjs'

const NORMALIZE = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const issue = message => { throw new Error(message) }
const test = (p,s) => p.test(s)
const CATEGORIES = Object.freeze([
  {type:'book',p:/\b(novela|saga|libro|ebook|manuscrito|kindle|fiction|novel|book|audiolibro impreso)\b/g},
  {type:'course',p:/\b(curso|lecciones|clases|formacion|academia|course|training|certificacion|modulos educativos)\b/g},
  {type:'software',p:/\b(app|aplicacion|saas|software|programa|extension|crm|erp|sistema de inventario|api|website|web app|sitio web)\b/g},
  {type:'game',p:/\b(juego|videojuego|game|gaming|godot|unity|steam|itch\.io|plataformas 2d|sprites)\b/g},
  {type:'design',p:/\b(diseno|disenos|plantilla|plantillas|ilustracion|invitacion|mockup|logo|poster|etsy|svg|figma|canva)\b/g},
  {type:'research',p:/\b(investigacion|informe|estudio de mercado|articulo cientifico|dashboard|analisis estadistico|research|report|market study|apa|vancouver)\b/g},
  {type:'video',p:/\b(video|videos|animacion|video corto|reels|youtube|shorts|pelicula|film|video course)\b/g},
  {type:'audio',p:/\b(audio|podcast|musica|cancion|voz en off|voiceover|audiolibro|narracion|music)\b/g},
  {type:'service',p:/\b(servicio|consultoria|asesoria|auditoria|freelance|paquete de servicios|contrato de servicio|consulting|service offering)\b/g},
])
const ACTIONS = Object.freeze([
  {name:'opportunity',p:/\b(investiga|investigar|investigue|investigacion de mercado|investiga oportunidades|encontra?r? (?:un )?nicho|que puedo vender|que negocio|tendencias|demanda|competencia|rentable|oportunidad|nichos|market research|what (?:can|should) i sell|ideas para vender)\b/g},
  {name:'create',p:/\b(crea|crear|construye|construir|desarrolla|desarrollar|escribe|escribir|produce|producir|genera|generar|disena|hacer|haz|build|write|design|make|develop|create)\b/g},
  {name:'validate',p:/\b(valida|validar|revisa|revisar|verifica|verificar|audita|auditar|comprueba|test|quality|calidad|licencias|derechos)\b/g},
  {name:'package',p:/\b(empaqueta|empaquetar|exporta|exportar|prepara (?:el |la )?(?:epub|pdf|docx|zip|instalador)|release|build release|package)\b/g},
  {name:'publish',p:/\b(publica|publicar|publicalo|publicala|publique|sube a la tienda|subelo a|listalo|ponlo a la venta|lanzalo|launch|publish|submit to store|upload to kdp)\b/g},
  {name:'market',p:/\b(promociona|promocionar|publicidad|campana|anuncios|marketing|seo|promote|advertise|redes sociales)\b/g},
  {name:'analytics',p:/\b(ventas|regalias|ingresos|pedidos|beneficio|conversion|metricas|cuanto vendimos|sales|royalties|revenue|orders|analytics)\b/g},
])
const PLATFORMS = Object.freeze([
  {id:'amazon-kdp',p:/\b(amazon|kdp|kindle direct publishing)\b/,test:/\b(kdp|amazon|kindle)\b/i},
  {id:'etsy',p:/\betsy\b/,test:/etsy/i},
  {id:'shopify',p:/\bshopify\b/,test:/shopify/i},
  {id:'woocommerce',p:/\b(woocommerce|wordpress|woo commerce)\b/,test:/\b(woocommerce|wordpress|woo)\b/i},
  {id:'gumroad',p:/\bgumroad\b/,test:/gumroad/i},
  {id:'itch',p:/\b(itch\.io|itch io|itch|gamejolt)\b/,test:/\b(itch|gamejolt)\b/i},
  {id:'direct',p:/\b(tienda propia|mi sitio|venta directa|sitio propio|own store|direct sales)\b/,test:/\b(vercel|shopify|stripe|woocommerce)\b/i},
])
const CONNECTORS = Object.freeze({
  opportunity:[{match:/\b(brave|search|fetch|web|google)\b/i,need:'investigación'}],
  book:[{match:/\b(google|drive|filesystem|canva)\b/i,need:'creación y almacenamiento'}],
  course:[{match:/\b(google|drive|canva|heygen|filesystem)\b/i,need:'contenido educativo'}],
  software:[{match:/\b(github|supabase|vercel|figma)\b/i,need:'desarrollo y despliegue'}],
  game:[{match:/\b(github|filesystem|figma|canva)\b/i,need:'proyecto y recursos'}],
  design:[{match:/\b(figma|canva|filesystem)\b/i,need:'diseño'}],
  research:[{match:/\b(brave|fetch|google|filesystem)\b/i,need:'fuentes y documentos'}],
  video:[{match:/\b(heygen|canva|filesystem)\b/i,need:'video'}],
  audio:[{match:/\b(heygen|filesystem)\b/i,need:'audio'}],
  service:[{match:/\b(google|notion|linear|filesystem)\b/i,need:'servicios y entrega'}],
})
const CURATED = Object.freeze({
  opportunity:['brave-search','fetch'],book:['filesystem','canva'],course:['filesystem','canva','heygen'],
  software:['github','supabase','vercel'],game:['github','filesystem'],design:['canva','figma'],
  research:['brave-search','fetch','filesystem'],video:['heygen','canva'],audio:['heygen'],service:['notion','filesystem'],
})
const WRITING = /(?:^|_)(?:create|add|update|upload|submit|publish|post|deploy|release|start|edit|delete|modify|insert|listings?)(?:_|$)/i
const READING = /(?:^|_)(?:get|search|read|list|fetch|inspect|find|query|status|preview|lookup|describe)(?:_|$)/i
const UNKNOWN_OPERATIONS = /(?:purchase|pay|charge|checkout|bank|bet|wager|transfer|withdraw|refund)/i
const MAX_INVENTORY = 200
const TOOL_NAME = /^mcp__[a-z0-9_-]{1,64}__[a-z0-9_-]{1,100}$/i
function score(text,items) {
  return items.map(item=>{const matches=[...text.matchAll(item.p)];return {name:item.name??item.type,score:matches.length,evidence:matches.slice(0,4).map(m=>m[0])}}).filter(x=>x.score).sort((a,b)=>b.score-a.score)
}
/** Literal, explainable routing; uncertain requests are a handoff for Kira, not a guess. */
export function understandBusinessIntent(request) {
  if(typeof request!=='string'||request.length<2||request.length>8000||/[\x00-\x08\x0B\x0E-\x1F]/.test(request)) issue('Petición inválida (2–8000 caracteres, sin controles).')
  const s=NORMALIZE(request)
  const categories=score(s,CATEGORIES)
  const actions=score(s,ACTIONS)
  const explicitPlatforms=PLATFORMS.filter(p=>test(p.p,s)).map(p=>p.id)
  const unsupportedConflicts=explicitPlatforms.length>1 || (categories.length>1 && categories[0].score===categories[1].score)
  let type=categories[0]?.name??null
  if(categories.length>1 && unsupportedConflicts) type=null
  if(/\baudiolibro\b/.test(s) && !/\b(audio|podcast|musica|cancion|narracion)\b/.test(s.replace(/audiolibro/g,'')))type='book'
  const informational=/\b(como|explica|explicame|que significa|puedes decirme|how to|what is|tutorial)\b/.test(s) && /[?¿]|\bcomo\b/.test(s)
  const prohibited={publish:/\b(no publiques|no lo publiques|no la publiques|sin publicar|no publicar|dont publish|do not publish)\b/.test(s),spend:/\b(sin gastar|no gastes|gratis|sin publicidad pagada|no pagues|do not spend)\b/.test(s)}
  const ordered=actions.map(x=>x.name)
  const dedup=[...new Set(ordered)]
  if(informational) {
    const index=dedup.indexOf('publish')
    if(index>=0)dedup.splice(index,1)
    if(!dedup.includes('opportunity')) dedup.unshift('opportunity')
  }
  if(prohibited.publish) {const index=dedup.indexOf('publish');if(index>=0)dedup.splice(index,1)}
  if(!dedup.length)dedup.push(type?'create':'opportunity')
  if(dedup.includes('publish') && !dedup.includes('validate')) dedup.splice(dedup.indexOf('publish'),0,'validate')
  const requiresClarification=(unsupportedConflicts && !(/\baudiolibro\b/.test(s) && type==='book')) || (type===null && !dedup.includes('opportunity'))
  const nextAction=dedup.includes('opportunity')?'research':dedup.includes('create')?'create':dedup.includes('validate')?'validate':dedup[0]
  return {productType:type,categoryCandidates:categories,actions:dedup,platforms:explicitPlatforms,informationalOnly:informational,prohibited,needsPlanning:requiresClarification,needsHumanApproval:dedup.includes('publish')||dedup.includes('market'),nextAction,confidence:requiresClarification?'low':!categories.length?'medium':'high'}
}
function sanitizeInventory(snapshot) {
  const rows=Array.isArray(snapshot)?snapshot:Array.isArray(snapshot?.runtime)?snapshot.runtime:[]
  if(rows.length>MAX_INVENTORY) issue('Inventario MCP demasiado grande.')
  return rows.flatMap((entry)=>{
    if(!entry || typeof entry.serverName!=='string'||entry.serverName.length>64 || !/^[a-z0-9_-]+$/i.test(entry.serverName))return []
    if(!['ready','starting','auth-required','disconnected','failed'].includes(entry.status))return []
    if(!Array.isArray(entry.toolNames)||entry.toolNames.length>400)return []
    const names=entry.toolNames.filter(x=>typeof x==='string'&&TOOL_NAME.test(x)&&x.toLowerCase().startsWith('mcp__'+entry.serverName.toLowerCase()+'__'))
    return [{name:entry.serverName,status:entry.status,tools:[...new Set(names)].slice(0,200)}]
  })
}
function usefulTool(tool) {return !UNKNOWN_OPERATIONS.test(tool)}
function capabilityFor(name,platform,type) {
  const commerce=platform && PLATFORMS.find(p=>p.id===platform)?.test.test(name)
  const production=(CONNECTORS[type]||[]).some(c=>c.match.test(name))
  const marketSearch=!type && CONNECTORS.opportunity.some(c=>c.match.test(name))
  return {commerce:!!commerce,production,marketSearch}
}
/** Name-level candidates; operation schemas, identity, permission, and execution MUST be checked separately. */
export function selectBusinessConnectors(intent, snapshot) {
  const rows=sanitizeInventory(snapshot)
  const platforms=intent.platforms.length?intent.platforms:(intent.productType && RECIPES[intent.productType]?.markets||[])
  const needed=new Set(intent.productType?CURATED[intent.productType]||[]:CURATED.opportunity)
  const results=[]
  for(const entry of rows){
    let matched=false
    const candidates=[]
    for(const tool of entry.tools){
      if(!usefulTool(tool))continue
      const caps=platforms.map(p=>({platform:p,...capabilityFor(entry.name+' '+tool,p,intent.productType)}))
      const commerce=caps.some(c=>c.commerce)
      const production=caps.some(c=>c.production||c.marketSearch)
      if(!commerce&&!production)continue
      matched=true
      const action=tool.split('__').at(-1)
      const write=WRITING.test(action)&&!READING.test(action)
      const requestWrite=intent.actions.some(x=>['publish','market'].includes(x))
      if(requestWrite && commerce && !write)continue
      candidates.push({name:tool,capability:commerce?(write?'commercial-write-candidate':'commercial-read-candidate'):'production-candidate',schemaVerified:false,authorizationVerified:false})
    }
    if(matched){results.push({server:entry.name,status:entry.status,tools:entry.status==='ready'?candidates:[],usableCandidate:entry.status==='ready'&&candidates.length>0})}
  }
  results.sort((a,b)=>Number(b.usableCandidate)-Number(a.usableCandidate)||a.server.localeCompare(b.server))
  const readyWrite=results.some(r=>r.usableCandidate&&r.tools.some(x=>x.capability==='commercial-write-candidate'))
  const wantsPublication=intent.actions.includes('publish')
  const selectedPlatform=intent.platforms.length===1?intent.platforms[0]:null
  return {connectors:results,curatedToOffer:[...needed],readyToolCandidates:results.filter(r=>r.usableCandidate).map(r=>r.server),publicationRoute:!wantsPublication?'not-requested':!selectedPlatform?'choose-platform':readyWrite?'mcp-candidate':'minibrowser-candidate',allToolSchemasVerified:false,loginVerified:false,externalActionsExecuted:false}
}
/** Mission contract for Kira/UME. This does NOT start a run or install connectors. */
export function planBusinessMission(request,{inventory=null}={}) {
  const intent=understandBusinessIntent(request)
  const routing=selectBusinessConnectors(intent,inventory)
  const recipe=intent.productType?RECIPES[intent.productType]:undefined
  const checks=recipe?recipe.groups:[]
  const work=[]
  if(intent.needsPlanning)work.push({step:'resolve-intent',role:'Kira',status:'needs-interpretation'})
  if(intent.actions.includes('opportunity')||!recipe)work.push({step:'research-market',role:'Kira',status:'pending'})
  if(intent.actions.includes('create'))work.push({step:'produce-complete-artifacts',role:'specialist',status:'pending',required:checks})
  work.push({step:'audit-integrity-rights-quality',role:'Lumen',status:'pending'})
  if(intent.actions.includes('package')||intent.actions.includes('publish'))work.push({step:'build-verified-release',role:'Kira',status:'pending'})
  if(intent.actions.includes('publish'))work.push({step:'publish-with-approval',role:'Kira',status:'blocked-until-approved-and-connected',route:routing.publicationRoute})
  if(intent.actions.includes('market'))work.push({step:'prepare-marketing',role:'Kira',status:'requires-approval-for-spend'})
  if(intent.actions.includes('analytics'))work.push({step:'reconcile-real-revenue',role:'Kira',status:'requires-platform-data'})
  const blockers=[]
  if(intent.needsPlanning)blockers.push('Intención o categoría ambigua: Kira debe resolverla antes de ejecutar.')
  if(intent.actions.includes('publish')&&!intent.platforms.length)blockers.push('Elegir plataforma y revisar condiciones antes de publicar.')
  if(intent.actions.includes('publish')&&routing.publicationRoute==='minibrowser-candidate')blockers.push('No hay MCP de publicación comprobado: verificar navegador y sesión autorizada.')
  if(intent.actions.includes('publish'))blockers.push('Requiere aprobación explícita y comprobante real de publicación.')
  const doNotSpendWithoutApproval=intent.actions.includes('market')
  return {schemaVersion:1,intent,recipe:recipe?{type:intent.productType,label:recipe.label,markets:[...recipe.markets],requirements:checks,manualReviews:[...recipe.reviews]}:null,routing,work,blockers,approval:{publish:intent.actions.includes('publish'),spend:doNotSpendWithoutApproval,collectPayment:false},state:'planned',automaticallyPublished:false,actualRevenueVerified:false}
}
async function safeReadJson(path){
  if(typeof path!=='string'||path.length>2048)issue('Ruta de inventario inválida.')
  const file=resolve(path),meta=await lstat(file)
  if(!meta.isFile()||meta.isSymbolicLink()||meta.size>512*1024)issue('El inventario debe ser un archivo JSON local regular de hasta 512 KiB.')
  return JSON.parse(await readFile(file,'utf8'))
}
export async function cli(args){
  const [cmd,...rest]=args
  if(!cmd||cmd==='help')return {commands:['plan --request "Crea un curso de Python" [--inventory ruta-inventario.json]','intent --request "..."']}
  if(!['plan','intent'].includes(cmd))issue('Comando desconocido.')
  const arg=(name)=>{const i=rest.indexOf(name);return i>=0?rest[i+1]:undefined}
  const request=arg('--request');if(!request)issue('Debe proporcionar --request.')
  if(cmd==='intent')return understandBusinessIntent(request)
  const inventoryPath=arg('--inventory')
  const inventory=inventoryPath?await safeReadJson(inventoryPath):null
  return planBusinessMission(request,{inventory})
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  cli(process.argv.slice(2)).then(result=>console.log(JSON.stringify({ok:true,result},null,2)))
    .catch(error=>{console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1})
}
