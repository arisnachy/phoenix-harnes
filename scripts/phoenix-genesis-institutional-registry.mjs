/**
 * PHOENIX Genesis evidence and planning registry, offline Node 24+.
 *
 * Stores a verified organizational snapshot, evidence fingerprints and
 * traceable operational measurements. Never stores raw CVs, PDFs, clinical
 * records or secrets. POA drafts do not claim official regulatory compliance.
 */
import { DatabaseSync } from 'node:sqlite'
import { createHash,randomUUID } from 'node:crypto'
import { mkdirSync,readFileSync,statSync } from 'node:fs'
import { dirname,basename } from 'node:path'
import { planGenesisFabric } from './phoenix-genesis-fabric.mjs'

const ID=/^[a-z][a-z0-9._-]{0,63}$/u
const sensitive=/(?:patient|diagnos|historia.clinic|birth|cedula|password|secret|api.key|curricul|salary|nomina|ssn)/iu
function ident(v,label){
  if(typeof v!=='string'||!ID.test(v))throw Error(label+' inválido')
  return v
}
function description(v,label){
  if(typeof v!=='string'||!v.trim()||v.length>180||/[\u0000-\u001f]/u.test(v))
    throw Error(label+' inválido')
  return v.trim()
}
function plain(v,label){
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error(label+' inválido')
  return v
}
function references(v,label){
  if(!Array.isArray(v)||v.length>64)throw Error(label+' inválido')
  const out=v.map(x=>ident(x,label))
  if(new Set(out).size!==out.length)throw Error(label+' duplicado')
  return out
}
function sensibleSafe(v){
  const json=JSON.stringify(v)
  if(json===undefined||json.length>8192||sensitive.test(json))
    throw Error('Metadatos no admiten información personal o sensible')
  return json
}
function finite(v,label){
  if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12)
    throw Error(label+' debe ser un número finito')
  return v
}
function normalizePeriod(v){
  if(typeof v!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(v))
    throw Error('Periodo requerido YYYY-MM')
  return v
}
function hash(data){return createHash('sha256').update(data).digest('hex')}
export class GenesisInstitutionalRegistry{
  constructor(dbPath){
    if(typeof dbPath!=='string'||!dbPath)throw Error('dbPath obligatorio')
    mkdirSync(dirname(dbPath),{recursive:true,mode:0o700})
    this.db=new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
    this.db.exec([
      'CREATE TABLE IF NOT EXISTS organizations(org_id TEXT PRIMARY KEY,profile TEXT NOT NULL,created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS evidence(evidence_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,kind TEXT NOT NULL,file_name TEXT NOT NULL,digest TEXT NOT NULL,sensitivity TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(org_id) REFERENCES organizations(org_id));',
      'CREATE TABLE IF NOT EXISTS resources(org_id TEXT NOT NULL,resource_id TEXT NOT NULL,site_id TEXT NOT NULL,kind TEXT NOT NULL,label TEXT NOT NULL,metadata TEXT NOT NULL,evidence_refs TEXT NOT NULL,PRIMARY KEY(org_id,resource_id),FOREIGN KEY(org_id) REFERENCES organizations(org_id));',
      'CREATE TABLE IF NOT EXISTS measures(org_id TEXT NOT NULL,metric_id TEXT NOT NULL,period TEXT NOT NULL,numerator REAL NOT NULL,denominator REAL,unit TEXT NOT NULL,evidence_refs TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(org_id,metric_id,period),FOREIGN KEY(org_id) REFERENCES organizations(org_id));'
    ].join('\n'))
    this.q={
      org:this.db.prepare('SELECT * FROM organizations WHERE org_id=?'),
      createOrg:this.db.prepare('INSERT INTO organizations(org_id,profile,created_at) VALUES(?,?,?)'),
      evidence:this.db.prepare('SELECT * FROM evidence WHERE evidence_id=? AND org_id=?'),
      addEvidence:this.db.prepare('INSERT INTO evidence(evidence_id,org_id,kind,file_name,digest,sensitivity,state,created_at) VALUES(?,?,?,?,?,?,?,?)'),
      allEvidence:this.db.prepare('SELECT evidence_id,kind,file_name,digest,sensitivity,state,created_at FROM evidence WHERE org_id=? ORDER BY created_at'),
      addResource:this.db.prepare('INSERT INTO resources(org_id,resource_id,site_id,kind,label,metadata,evidence_refs) VALUES(?,?,?,?,?,?,?)'),
      allResources:this.db.prepare('SELECT resource_id,site_id,kind,label,metadata,evidence_refs FROM resources WHERE org_id=? ORDER BY resource_id'),
      addMeasure:this.db.prepare('INSERT INTO measures(org_id,metric_id,period,numerator,denominator,unit,evidence_refs,created_at) VALUES(?,?,?,?,?,?,?,?)'),
      allMeasures:this.db.prepare('SELECT metric_id,period,numerator,denominator,unit,evidence_refs FROM measures WHERE org_id=? AND period=? ORDER BY metric_id')
    }
  }
  organization(org){
    const record=this.q.org.get(ident(org,'Organización'))
    if(!record)throw Error('Organización inexistente')
    return JSON.parse(record.profile)
  }
  registerOrganization(input){
    const plan=planGenesisFabric(input)
    const id=plan.organization.organizationId
    if(this.q.org.get(id))throw Error('Organización ya registrada')
    this.q.createOrg.run(id,JSON.stringify(plan),new Date().toISOString())
    return plan
  }
  validateEvidence(org,refs){
    for(const ref of references(refs,'Evidencia')){
      const record=this.q.evidence.get(ref,org)
      if(!record||record.state!=='validated')
        throw Error('Evidencia no validada o ajena a la organización: '+ref)
    }
  }
  registerEvidence({organizationId,filePath,kind,fileName,classification='internal',validated=false}){
    const org=ident(organizationId,'Organización')
    this.organization(org)
    ident(kind,'Tipo de evidencia')
    if(!['public','internal','restricted'].includes(classification))
      throw Error('Clasificación inválida')
    if(validated!==true&&validated!==false)throw Error('Validación inválida')
    // A local operator intentionally selects the source file. Only its hash
    // and metadata are retained; no raw content is duplicated into SQLite.
    const source=statSync(filePath)
    if(!source.isFile()||source.size>20*1024*1024)throw Error('Archivo inválido o demasiado grande')
    const digest=hash(readFileSync(filePath))
    const evidenceId='ev_'+randomUUID().replaceAll('-','')
    const display=description(fileName??basename(filePath),'Nombre de documento')
    this.q.addEvidence.run(evidenceId,org,kind,display,digest,
      classification,validated?'validated':'pending-validation',new Date().toISOString())
    return {evidenceId,organizationId:org,kind,fileName:display,digest,
      classification,state:validated?'validated':'pending-validation'}
  }
  addResource({organizationId,resourceId,siteId,kind,label,metadata={},evidenceRefs=[]}){
    const org=ident(organizationId,'Organización')
    const plan=this.organization(org)
    ident(resourceId,'Recurso');ident(siteId,'Sede');ident(kind,'Tipo de recurso')
    if(!plan.workstations.some(site=>site.siteId===siteId))
      throw Error('Sede desconocida')
    plain(metadata,'Metadatos')
    const encoded=sensibleSafe(metadata)
    this.validateEvidence(org,evidenceRefs)
    this.q.addResource.run(org,resourceId,siteId,kind,description(label,'Nombre'),
      encoded,JSON.stringify(evidenceRefs))
    return {resourceId,organizationId:org,siteId,kind,state:'registered'}
  }
  recordIndicator({organizationId,metricId,period,numerator,denominator=null,
    unit='count',evidenceRefs=[]}){
    const org=ident(organizationId,'Organización')
    this.organization(org)
    ident(metricId,'Indicador');normalizePeriod(period)
    finite(numerator,'Numerador')
    if(denominator!==null){
      finite(denominator,'Denominador')
      if(denominator<=0)throw Error('Denominador debe ser positivo')
    }
    ident(unit,'Unidad')
    this.validateEvidence(org,evidenceRefs)
    if(evidenceRefs.length===0)throw Error('Indicador sin respaldo documental')
    const value=denominator===null?numerator:numerator/denominator
    if(!Number.isFinite(value))throw Error('Indicador fuera de rango')
    this.q.addMeasure.run(org,metricId,period,numerator,denominator,
      unit,JSON.stringify(evidenceRefs),new Date().toISOString())
    return {metricId,period,value,unit,evidenceRefs,status:'recorded'}
  }
  draftPOA({organizationId,period,goals}){
    const org=ident(organizationId,'Organización')
    const organization=this.organization(org).organization
    normalizePeriod(period)
    if(!Array.isArray(goals)||goals.length>150)throw Error('Metas inválidas')
    const measures=this.q.allMeasures.all(org,period)
    const byMetric=new Map(measures.map(m=>[m.metric_id,m]))
    const entries=goals.map(g=>{
      plain(g,'Meta')
      const goalId=ident(g.goalId,'Meta'),metricId=ident(g.metricId,'Indicador')
      const title=description(g.title,'Objetivo')
      const target=finite(g.target,'Meta objetivo')
      const observed=byMetric.get(metricId)
      return {
        goalId,title,metricId,target,
        actual:observed?(observed.denominator===null?observed.numerator:
          observed.numerator/observed.denominator):null,
        evidenceRefs:observed?JSON.parse(observed.evidence_refs):[],
        status:observed?'measurement-available':'missing-verified-measurement',
        approval:'pending-human-approval'
      }
    })
    if(new Set(entries.map(x=>x.goalId)).size!==entries.length)
      throw Error('Meta duplicada')
    return {schemaVersion:'1.0',type:'POA-DRAFT',
      organization,period,generatedAt:new Date().toISOString(),
      entries,source:'validated-organizational-measurements',
      disclaimer:'Borrador para revisión humana; NO es entrega regulatoria ni POA oficial'}
  }
  snapshot(organizationId){
    const org=ident(organizationId,'Organización')
    return {organization:this.organization(org).organization,
      resources:this.q.allResources.all(org).map(row=>({
        ...row,metadata:JSON.parse(row.metadata),
        evidence_refs:JSON.parse(row.evidence_refs)})),
      evidence:this.q.allEvidence.all(org)}
  }
  close(){this.db.close()}
}
