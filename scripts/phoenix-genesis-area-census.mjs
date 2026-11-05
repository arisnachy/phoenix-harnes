/**
 * Genesis 360° — institutional area census built on the health v4 catalog.
 * Never assumes 60 services exist. No patient, personnel or payroll records.
 * Decisions stay per organization and can be reviewed without external AI.
 */
import { searchGenesisCatalog,genesisCatalogSummary } from './phoenix-genesis-healthcare-catalog.mjs'
const ID=/^[a-z][a-z0-9._-]{0,63}$/u
const STATES=new Set(['existing','outsourced','not-applicable','unknown'])
const REVIEWS=new Set(['declared','verified'])
function id(value,name){
  if(typeof value!=='string'||!ID.test(value))throw Error(name+' inválido')
  return value
}
function text(value,name,max=100){
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f<>]/u.test(value))
    throw Error(name+' inválido')
  if(/(?:@|password|contrase[nñ]a|cedula|c[eé]dula|token|n[oó]mina|salary)/iu.test(value))
    throw Error(name+' puede contener información sensible')
  return value.trim()
}
function truth(workbench,organizationId){
  const org=id(organizationId,'Organización')
  const profile=workbench.registry.organization(org)
  const info=genesisCatalogSummary(profile.organization.industry)
  if(!info.available)return {org,available:false,areas:[]}
  const result=searchGenesisCatalog({industry:profile.organization.industry,
    category:'areas',limit:100})
  if(result.rows.length!==60)throw Error('Catálogo hospitalario incompleto')
  return {org,available:true,areas:result.rows.map((r,i)=>({
    areaId:'area_'+String(i+1).padStart(3,'0'),
    domain:r[0],name:r[1],dataNeeded:r[2],expectedReports:r[3],
    templateMode:r[4],templateResponsible:r[5]
  }))}
}
function ensure(db){
  db.exec('CREATE TABLE IF NOT EXISTS genesis_area_census (org_id TEXT NOT NULL,area_id TEXT NOT NULL,state TEXT NOT NULL,review_state TEXT NOT NULL,reviewer_role TEXT NOT NULL,site_id TEXT,evidence_json TEXT NOT NULL,updated_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(org_id,area_id),FOREIGN KEY(org_id) REFERENCES organizations(org_id))')
  // Existing institution databases are upgraded without losing assessments.
  if(!db.prepare("PRAGMA table_info(genesis_area_census)").all()
    .some(row=>row.name==='revision'))
    db.exec('ALTER TABLE genesis_area_census ADD COLUMN revision INTEGER NOT NULL DEFAULT 1')
}
export function listGenesisAreaCensus(workbench,organizationId){
  const template=truth(workbench,organizationId)
  if(!template.available)return {organizationId:template.org,available:false,
    total:0,areas:[],summary:{reviewed:0,verified:0,notEvaluated:0},
    note:'Este sector no utiliza el censo hospitalario; Genesis Core sigue siendo universal'}
  ensure(workbench.db)
  const rows=workbench.db.prepare('SELECT area_id,state,review_state,reviewer_role,site_id,evidence_json,updated_at,revision FROM genesis_area_census WHERE org_id=?').all(template.org)
  const byId=new Map(rows.map(x=>[x.area_id,x]))
  const entries=template.areas.map(area=>{
    const row=byId.get(area.areaId)
    return {...area,
      state:row?.state??'not-evaluated',
      reviewState:row?.review_state??'unreviewed',
      reviewerRole:row?.reviewer_role??null,
      siteId:row?.site_id??null,
      evidenceRefs:row?JSON.parse(row.evidence_json):[],
      updatedAt:row?.updated_at??null,
      revision:row?.revision??0,
      source:'reference-catalog-v4',
      affectsRealInventory:false}
  })
  const counts={reviewed:rows.length,verified:rows.filter(x=>x.review_state==='verified').length,
    notEvaluated:60-rows.length,existing:rows.filter(x=>x.state==='existing').length,
    outsourced:rows.filter(x=>x.state==='outsourced').length,
    notApplicable:rows.filter(x=>x.state==='not-applicable').length,
    unknown:rows.filter(x=>x.state==='unknown').length}
  return {organizationId:template.org,available:true,total:60,areas:entries,summary:counts,
    note:'Las áreas son referencias de análisis; declarar existencia no instala ni conecta PHOENIX'}
}
export function assessGenesisArea(workbench,input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Evaluación inválida')
  const allowed=new Set(['organizationId','areaId','state','reviewState','reviewerRole','siteId','evidenceRefs','expectedRevision'])
  for(const k of Object.keys(input))if(!allowed.has(k))throw Error('Campo no permitido: '+k)
  const template=truth(workbench,input.organizationId)
  if(!template.available)throw Error('No corresponde aplicar el censo hospitalario a este sector')
  const areaId=id(input.areaId,'Área')
  if(!template.areas.some(x=>x.areaId===areaId))throw Error('Área fuera del catálogo')
  if(!STATES.has(input.state))throw Error('Estado de área inválido')
  const reviewState=input.reviewState??'declared'
  if(!REVIEWS.has(reviewState))throw Error('Estado de revisión inválido')
  const reviewerRole=text(input.reviewerRole,'Rol revisor')
  const evidence=input.evidenceRefs??[]
  if(!Array.isArray(evidence)||evidence.length>24||evidence.some(x=>!ID.test(x))||
    new Set(evidence).size!==evidence.length)throw Error('Referencias inválidas')
  if(reviewState==='verified'&&evidence.length===0)
    throw Error('Área verificada requiere evidencia autenticada')
  workbench.registry.validateEvidence(template.org,evidence)
  let siteId=null
  if(input.siteId!==null&&input.siteId!==undefined&&input.siteId!==''){
    siteId=id(input.siteId,'Sede')
    if(!workbench.registry.organization(template.org).workstations.some(x=>x.siteId===siteId))
      throw Error('Sede inexistente')
  }
  ensure(workbench.db)
  const now=new Date().toISOString(),org=template.org
  const db=workbench.db
  let revision
  db.exec('BEGIN IMMEDIATE')
  try{
    const previous=db.prepare('SELECT revision FROM genesis_area_census WHERE org_id=? AND area_id=?')
      .get(org,areaId)
    if(previous){
      if(input.expectedRevision!==previous.revision)
        throw Error('Conflicto de versión: el censo cambió; recárgalo antes de guardar')
      revision=previous.revision+1
      db.prepare('UPDATE genesis_area_census SET state=?,review_state=?,reviewer_role=?,site_id=?,evidence_json=?,updated_at=?,revision=? WHERE org_id=? AND area_id=?')
        .run(input.state,reviewState,reviewerRole,siteId,JSON.stringify(evidence),
          now,revision,org,areaId)
    }else{
      if(input.expectedRevision!==undefined&&input.expectedRevision!==0&&input.expectedRevision!==null)
        throw Error('Conflicto de versión: la evaluación aún no existe')
      revision=1
      db.prepare('INSERT INTO genesis_area_census(org_id,area_id,state,review_state,reviewer_role,site_id,evidence_json,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(org,areaId,input.state,reviewState,reviewerRole,siteId,
          JSON.stringify(evidence),now,revision)
    }
    workbench._audit(org,'area-assessed',areaId)
    db.exec('COMMIT')
  }catch(e){db.exec('ROLLBACK');throw e}
  return {organizationId:org,areaId,state:input.state,reviewState,evidenceRefs:evidence,
    siteId,updatedAt:now,revision,status:'recorded-for-organizational-review',
    installed:false,linkedPhoenixInstances:0}
}
