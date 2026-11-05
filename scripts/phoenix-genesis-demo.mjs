/**
 * PHOENIX Genesis — reproducible, isolated synthetic hospital demonstration.
 *
 * Writes a NEW directory chosen explicitly by the operator. It never touches
 * a production institution, connects to HIS, enrolls Fabric nodes or uses PHI.
 */
import { mkdirSync,writeFileSync,existsSync,rmSync } from 'node:fs'
import { isAbsolute,join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GenesisWorkbench } from './phoenix-genesis-workbench.mjs'
import { listGenesisAreaCensus,assessGenesisArea } from './phoenix-genesis-area-census.mjs'
import { buildGenesisReadinessBrief,renderGenesisReadinessHtml } from './phoenix-genesis-readiness-brief.mjs'

const ORG='hospital_genesis_demo'
const UNIT_DEMO=[
  ['direccion','Dirección y Planificación','admin',10,5,'principal'],
  ['consulta','Consultas Externas','clinical',24,8,'principal'],
  ['urgencias','Urgencias','emergency',28,5,'principal'],
  ['farmacia','Farmacia','pharmacy',12,3,'principal'],
  ['enfermeria','Enfermería','nursing',30,4,'principal'],
  ['laboratorio','Laboratorio','lab',10,3,'principal'],
  ['mantenimiento','Mantenimiento','facilities',6,2,'anexo']
]
const contents=[
  'HOSPITAL FICTICIO. DEMOSTRACIÓN PHOENIX GENESIS, SIN DATOS REALES.',
  'Sedes agregadas: 2 (principal y anexo).',
  'Personal agregado ficticio: 120 posiciones entre siete unidades.',
  'Camas ficticias: 45. Camas ocupadas simuladas: 34.',
  'Los precios y objetivos son números de prueba, no cotizaciones.',
  'No existe HIS, licencia ni API reales conectados.'
].join('\n')+'\n'
export function createGenesisSyntheticDemo(outputDir){
  if(typeof outputDir!=='string'||!isAbsolute(outputDir)||
    outputDir.length>500)throw Error('Se requiere una carpeta de salida absoluta nueva')
  if(existsSync(outputDir))throw Error('La carpeta de demostración ya existe: no se sobrescribe nada')
  mkdirSync(outputDir,{mode:0o700})
  const dbPath=join(outputDir,'genesis.sqlite')
  let store
  try{
    store=new GenesisWorkbench(dbPath)
    store.createOrganization({
      organizationId:ORG,name:'Hospital Genesis DEMO (DATOS FICTICIOS)',
      industry:'healthcare',adoptionMode:'hybrid',network:{mode:'lan'},
      sites:[
        {siteId:'principal',name:'Sede principal ficticia',
          workstations:28,reusableWorkstations:20,roles:[],software:[]},
        {siteId:'anexo',name:'Anexo ficticio',
          workstations:10,reusableWorkstations:7,roles:[],software:[]}
      ],
      costs:{workstationUsd:650},inference:{strategies:[]}
    })
    const evidencePath=join(outputDir,'fuente_sintetica.txt')
    writeFileSync(evidencePath,contents,{flag:'wx',mode:0o600})
    const ev=store.registry.registerEvidence({organizationId:ORG,
      filePath:evidencePath,kind:'demo_aggregate',
      classification:'internal',validated:true})
    for(const [unitId,name,role,staffCount,workstations,siteId] of UNIT_DEMO)
      store.unit({organizationId:ORG,unitId,name,role,staffCount,workstations,siteId})
    store.answer({organizationId:ORG,category:'institution',key:'ownership',
      value:'Hospital ficticio para pruebas institucionales',status:'verified',
      evidenceRefs:[ev.evidenceId]})
    store.answer({organizationId:ORG,category:'facility',key:'space_inventory',
      value:'2 sedes y 45 camas ficticias',status:'verified',
      evidenceRefs:[ev.evidenceId]})
    store.answer({organizationId:ORG,category:'staffing',key:'coverage',
      value:'120 puestos agregados ficticios entre 7 unidades',
      status:'verified',evidenceRefs:[ev.evidenceId]})
    store.system({organizationId:ORG,systemId:'his_demo',
      name:'HIS heredado SIMULADO (sin conexión)',method:'fhir',ownerUnit:'direccion'})
    store.provider({organizationId:ORG,providerId:'modelo_local_demo',
      modelName:'Modelo local simulado sin credenciales',
      execution:'local',accountMode:'organization',monthlyBudgetUsd:0})
    for(const cost of [
      {itemId:'servidores',label:'Servidores (precio hipotético)',
        category:'hardware',quantity:2,unitPrice:750,currency:'USD',recurrence:'one-time'},
      {itemId:'licencias',label:'Software mensual (precio hipotético)',
        category:'software',quantity:1,unitPrice:250,currency:'USD',recurrence:'monthly'},
      {itemId:'mantenimiento',label:'Mantenimiento mensual (precio hipotético)',
        category:'maintenance',quantity:1,unitPrice:12500,currency:'DOP',recurrence:'monthly'}
    ])store.cost({organizationId:ORG,...cost,evidenceRefs:[ev.evidenceId]})
    store.registry.recordIndicator({organizationId:ORG,
      metricId:'ocupacion_demo',period:'2026-11',
      numerator:34,denominator:45,unit:'ratio',evidenceRefs:[ev.evidenceId]})
    store.goal({organizationId:ORG,goalId:'ocupacion_hospitalaria_demo',
      title:'Seguimiento de ocupación de camas ficticias',
      metricId:'ocupacion_demo',period:'2026-11',target:0.75,ownerUnit:'direccion'})
    store.obligation({organizationId:ORG,obligationId:'reporte_demo',
      recipient:'Autoridad ficticia (NO ENVIAR)',
      title:'Reporte agregado de producción de prueba',periodicity:'monthly'})
    const areas=listGenesisAreaCensus(store,ORG).areas
    for(const [index,state,reviewState] of [
      [0,'existing','verified'],
      [1,'existing','verified'],
      [2,'outsourced','declared']
    ]){
      const area=areas[index]
      assessGenesisArea(store,{organizationId:ORG,areaId:area.areaId,
        state,reviewState,reviewerRole:'Dirección ficticia',
        siteId:'principal',evidenceRefs:reviewState==='verified'?[ev.evidenceId]:[],
        expectedRevision:0})
    }
    const report=buildGenesisReadinessBrief(store,ORG)
    const poa=store.poa({organizationId:ORG,period:'2026-11'})
    const reportJson=join(outputDir,'diagnostico.json')
    const reportHtml=join(outputDir,'diagnostico.html')
    writeFileSync(reportJson,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600})
    writeFileSync(reportHtml,renderGenesisReadinessHtml(report),{flag:'wx',mode:0o600})
    writeFileSync(join(outputDir,'poa-borrador.json'),JSON.stringify(poa,null,2)+'\n',
      {flag:'wx',mode:0o600})
    const instructions=[
      'PHOENIX GENESIS · DEMOSTRACIÓN CON DATOS FICTICIOS',
      'No hay pacientes, personal identificado ni conectores clínicos reales.',
      'Desde la raíz del repositorio PHOENIX:',
      '  $env:PHOENIX_GENESIS_DB = "'+dbPath+'"',
      '  $env:PHOENIX_GENESIS_ADMIN_TOKEN = <clave segura de 32+ caracteres>',
      '  pnpm genesis',
      'Abrir http://127.0.0.1:8767/ en este mismo equipo.',
      'Ver institución: '+ORG,
      'Paneles: Censo hospitalario, Diagnóstico ejecutivo, Planificación, Red PHOENIX.',
      'No afirmar que el HIS, los modelos, reportes o nodos están operativos.'
    ].join('\n')+'\n'
    writeFileSync(join(outputDir,'LEEME-DEMO.txt'),instructions,{flag:'wx',mode:0o600})
    return {demo:true,organizationId:ORG,dbPath,outputDir,
      staffSlots:UNIT_DEMO.reduce((n,x)=>n+x[3],0),
      sites:2,units:UNIT_DEMO.length,documentEvidence:1,
      reviewedAreas:3,verifiedAreas:2,
      reportJson,reportHtml,
      poaStatus:'draft-only',liveConnections:false,
      sourceSha256:report.sourceSha256}
  }catch(error){
    if(store){try{store.close()}catch{}store=null}
    rmSync(outputDir,{recursive:true,force:true})
    throw error
  }finally{if(store)store.close()}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  try{
    if(process.argv.length!==3)throw Error('Uso: node scripts/phoenix-genesis-demo.mjs <carpeta-nueva-absoluta>')
    console.log(JSON.stringify(createGenesisSyntheticDemo(process.argv[2]),null,2))
  }catch(e){console.error('Genesis demo: '+e.message);process.exitCode=1}
}
