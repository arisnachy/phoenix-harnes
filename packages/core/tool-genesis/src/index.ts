/**
 * PHOENIX Genesis: first-party model tools for Kira.
 *
 * Unlike an optional external MCP connector, these tools are mounted in the
 * base Cordis profile, so discovery never reports "matched: 0" for Genesis.
 * A local Workbench is opened only when a tool is actually invoked.
 */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { runGenesis } from './runtime.ts'

export const name = 'tool-genesis'
export const inject = ['tools','systemPrompt']
const OUTPUT = {
  schema: {type:'string'} as const,
  render: (_args: unknown,value: string) => [{type:'text' as const,text:value}],
}
const present=(title:string,kind:'read'|'execute'='read')=>
  ({card:'generic' as const,title,kind})
const GUIDANCE = [
  'PHOENIX GENESIS está disponible como herramientas nativas. Ante solicitudes de crear',
  'o investigar una organización, primero utiliza genesis_status; no busques solo MCP externos.',
  'Para una DEMOSTRACIÓN ficticia utiliza genesis_demo_create y después consulta los',
  'informes con scope=demo y organization_id=hospital_genesis_demo.',
  'Cada respuesta de herramienta incluye persisted y source. Solo confirma operaciones',
  'cuando una llamada real devuelva persisted:true y un recibo de la base local.',
  'Las herramientas no instalan PHOENIX, no conectan HIS ni Fabric ni remiten reportes.',
  'Para instituciones reales utiliza scope=institution, datos agregados sin PHI;',
  'la creación, edición y verificación de datos requieren autorización explícita.',
  'Si el runtime no incluye scripts de Genesis, comunica el error y cómo solucionarlo;',
  'no sustituyas operaciones por un borrador inventado.',
].join(' ')

const parseJson=(raw:string,label:string): Record<string,unknown>=>{
  if(raw.length>16000)throw Error(label+' demasiado grande')
  let parsed:unknown
  try{parsed=JSON.parse(raw)}catch{throw Error(label+' no es JSON válido')}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
    throw Error(label+' debe ser un objeto JSON')
  return parsed as Record<string,unknown>
}
const emit=async(operation: Parameters<typeof runGenesis>[0],input:Record<string,unknown>)=>
  JSON.stringify(await runGenesis(operation,input))

