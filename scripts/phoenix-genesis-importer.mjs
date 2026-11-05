/**
 * Genesis safe structured institutional import.
 * Imports only aggregate data with a separately attested evidence reference.
 * No CV, payroll line item, health record, secret, raw PDF or CAD is ingested.
 */
import { createHash } from 'node:crypto'

const id=/^[a-z][a-z0-9._-]{0,63}$/u
const FIELDS=new Set(['schemaVersion','manifestId','organizationId','evidenceId',
  'facts','units','systems','costs','goals','obligations'])
const TYPES={
  facts:new Set(['category','key','value','status']),
  units:new Set(['unitId','siteId','name','parentId','staffCount','workstations','role']),
  systems:new Set(['systemId','name','method','ownerUnit']),
  costs:new Set(['itemId','label','category','quantity','unitPrice','currency','recurrence']),
  goals:new Set(['goalId','title','metricId','period','target','ownerUnit']),
  obligations:new Set(['obligationId','recipient','title','periodicity','templateVersion'])
}
function object(v,label){
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error(label+' debe ser objeto')
  return v
}
function knownKeys(v,allowed,label){
  for(const k of Object.keys(v))if(!allowed.has(k))
    throw Error(label+' incluye campo no permitido: '+k)
}
function array(v,label){
  if(v===undefined)return []
  if(!Array.isArray(v)||v.length>100)throw Error(label+' fuera de rango')
  return v
}
function sum(receipt,kind,n){receipt.counts[kind]=n}
export function importGenesisManifest(workbench,input){
  const m=object(input,'Manifiesto')
  knownKeys(m,FIELDS,'Manifiesto')
  if(m.schemaVersion!=='1.0')throw Error('Versión de esquema desconocida')
  if(!id.test(m.manifestId)||!id.test(m.organizationId)||
    !id.test(m.evidenceId))throw Error('Identificadores inválidos')
  workbench.registry.organization(m.organizationId)
  workbench.registry.validateEvidence(m.organizationId,[m.evidenceId])
  const contents={}
  let total=0
  for(const [name,allowed] of Object.entries(TYPES)){
    contents[name]=array(m[name],name)
    total+=contents[name].length
    for(const entry of contents[name]){
      object(entry,name)
      knownKeys(entry,allowed,name)
    }
  }
  if(total>400)throw Error('Manifiesto supera 400 registros')
  const source=JSON.stringify(m)
  if(source.length>65536)throw Error('Manifiesto demasiado grande')
  const digest=createHash('sha256').update(source).digest('hex')
  const db=workbench.db
  db.exec('CREATE TABLE IF NOT EXISTS genesis_import_batches(org_id TEXT NOT NULL,manifest_id TEXT NOT NULL,source_evidence TEXT NOT NULL,source_digest TEXT NOT NULL,created_at TEXT NOT NULL,counts_json TEXT NOT NULL,PRIMARY KEY(org_id,manifest_id))')
  const find=db.prepare('SELECT * FROM genesis_import_batches WHERE org_id=? AND manifest_id=?')
  const save=db.prepare('INSERT INTO genesis_import_batches(org_id,manifest_id,source_evidence,source_digest,created_at,counts_json) VALUES(?,?,?,?,?,?)')
  const previous=find.get(m.organizationId,m.manifestId)
  if(previous){
    if(previous.source_digest!==digest)throw Error('Conflicto: mismo manifestId con datos distintos')
    return {manifestId:m.manifestId,organizationId:m.organizationId,
      replayed:true,counts:JSON.parse(previous.counts_json),
      status:'already-imported-no-duplicate-effects'}
  }
  const receipt={manifestId:m.manifestId,organizationId:m.organizationId,
    evidenceId:m.evidenceId,replayed:false,counts:{},
    status:'imported-for-human-review-not-deployed'}
  db.exec('BEGIN IMMEDIATE')
  try{
    for(const entry of contents.facts)
      workbench.answer({...entry,organizationId:m.organizationId,
        status:entry.status??'declared',evidenceRefs:[m.evidenceId]})
    sum(receipt,'facts',contents.facts.length)
    // Import parent units before their children, even if manifest is unordered.
    let pending=[...contents.units]
    let rounds=0
    while(pending.length){
      if(++rounds>101)throw Error('Jerarquía cíclica o padre inexistente')
      const next=[]
      let progressed=0
      for(const entry of pending){
        if(entry.parentId&&!workbench.q.unit.get(m.organizationId,entry.parentId)){
          next.push(entry);continue
        }
        workbench.unit({...entry,organizationId:m.organizationId})
        progressed++
      }
      if(progressed===0)throw Error('Jerarquía cíclica o padre inexistente')
      pending=next
    }
    sum(receipt,'units',contents.units.length)
    for(const entry of contents.systems)
      workbench.system({...entry,organizationId:m.organizationId})
    sum(receipt,'systems',contents.systems.length)
    for(const entry of contents.costs)
      workbench.cost({...entry,organizationId:m.organizationId,
        evidenceRefs:[m.evidenceId]})
    sum(receipt,'costs',contents.costs.length)
    for(const entry of contents.goals)
      workbench.goal({...entry,organizationId:m.organizationId})
    sum(receipt,'goals',contents.goals.length)
    for(const entry of contents.obligations)
      workbench.obligation({...entry,organizationId:m.organizationId})
    sum(receipt,'obligations',contents.obligations.length)
    save.run(m.organizationId,m.manifestId,m.evidenceId,digest,
      new Date().toISOString(),JSON.stringify(receipt.counts))
    workbench._audit(m.organizationId,'manifest-imported',m.manifestId)
    db.exec('COMMIT')
    return receipt
  }catch(error){
    db.exec('ROLLBACK')
    throw error
  }
}
