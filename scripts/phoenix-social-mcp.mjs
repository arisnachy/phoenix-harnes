#!/usr/bin/env node
/** MCP front end for Phoenix Social Engine. Account creation and approvals
 * require a human; no tool here can manufacture or grant an approval.
 */
import { createInterface } from 'node:readline'
import { run } from './phoenix-social.mjs'

const fields=(props,required=[])=>({type:'object',properties:props,required,additionalProperties:false})
const string={type:'string',minLength:1,maxLength:6000}
const tool=(name,description,inputSchema,readOnly=true)=>({name,description,inputSchema,
  annotations:{readOnlyHint:readOnly,destructiveHint:name==='social_publish_approved'}})
const TOOLS=[
  tool('social_init','Crea identidad declarada Phoenix IA sin registrar una cuenta externa.',fields({})),
  tool('social_phoenix_onboarding','Inicia el proceso de perfiles PROPIOS de Phoenix IA y Kira: crea la identidad local de marca y devuelve los registros oficiales X, Instagram, Facebook, YouTube, TikTok y LinkedIn. La titularidad, aceptación de condiciones y verificaciones deben completarse en el navegador legítimo, nunca se finge un alta.',fields({}),false),
  tool('social_account_plan','Devuelve URL de registro oficial y requisitos para abrir un perfil real.',fields({network:string},['network'])),
  tool('social_accounts','Lista identidades declaradas o verificadas; no expone tokens.',fields({})),
  tool('social_account_register','Registra perfil externo DECLARADO, no verificado ni conectado.',fields({brand:string,network:string,handle:string},['brand','network','handle']),false),
  tool('social_account_verify','Verifica vía API oficial que OAuth corresponde a la cuenta declarada. Requiere tokens en entorno del host.',fields({brand:string,network:string},['brand','network']),false),
  tool('social_strategy','Plan editorial sin afirmar cifras de mercado inventadas.',fields({brand:string,product:string},['brand','product'])),
  tool('social_campaign_create','Crea campaña orgánica con destino HTTPS y UTM trazable.',fields({brand:string,title:string,destination:string},['brand','title','destination']),false),
  tool('social_draft','Crea borrador persistente. NO publica. Valida contenido según red.',fields({
    brand:string,network:string,text:string,campaignId:string,title:string,imageUrl:string,videoFile:string,
    visibility:{type:'string',enum:['private','unlisted','public']}
  },['brand','network','text']),false),
  tool('social_posts','Lista cola editorial y estados reales.',fields({})),
  tool('social_post_get','Muestra un borrador y checksum para revisión humana.',fields({id:string},['id'])),
  tool('social_report','Devuelve informes sin inventar seguidores, ingresos ni ROI.',fields({})),
  tool('social_due_preview','Lista publicaciones programadas sin publicarlas.',fields({})),
  tool('social_publish_approved','Publica ÚNICAMENTE posts ya aprobados por el usuario fuera de MCP. Requiere checksum exacto. No reintenta estados inciertos.',fields({id:string,checksum:string},['id','checksum']),false),
  tool('social_execute_due_approved','Ejecuta cola programada y aprobada. Requiere consentimiento previo real sobre la cola.',fields({}),false),
]
const known=new Map(TOOLS.map(t=>[t.name,t]))
function argumentsValid(s,a){
  if(!a||typeof a!=='object'||Array.isArray(a))return false
  if(Object.keys(a).some(k=>!Object.hasOwn(s.properties,k)))return false
  for(const k of s.required)if(!Object.hasOwn(a,k))return false
  for(const [k,v] of Object.entries(a)){
    const field=s.properties[k]
    if(typeof v!=='string'||(field.enum&&!field.enum.includes(v))||v.length>(field.maxLength||6000))return false
  }
  return true
}
async function dispatch(name,a){
  switch(name){
    case 'social_init':return run(['init'])
    case 'social_phoenix_onboarding':{
      const initial=await run(['init'])
      const providers=['x','instagram','facebook','youtube','tiktok','linkedin']
      const profiles=[]
      for(const network of providers){
        const plan=await run(['account-plan',network])
        profiles.push({network,officialSignup:plan.signup,requirements:plan.requirement||null,
          stage:'human-verification-required',postSignup:'social_account_register then social_account_verify'})
      }
      const saved=await run(['accounts'])
      return {brand:initial.brand,externallyCreated:0,profiles,
        existingDeclaredAccounts:saved.filter(item=>item.brandId==='phoenix'),
        instructions:'Kira puede usar el navegador autorizado para preparar los formularios de alta y explicar la marca Phoenix IA; el titular confirma condiciones, correo, teléfono y MFA. Solo marcar como conectada cuando la plataforma confirme la identidad real mediante OAuth/API.'}
    }
    case 'social_account_plan':return run(['account-plan',a.network])
    case 'social_accounts':return run(['accounts'])
    case 'social_account_register':return run(['account-register',a.brand,a.network,a.handle])
    case 'social_account_verify':return run(['account-verify',a.brand,a.network])
    case 'social_strategy':return run(['strategy',a.brand,a.product])
    case 'social_campaign_create':return run(['campaign',a.brand,a.title,a.destination])
    case 'social_draft':return run(['draft',a.brand,a.network,a.text,
      ...(a.campaignId?['--campaign',a.campaignId]:[]),...(a.title?['--title',a.title]:[]),
      ...(a.imageUrl?['--image',a.imageUrl]:[]),...(a.videoFile?['--video',a.videoFile]:[]),
      ...(a.visibility?['--visibility',a.visibility]:[])])
    case 'social_posts':return run(['posts'])
    case 'social_post_get':return run(['show',a.id])
    case 'social_report':return run(['report'])
    case 'social_due_preview':return run(['run-due'])
    case 'social_publish_approved':return run(['publish',a.id,'--confirm',a.checksum])
    case 'social_execute_due_approved':return run(['run-due','--execute'])
    default:throw Error('Herramienta desconocida')
  }
}
async function handle(m){
  if(m.method==='initialize')return {protocolVersion:m.params?.protocolVersion||'2024-11-05',
    serverInfo:{name:'phoenix-social-engine',version:'1.0.0'},capabilities:{tools:{}}}
  if(m.method==='ping')return {}
  if(m.method==='tools/list')return {tools:TOOLS}
  if(m.method==='tools/call'){
    const t=known.get(m.params?.name)
    if(!t)throw Error('Herramienta desconocida')
    const a=m.params?.arguments||{}
    if(!argumentsValid(t.inputSchema,a))throw Error('Parámetros inválidos')
    try{return {content:[{type:'text',text:JSON.stringify(await dispatch(t.name,a))}]}}
    catch(e){return {isError:true,content:[{type:'text',text:String(e.message).slice(0,350)}]}}
  }
  throw Error('Método no soportado')
}
const rl=createInterface({input:process.stdin,crlfDelay:Infinity})
rl.on('line',line=>{
  if(line.length>1024*1024)return
  let request;try{request=JSON.parse(line)}catch{return}
  if(!request||typeof request!=='object'||!Object.hasOwn(request,'id'))return
  void handle(request).then(
    result=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n'),
    e=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32603,message:String(e.message).slice(0,200)}})+'\n'))
})