export function apply(ctx:Context):void {
  ctx.systemPrompt.section({name:'tool:genesis',order:119,
    text:assembly=>/genesis|fabric|hospital|institucion|organizacion|organigrama|departamento|diagnostico institucional|poa|poe|60 areas|135 indicadores/iu
      .test((assembly as {incomingUserText?:string}).incomingUserText??'')?GUIDANCE:''})
  ctx.tools.register(defineTool({
    name:'genesis_status',
    description:'Comprueba si el motor institucional Genesis está realmente instalado en este PHOENIX y si existe una base institucional o demo. Usa esta herramienta ANTES de buscar conectores externos.',
    parameters:{scope:{type:'string',enum:['institution','demo'] as const,
      description:'institution (predeterminado) o demo (hospital ficticio)'}},
    output:OUTPUT,isConcurrencySafe:()=>true,
    async execute(args){return emit('status',{scope:args.scope??'institution'})},
    presentCall:()=>present('Genesis · Verificar capacidades'),
  }))
  ctx.tools.register(defineTool({
    name:'genesis_demo_create',
    description:'CREA realmente una base de hospital ficticio 100% aislada y persistente con 2 sedes, 7 unidades, 120 puestos, 45 camas de prueba, 60 áreas de referencia, presupuesto y POA. No toca pacientes ni hospitales reales. Un segundo intento reutiliza la demo existente.',
    parameters:{},output:OUTPUT,
    async execute(){return emit('demo-create',{scope:'demo'})},
    presentCall:()=>present('Genesis · Crear hospital ficticio','execute'),
  }))
  ctx.tools.register(defineTool({
    name:'genesis_organization_list',
    description:'Lista identificadores de organizaciones realmente presentes en la base local Genesis; scope demo permite leer el hospital sintético.',
    parameters:{scope:{type:'string',enum:['institution','demo'] as const}},
    output:OUTPUT,isConcurrencySafe:()=>true,
    async execute(args){return emit('organizations',{scope:args.scope??'institution'})},
    presentCall:()=>present('Genesis · Organizaciones registradas'),
  }))
  ctx.tools.register(defineTool({
    name:'genesis_organization_create',
    description:'CREA de verdad una organización institucional en SQLite de Genesis. Requiere la especificación JSON completa (organizationId, name, industry, adoptionMode, network, sites) y aprobación de la persona. Prohibidos pacientes, credenciales y datos personales.',
    parameters:{
      spec_json:{type:'string',required:true,description:'JSON de organización validada y sedes con identificadores sintéticos o aprobados.'},
      confirmed:{type:'boolean',required:true,description:'True solo tras autorización explícita del usuario para crear la organización.'},
    },output:OUTPUT,
    async execute(args){
      if(args.confirmed!==true)throw Error('Genesis requiere aprobación explícita')
      return emit('organization-create',{scope:'institution',spec:parseJson(args.spec_json,'spec_json')})
    },
    presentCall:()=>present('Genesis · Registrar organización','execute'),
  }))
  ctx.tools.register(defineTool({
    name:'genesis_organization_report',
    description:'LEE desde SQLite el diagnóstico de una organización real o ficticia. kinds: snapshot (inventario), interview, census (60 áreas), readiness (informe ejecutivo), deployment (propuesta sin instalar), poa (borrador por mes). No inventes datos.',
    parameters:{
      organization_id:{type:'string',required:true},
      kind:{type:'string',enum:['snapshot','interview','census','readiness','deployment','poa'] as const},
      period:{type:'string',description:'YYYY-MM obligatorio solo para kind=poa.'},
      scope:{type:'string',enum:['institution','demo'] as const},
    },output:OUTPUT,isConcurrencySafe:()=>true,
    async execute(args){return emit('report',{
      organizationId:args.organization_id,scope:args.scope??'institution',
      kind:args.kind??'snapshot',...(args.period===undefined?{}:{period:args.period})})},
    presentCall:()=>present('Genesis · Consultar diagnóstico real'),
  }))
  ctx.tools.register(defineTool({
    name:'genesis_catalog_search',
    description:'CONSULTA el catálogo institucional 360 de Genesis (no una suposición): categories areas, indicators, reports, committees, procedures, workflows, risks, dataEntities, integrationPatterns, budgetTemplates. Datos son plantillas, NO servicios existentes.',
    parameters:{
      organization_id:{type:'string',required:true},
      category:{type:'string',required:true},
      query:{type:'string'},
      scope:{type:'string',enum:['institution','demo'] as const},
    },output:OUTPUT,isConcurrencySafe:()=>true,
    async execute(args){return emit('catalog',{
      organizationId:args.organization_id,category:args.category,query:args.query??'',
      scope:args.scope??'institution'})},
    presentCall:()=>present('Genesis · Investigar catálogo'),
  }))
  ctx.tools.register(defineTool({
    name:'genesis_area_assess',
    description:'REGISTRA evaluación de área hospitalaria en Genesis con estado, revisión, rol, sede y evidencias; NO instala ni declara conectados agentes. Requiere autorización explícita, y las evaluaciones verificadas exigen evidencias validadas.',
    parameters:{
      organization_id:{type:'string',required:true},
      assessment_json:{type:'string',required:true,description:'JSON con organizationId, areaId, state, reviewState, reviewerRole, siteId, evidenceRefs, expectedRevision.'},
      scope:{type:'string',enum:['institution','demo'] as const},
      confirmed:{type:'boolean',required:true},
    },output:OUTPUT,
    async execute(args){
      if(args.confirmed!==true)throw Error('Genesis requiere autorización de evaluación')
      return emit('area-assess',{organizationId:args.organization_id,
        assessment:parseJson(args.assessment_json,'assessment_json'),
        authorized:true,scope:args.scope??'institution'})
    },
    presentCall:()=>present('Genesis · Evaluar área','execute'),
  }))
  ctx.tools.register(defineTool({
    name:'genesis_unit_register',
    description:'REGISTRA una unidad organizacional en Genesis tras autorización expresa; la unidad debe existir en una sede registrada. No crea agentes, accesos, dispositivos o historia clínica.',
    parameters:{
      organization_id:{type:'string',required:true},
      unit_json:{type:'string',required:true},
      confirmed:{type:'boolean',required:true},
    },output:OUTPUT,
    async execute(args){
      if(args.confirmed!==true)throw Error('Genesis requiere autorización para unidad')
      return emit('unit-register',{organizationId:args.organization_id,
        unit:parseJson(args.unit_json,'unit_json'),
        authorized:true,scope:'institution'})
    },
    presentCall:()=>present('Genesis · Registrar unidad','execute'),
  }))
}
