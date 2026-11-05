/**
 * Genesis Workbench — institutional discovery and deployment readiness.
 * Domain-independent, local SQLite, non-sensitive metadata ONLY.
 * Decisions, official reports and external integration always need approval.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { GenesisInstitutionalRegistry } from './phoenix-genesis-institutional-registry.mjs'
import { planGenesisFabric } from './phoenix-genesis-fabric.mjs'
import { suggestGenesisStructure } from './phoenix-genesis-sector-packs.mjs'

const ID=/^[a-z][a-z0-9._-]{0,63}$/u
const CATEGORY=new Set(['institution','facility','staffing','operations','finance','procurement','compliance',
  'technology','web','governance','environment','logistics','clinical','policies','reports','mobility',
  'furniture','parking','catering','communications','safety','contracts','other'])
const METHODS=new Set(['api','fhir','hl7','dicom','files','database-readonly','rpa-supervised','unknown'])
const SENSITIVE=/(?:patient|diagnos|historia.?clinica|cedula|password|secret|api.?key|curricul|salary|nomina|ssn|birthdate|identification.number|access.token)/iu
const ISO_PERIOD=/^\d{4}-(?:0[1-9]|1[0-2])$/u
const QUESTIONS=[
  ['institution','ownership','¿Es una organización pública, privada o mixta?'],
  ['institution','service_model','¿Cuáles son sus servicios y población objetivo?'],
  ['facility','blueprints','¿Existen planos arquitectónicos actualizados y verificados?'],
  ['facility','space_inventory','¿Están identificados edificios, espacios, camas y mobiliario?'],
  ['staffing','org_chart','¿Existe organigrama vigente y quién lo aprobó?'],
  ['staffing','job_manuals','¿Hay manuales de funciones y perfiles de puestos?'],
  ['staffing','coverage','¿Están inventariados turnos, dotación y vacantes por unidad?'],
  ['operations','process_manuals','¿Existen procesos y procedimientos operativos documentados?'],
  ['technology','asset_inventory','¿Se conocen las PC, servidores, redes, dispositivos y versiones?'],
  ['technology','existing_software','¿Qué software y bases de datos ya utiliza la organización?'],
  ['technology','integrations','¿Qué API, estándar o exportación autoriza su propietario?'],
  ['finance','budget','¿Hay presupuesto y ejecución conciliados con fuentes?'],
  ['finance','cost_centers','¿Están identificados centros de costo y responsables?'],
  ['procurement','contracts','¿Existen proveedores, compras previstas y contratos vigentes?'],
  ['compliance','legal','¿Se dispone de habilitaciones, requisitos legales y políticas vigentes?'],
  ['reports','reporting','¿Qué informes entrega, a quién, con qué periodicidad y plantilla?'],
  ['governance','committees','¿Están registrados los comités, actas y responsables?'],
  ['safety','continuity','¿Existe respaldo, recuperación y plan de continuidad probado?'],
  ['logistics','resources','¿Cómo se administran almacenes, residuos, transporte y parqueos?'],
  ['catering','nutrition','¿Cómo se gestionan cocina, nutrición y alimentos?'],
  ['web','channels','¿Cuáles son la web, intranet y canales digitales disponibles?']
]
function ident(v,label='Identificador'){
  if(typeof v!=='string'||!ID.test(v))throw Error(label+' inválido')
  return v
}
function caption(v,label='Nombre',max=180){
  if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f]/u.test(v))
    throw Error(label+' inválido')
  return v.trim()
}
function finite(v,label='Valor'){
  if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1e10)throw Error(label+' fuera de rango')
  return v
}
function integer(v,label,max=100000){
  if(!Number.isSafeInteger(v)||v<0||v>max)throw Error(label+' inválido')
  return v
}
function object(v,label='Objeto'){
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error(label+' inválido')
  return v
}
function cleanJson(value,label){
  const json=JSON.stringify(value)
  if(!json||json.length>4096||SENSITIVE.test(json))throw Error(label+' contiene datos no admitidos')
  return json
}
function refs(value){
  if(!Array.isArray(value)||value.length>24)throw Error('Evidencias inválidas')
  const v=value.map(x=>ident(x,'Evidencia'))
  if(new Set(v).size!==v.length)throw Error('Evidencia duplicada')
  return v
}
function validMonth(v){
  if(typeof v!=='string'||!ISO_PERIOD.test(v))throw Error('Período YYYY-MM obligatorio')
  return v
}
const utc=()=>new Date().toISOString()
const fingerprint=v=>createHash('sha256').update(v).digest('hex')

function canonicalSpec(raw){
  const x=object(raw,'Organización')
  return {
    organizationId:x.organizationId,name:x.name,industry:x.industry,
    adoptionMode:x.adoptionMode,
    network:{
      mode:x.network?.mode,
      peers:(x.network?.peers??[]).map(p=>({
        from:p.from,to:p.to,approved:p.approved,peerFingerprint:p.peerFingerprint
      })),
      partners:(x.network?.partners??[]).map(p=>({
        partnerOrganizationId:p.partnerOrganizationId,
        approved:p.approved,dataAgreementVerified:p.dataAgreementVerified,
        peerFingerprint:p.peerFingerprint,capabilities:p.capabilities
      }))
    },
    sites:(x.sites??[]).map(s=>({
      siteId:s.siteId,name:s.name,workstations:s.workstations,
      reusableWorkstations:s.reusableWorkstations,
      roles:(s.roles??[]).map(v=>({
        roleId:v.roleId,name:v.name,instances:v.instances,capabilities:v.capabilities
      })),
      software:(s.software??[]).map(v=>({systemId:v.systemId,name:v.name}))
    })),
    costs:{workstationUsd:x.costs?.workstationUsd},
    inference:{strategies:(x.inference?.strategies??[]).map(v=>({
      providerId:v.providerId,execution:v.execution,
      monthlyBudgetUsd:v.monthlyBudgetUsd
    }))}
  }
}
export class GenesisWorkbench {
  constructor(dbPath){
    if(typeof dbPath!=='string'||!dbPath)throw Error('Ruta SQLite obligatoria')
    mkdirSync(dirname(dbPath),{recursive:true,mode:0o700})
    this.registry=new GenesisInstitutionalRegistry(dbPath)
    this.db=new DatabaseSync(dbPath)
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;')
    this.db.exec([
      'CREATE TABLE IF NOT EXISTS genesis_facts(org_id TEXT NOT NULL,category TEXT NOT NULL,fact_key TEXT NOT NULL,value_json TEXT NOT NULL,status TEXT NOT NULL,evidence_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(org_id,category,fact_key),FOREIGN KEY(org_id) REFERENCES organizations(org_id));',
      'CREATE TABLE IF NOT EXISTS genesis_units(org_id TEXT NOT NULL,unit_id TEXT NOT NULL,site_id TEXT NOT NULL,name TEXT NOT NULL,parent_id TEXT,staff_count INTEGER NOT NULL,workstations INTEGER NOT NULL,role TEXT NOT NULL,PRIMARY KEY(org_id,unit_id),FOREIGN KEY(org_id) REFERENCES organizations(org_id));',
      'CREATE TABLE IF NOT EXISTS genesis_systems(org_id TEXT NOT NULL,system_id TEXT NOT NULL,name TEXT NOT NULL,method TEXT NOT NULL,state TEXT NOT NULL,owner_unit TEXT,PRIMARY KEY(org_id,system_id),FOREIGN KEY(org_id) REFERENCES organizations(org_id));',
      'CREATE TABLE IF NOT EXISTS genesis_costs(org_id TEXT NOT NULL,item_id TEXT NOT NULL,label TEXT NOT NULL,category TEXT NOT NULL,qty REAL NOT NULL,unit_price REAL NOT NULL,currency TEXT NOT NULL,recurrence TEXT NOT NULL,evidence_json TEXT NOT NULL,PRIMARY KEY(org_id,item_id),FOREIGN KEY(org_id) REFERENCES organizations(org_id));',
      'CREATE TABLE IF NOT EXISTS genesis_goals(org_id TEXT NOT NULL,goal_id TEXT NOT NULL,title TEXT NOT NULL,metric_id TEXT NOT NULL,period TEXT NOT NULL,target REAL NOT NULL,owner_unit TEXT,PRIMARY KEY(org_id,goal_id,period),FOREIGN KEY(org_id) REFERENCES organizations(org_id));',
      'CREATE TABLE IF NOT EXISTS genesis_obligations(org_id TEXT NOT NULL,obligation_id TEXT NOT NULL,recipient TEXT NOT NULL,title TEXT NOT NULL,periodicity TEXT NOT NULL,template_version TEXT,state TEXT NOT NULL,PRIMARY KEY(org_id,obligation_id),FOREIGN KEY(org_id) REFERENCES organizations(org_id));',
      'CREATE TABLE IF NOT EXISTS genesis_specs(org_id TEXT PRIMARY KEY,spec_json TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,FOREIGN KEY(org_id) REFERENCES organizations(org_id));',
      'CREATE TABLE IF NOT EXISTS genesis_providers(org_id TEXT NOT NULL,provider_id TEXT NOT NULL,model_name TEXT NOT NULL,execution TEXT NOT NULL,account_mode TEXT NOT NULL,monthly_budget_usd REAL NOT NULL,status TEXT NOT NULL,PRIMARY KEY(org_id,provider_id),FOREIGN KEY(org_id) REFERENCES organizations(org_id));',
      'CREATE TABLE IF NOT EXISTS genesis_audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,org_id TEXT NOT NULL,action TEXT NOT NULL,object_id TEXT NOT NULL,created_at TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL);'
    ].join('\n'))
    this.q={
      orgs:this.db.prepare('SELECT org_id FROM organizations ORDER BY org_id'),
      spec:this.db.prepare('SELECT spec_json,revision FROM genesis_specs WHERE org_id=?'),
      providers:this.db.prepare('SELECT provider_id,model_name,execution,account_mode,monthly_budget_usd,status FROM genesis_providers WHERE org_id=? ORDER BY provider_id'),
      setProvider:this.db.prepare('INSERT INTO genesis_providers(org_id,provider_id,model_name,execution,account_mode,monthly_budget_usd,status) VALUES(?,?,?,?,?,?,?) ON CONFLICT(org_id,provider_id) DO UPDATE SET model_name=excluded.model_name,execution=excluded.execution,account_mode=excluded.account_mode,monthly_budget_usd=excluded.monthly_budget_usd,status=excluded.status'),
      saveSpec:this.db.prepare('INSERT INTO genesis_specs(org_id,spec_json,revision,updated_at) VALUES(?,?,1,?)'),
      updateSpec:this.db.prepare('UPDATE genesis_specs SET spec_json=?,revision=revision+1,updated_at=? WHERE org_id=? AND revision=?'),
      updateOrg:this.db.prepare('UPDATE organizations SET profile=? WHERE org_id=?'),
      facts:this.db.prepare('SELECT * FROM genesis_facts WHERE org_id=? ORDER BY category,fact_key'),
      fact:this.db.prepare('SELECT * FROM genesis_facts WHERE org_id=? AND category=? AND fact_key=?'),
      setFact:this.db.prepare('INSERT INTO genesis_facts(org_id,category,fact_key,value_json,status,evidence_json,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(org_id,category,fact_key) DO UPDATE SET value_json=excluded.value_json,status=excluded.status,evidence_json=excluded.evidence_json,updated_at=excluded.updated_at'),
      units:this.db.prepare('SELECT * FROM genesis_units WHERE org_id=? ORDER BY unit_id'),
      unit:this.db.prepare('SELECT * FROM genesis_units WHERE org_id=? AND unit_id=?'),
      setUnit:this.db.prepare('INSERT INTO genesis_units(org_id,unit_id,site_id,name,parent_id,staff_count,workstations,role) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(org_id,unit_id) DO UPDATE SET site_id=excluded.site_id,name=excluded.name,parent_id=excluded.parent_id,staff_count=excluded.staff_count,workstations=excluded.workstations,role=excluded.role'),
      systems:this.db.prepare('SELECT * FROM genesis_systems WHERE org_id=? ORDER BY system_id'),
      setSystem:this.db.prepare('INSERT INTO genesis_systems(org_id,system_id,name,method,state,owner_unit) VALUES(?,?,?,?,?,?) ON CONFLICT(org_id,system_id) DO UPDATE SET name=excluded.name,method=excluded.method,state=excluded.state,owner_unit=excluded.owner_unit'),
      costs:this.db.prepare('SELECT * FROM genesis_costs WHERE org_id=? ORDER BY item_id'),
      setCost:this.db.prepare('INSERT INTO genesis_costs(org_id,item_id,label,category,qty,unit_price,currency,recurrence,evidence_json) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(org_id,item_id) DO UPDATE SET label=excluded.label,category=excluded.category,qty=excluded.qty,unit_price=excluded.unit_price,currency=excluded.currency,recurrence=excluded.recurrence,evidence_json=excluded.evidence_json'),
      goals:this.db.prepare('SELECT * FROM genesis_goals WHERE org_id=? ORDER BY period,goal_id'),
      setGoal:this.db.prepare('INSERT INTO genesis_goals(org_id,goal_id,title,metric_id,period,target,owner_unit) VALUES(?,?,?,?,?,?,?) ON CONFLICT(org_id,goal_id,period) DO UPDATE SET title=excluded.title,metric_id=excluded.metric_id,target=excluded.target,owner_unit=excluded.owner_unit'),
      obligations:this.db.prepare('SELECT * FROM genesis_obligations WHERE org_id=? ORDER BY obligation_id'),
      setObligation:this.db.prepare('INSERT INTO genesis_obligations(org_id,obligation_id,recipient,title,periodicity,template_version,state) VALUES(?,?,?,?,?,?,?) ON CONFLICT(org_id,obligation_id) DO UPDATE SET recipient=excluded.recipient,title=excluded.title,periodicity=excluded.periodicity,template_version=excluded.template_version,state=excluded.state'),
      lastAudit:this.db.prepare('SELECT entry_hash FROM genesis_audit ORDER BY seq DESC LIMIT 1'),
      insertAudit:this.db.prepare('INSERT INTO genesis_audit(org_id,action,object_id,created_at,previous_hash,entry_hash) VALUES(?,?,?,?,?,?)'),
      audit:this.db.prepare('SELECT seq,action,object_id,created_at,entry_hash FROM genesis_audit WHERE org_id=? ORDER BY seq DESC LIMIT 50')
    }
  }
  organizations(){return this.q.orgs.all().map(x=>x.org_id)}
  createOrganization(spec){
    const canonical=canonicalSpec(spec)
    const plan=this.registry.registerOrganization(canonical)
    const org=plan.organization.organizationId
    this.q.saveSpec.run(org,JSON.stringify(canonical),utc())
    this._audit(org,'organization-created',org)
    return plan
  }
  addSite({organizationId,siteId,name,workstations=0,reusableWorkstations=0,
    expectedRevision}){
    const org=ident(organizationId,'Organización')
    this._org(org)
    const record=this.q.spec.get(org)
    if(!record)throw Error('Esta institución requiere importar su configuración original antes de editar sedes')
    if(record.revision!==expectedRevision)throw Error('Conflicto de versión de organización')
    const spec=JSON.parse(record.spec_json)
    spec.sites.push({siteId:ident(siteId,'Sede'),name:caption(name),
      workstations:integer(workstations,'Estaciones'),
      reusableWorkstations:integer(reusableWorkstations,'Estaciones reutilizables'),
      roles:[],software:[]})
    const next=planGenesisFabric(spec)
    this.db.exec('BEGIN IMMEDIATE')
    try{
      this.q.updateOrg.run(JSON.stringify(next),org)
      const changed=this.q.updateSpec.run(JSON.stringify(spec),utc(),org,expectedRevision)
      if(changed.changes!==1)throw Error('Conflicto de versión de organización')
      this._audit(org,'site-added',siteId)
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
    return {organizationId:org,siteId,revision:expectedRevision+1,
      planSummary:next.summary,status:'planned-not-installed'}
  }
  _org(id){return this.registry.organization(ident(id,'Organización'))}
  _audit(org,action,key){
    const last=this.q.lastAudit.get()?.entry_hash??'GENESIS'
    const at=utc(),next=fingerprint(JSON.stringify([last,org,action,key,at]))
    this.q.insertAudit.run(org,action,key,at,last,next)
  }
  _evidence(org,evidenceRefs){
    const value=refs(evidenceRefs??[])
    this.registry.validateEvidence(org,value)
    return JSON.stringify(value)
  }
  answer({organizationId,category,key,value,status='declared',evidenceRefs=[]}){
    const org=ident(organizationId,'Organización');this._org(org)
    if(!CATEGORY.has(category))throw Error('Categoría desconocida')
    ident(key,'Clave')
    if(SENSITIVE.test(category+'.'+key))throw Error('Campo contiene datos no admitidos')
    if(!['declared','verified','inferred'].includes(status))throw Error('Estado inválido')
    if(!['string','number','boolean'].includes(typeof value))
      throw Error('Respuesta debe ser dato simple sin información privada')
    const encoded=cleanJson(value,'Respuesta')
    if(status==='verified'&&evidenceRefs.length===0)
      throw Error('Una respuesta verificada necesita evidencia validada')
    const evidence=this._evidence(org,evidenceRefs)
    this.q.setFact.run(org,category,key,encoded,status,evidence,utc())
    this._audit(org,'fact-'+status,category+'.'+key)
    return {organizationId:org,category,key,value,status,evidenceRefs}
  }
  unit({organizationId,unitId,siteId,name,parentId=null,staffCount=0,workstations=0,role='general'}){
    const org=ident(organizationId,'Organización')
    const profile=this._org(org)
    ident(unitId,'Unidad');ident(siteId,'Sede');ident(role,'Función')
    if(!profile.workstations.some(x=>x.siteId===siteId))throw Error('Sede inexistente')
    if(parentId!==null){
      ident(parentId,'Unidad superior')
      if(parentId===unitId)throw Error('Una unidad no puede ser su propia superior')
      const parent=this.q.unit.get(org,parentId)
      if(!parent||parent.site_id!==siteId)throw Error('Unidad superior debe existir en la misma sede')
      let cursor=parent
      while(cursor?.parent_id){
        if(cursor.parent_id===unitId)throw Error('Ciclo jerárquico detectado')
        cursor=this.q.unit.get(org,cursor.parent_id)
      }
    }
    this.q.setUnit.run(org,unitId,siteId,caption(name),parentId,
      integer(staffCount,'Dotación'),integer(workstations,'Estaciones'),role)
    this._audit(org,'unit-upsert',unitId)
    return {unitId,siteId,name,parentId,staffCount,workstations,role}
  }
  system({organizationId,systemId,name,method='unknown',ownerUnit=null}){
    const org=ident(organizationId,'Organización');this._org(org)
    ident(systemId,'Sistema')
    if(!METHODS.has(method))throw Error('Método de integración inválido')
    if(ownerUnit!==null&&!this.q.unit.get(org,ident(ownerUnit,'Unidad')))throw Error('Unidad responsable desconocida')
    this.q.setSystem.run(org,systemId,caption(name),method,'pending-authorization',ownerUnit)
    this._audit(org,'system-discovered',systemId)
    return {systemId,method,state:'pending-authorization',connected:false}
  }
  cost({organizationId,itemId,label,category,quantity,unitPrice,currency='USD',
    recurrence='one-time',evidenceRefs=[]}){
    const org=ident(organizationId,'Organización');this._org(org)
    ident(itemId,'Partida')
    if(!['hardware','software','infrastructure','staffing','services','training','maintenance','other'].includes(category))
      throw Error('Categoría de costo desconocida')
    if(!['one-time','monthly','yearly'].includes(recurrence))throw Error('Recurrencia inválida')
    if(!['USD','DOP','EUR'].includes(currency))throw Error('Moneda no soportada')
    const evid=this._evidence(org,evidenceRefs)
    const qty=finite(quantity,'Cantidad'),price=finite(unitPrice,'Precio')
    this.q.setCost.run(org,itemId,caption(label),category,qty,price,currency,recurrence,evid)
    this._audit(org,'cost-upsert',itemId)
    return {itemId,total:Math.round(qty*price*100)/100,currency,recurrence}
  }
  provider(input){
    object(input,'Proveedor')
    if(Object.keys(input).some(key=>/token|secret|password|api.?key|credential/iu.test(key)))
      throw Error('No se admiten claves de acceso en Genesis')
    const {organizationId,providerId,modelName,execution,accountMode,
      monthlyBudgetUsd}=input
    const org=ident(organizationId,'Organización');this._org(org)
    ident(providerId,'Proveedor')
    if(!['local','external'].includes(execution))throw Error('Ejecución inválida')
    if(!['organization','per-unit','per-instance'].includes(accountMode))
      throw Error('Modo de cuentas inválido')
    const budget=finite(monthlyBudgetUsd,'Presupuesto mensual')
    this.q.setProvider.run(org,providerId,caption(modelName,'Modelo'),
      execution,accountMode,budget,'pending-credential-and-capability-test')
    this._audit(org,'model-provider-planned',providerId)
    return {providerId,modelName,execution,accountMode,monthlyBudgetUsd:budget,
      status:'pending-credential-and-capability-test',credentials:'never-stored'}
  }
  goal({organizationId,goalId,title,metricId,period,target,ownerUnit=null}){
    const org=ident(organizationId,'Organización');this._org(org)
    ident(goalId,'Meta');ident(metricId,'Indicador')
    if(!ISO_PERIOD.test(period))throw Error('Período YYYY-MM requerido')
    if(ownerUnit!==null&&!this.q.unit.get(org,ident(ownerUnit,'Unidad')))
      throw Error('Responsable inexistente')
    this.q.setGoal.run(org,goalId,caption(title),metricId,period,finite(target,'Meta'),ownerUnit)
    this._audit(org,'goal-upsert',goalId)
    return {goalId,period,approval:'pending-human-approval'}
  }
  obligation({organizationId,obligationId,recipient,title,periodicity='annual',
    templateVersion=null}){
    const org=ident(organizationId,'Organización');this._org(org)
    ident(obligationId,'Obligación')
    if(!['monthly','quarterly','annual','event-driven'].includes(periodicity))
      throw Error('Periodicidad no permitida')
    const template=templateVersion===null?null:caption(templateVersion,'Plantilla')
    this.q.setObligation.run(org,obligationId,caption(recipient,'Destinatario'),
      caption(title),periodicity,template,'unverified-regulatory-requirement')
    this._audit(org,'obligation-proposed',obligationId)
    return {obligationId,status:'unverified-regulatory-requirement'}
  }
  interview(org){
    const id=ident(org,'Organización');this._org(id)
    const present=new Set(this.q.facts.all(id).map(x=>x.category+':'+x.fact_key))
    return QUESTIONS.filter(([cat,key])=>!present.has(cat+':'+key))
      .map(([category,key,question])=>({category,key,question,status:'unanswered'}))
  }
  dashboard(org){
    const id=ident(org,'Organización'),plan=this._org(id)
    const facts=this.q.facts.all(id).map(x=>({
      category:x.category,key:x.fact_key,value:JSON.parse(x.value_json),status:x.status,
      evidenceRefs:JSON.parse(x.evidence_json),updatedAt:x.updated_at}))
    const units=this.q.units.all(id).map(x=>({
      unitId:x.unit_id,siteId:x.site_id,name:x.name,parentId:x.parent_id,
      staffCount:x.staff_count,workstations:x.workstations,role:x.role}))
    const systems=this.q.systems.all(id).map(x=>({
      systemId:x.system_id,name:x.name,method:x.method,state:x.state,ownerUnit:x.owner_unit}))
    const costs=this.q.costs.all(id).map(x=>({
      itemId:x.item_id,label:x.label,category:x.category,quantity:x.qty,
      unitPrice:x.unit_price,currency:x.currency,recurrence:x.recurrence,
      evidenceRefs:JSON.parse(x.evidence_json),total:Math.round(x.qty*x.unit_price*100)/100}))
    const providers=this.q.providers.all(id).map(x=>({
      providerId:x.provider_id,modelName:x.model_name,execution:x.execution,
      accountMode:x.account_mode,monthlyBudgetUsd:x.monthly_budget_usd,
      status:x.status}))
    const grouped={}
    for(const c of costs){
      const key=c.currency+':'+c.recurrence
      grouped[key]=Math.round(((grouped[key]??0)+c.total)*100)/100
    }
    const goals=this.q.goals.all(id).map(x=>({
      goalId:x.goal_id,title:x.title,metricId:x.metric_id,period:x.period,
      target:x.target,ownerUnit:x.owner_unit}))
    const obligations=this.q.obligations.all(id).map(x=>({
      obligationId:x.obligation_id,recipient:x.recipient,title:x.title,
      periodicity:x.periodicity,templateVersion:x.template_version,state:x.state}))
    const missing=this.interview(id)
    const evidence=this.registry.snapshot(id).evidence
    return {
      organization:plan.organization,planSummary:plan.summary,sites:plan.workstations,
      configurationRevision:this.q.spec.get(id)?.revision??null,network:plan.network,
      inference:plan.inference,units,systems,costs,budgetByCurrencyAndPeriod:grouped,
      goals,obligations,providers,facts,evidence,missingQuestions:missing,
      readiness:{
        discoveryCoveragePct:Math.round((QUESTIONS.length-missing.length)/QUESTIONS.length*100),
        verifiedFacts:facts.filter(x=>x.status==='verified').length,
        unverifiedFacts:facts.filter(x=>x.status!=='verified').length,
        documentaryEvidence:evidence.length,
        validatedEvidence:evidence.filter(x=>x.state==='validated').length,
        operationalConnections:0, // connectivity is verified separately by Fabric
        externalReportsSubmitted:0, // never claim regulatory submission
        state:'discovery-in-progress'
      },audit:this.q.audit.all(id),
      disclaimer:'Inventario y diagnóstico, no acreditación ni autorización operativa'
    }
  }
  poa({organizationId,period}){
    const id=ident(organizationId,'Organización');this._org(id)
    validMonth(period)
    const goals=this.q.goals.all(id).filter(x=>x.period===period)
    return this.registry.draftPOA({organizationId:id,period,
      goals:goals.map(x=>({goalId:x.goal_id,metricId:x.metric_id,title:x.title,target:x.target}))})
  }
  deployment(org){
    const dashboard=this.dashboard(org)
    const unitCounts=dashboard.units.reduce((a,x)=>({
      staff:a.staff+x.staffCount,workstations:a.workstations+x.workstations
    }),{staff:0,workstations:0})
    return {
      organization:dashboard.organization,planSummary:dashboard.planSummary,
      organizationalUnits:dashboard.units.map(u=>({...u,
        proposedInstanceIds:[dashboard.organization.organizationId+'.'+u.siteId+'.'+u.unitId]})),
      expectedStaffSlots:unitCounts.staff,
      inventoriedUnitWorkstations:unitCounts.workstations,
      estimatedCostByCurrencyAndRecurrence:dashboard.budgetByCurrencyAndPeriod,
      networks:dashboard.network,inference:dashboard.inference,
      providerFleet:dashboard.providers,
      manualDecisionsRequired:dashboard.missingQuestions.map(q=>q.category+'.'+q.key),
      status:'proposal-only',credentials:'never-in-plan',
      installation:'not-executed',liveConnections:'not-verified'
    }
  }
  recommendations(org,siteId=null){
    const id=ident(org,'Organización'),profile=this._org(id)
    const site=siteId??profile.workstations[0]?.siteId
    if(!profile.workstations.some(x=>x.siteId===site))throw Error('Sede inexistente')
    return suggestGenesisStructure(profile.organization.industry,site,
      this.q.units.all(id).map(x=>({unitId:x.unit_id})))
  }
  close(){this.db.close();this.registry.close()}
}
