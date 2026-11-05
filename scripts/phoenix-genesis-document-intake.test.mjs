import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,writeFileSync,appendFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GenesisWorkbench } from './phoenix-genesis-workbench.mjs'
import { createGenesisConsole } from './phoenix-genesis-console.mjs'
import {
  previewGenesisDocument,inspectGenesisDocument,
  listGenesisDocumentFindings,decideGenesisFinding
} from './phoenix-genesis-document-intake.mjs'

const ADMIN='d'.repeat(64)
const spec=()=>({organizationId:'hospital_demo',name:'Hospital de prueba',industry:'healthcare',
  adoptionMode:'hybrid',network:{mode:'isolated'},sites:[{
    siteId:'principal',name:'Sede central',workstations:10,
    reusableWorkstations:5,roles:[],software:[]
  }]})
const content=[
  '# Organigrama institucional de ejemplo',
  'Departamento: Farmacia',
  'Software: ERP hospitalario ficticio',
  'Comité: Calidad y seguridad',
  'Procedimiento: Revisión de equipos',
  'Informe: Producción mensual',
  'Camas: 24'
].join('\n')
function setup(text=content,name='organigrama.txt'){
  const root=mkdtempSync(join(tmpdir(),'genesis-doc-intake-'))
  const filePath=join(root,name),dbPath=join(root,'genesis.sqlite')
  writeFileSync(filePath,text)
  const store=new GenesisWorkbench(dbPath)
  store.createOrganization(spec())
  const evidence=store.registry.registerEvidence({
    organizationId:'hospital_demo',filePath,kind:'org_chart',validated:true
  })
  const input={organizationId:'hospital_demo',documentId:'manual_demo',
    evidenceId:evidence.evidenceId,filePath,documentKind:'org_chart'}
  return {root,dbPath,filePath,store,input,
    cleanup:()=>{store.close();rmSync(root,{recursive:true,force:true})}}
}
function docx(content){
  const name=Buffer.from('word/document.xml'),xml=Buffer.from(content)
  const local=Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50,0)
  local.writeUInt16LE(20,4)
  local.writeUInt16LE(0,8)
  local.writeUInt32LE(xml.length,18)
  local.writeUInt32LE(xml.length,22)
  local.writeUInt16LE(name.length,26)
  const central=Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50,0)
  central.writeUInt16LE(20,4)
  central.writeUInt16LE(20,6)
  central.writeUInt32LE(xml.length,20)
  central.writeUInt32LE(xml.length,24)
  central.writeUInt16LE(name.length,28)
  const eocd=Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50,0)
  eocd.writeUInt16LE(1,8)
  eocd.writeUInt16LE(1,10)
  eocd.writeUInt32LE(central.length+name.length,12)
  eocd.writeUInt32LE(local.length+name.length+xml.length,16)
  return Buffer.concat([local,name,xml,central,name,eocd])
}
test('documento institucional: vista previa, evidencia, aceptación y origen',()=>{
  const x=setup()
  try{
    const preview=previewGenesisDocument(x.store,x.input)
    assert.equal(preview.status,'preview-only')
    assert.equal(preview.findings.length,6)
    assert.equal(preview.findings[0].category,'unit')
    assert.equal(preview.findings[0].sourceLine,2)
    assert.equal(preview.contentStored,false)
    assert.equal(JSON.stringify(preview).includes('Organigrama institucional de ejemplo'),false)
    assert.equal(x.store.dashboard('hospital_demo').units.length,0)
    assert.throws(()=>listGenesisDocumentFindings(x.store,'hospital_demo','manual_demo'),
      /inexistente/)
    assert.throws(()=>inspectGenesisDocument(x.store,x.input),/autorización explícita/)
    const receipt=inspectGenesisDocument(x.store,{...x.input,approved:true})
    assert.equal(receipt.status,'indexed-pending-human-review')
    assert.equal(receipt.findings.length,6)
    assert.equal(inspectGenesisDocument(x.store,{...x.input,approved:true}).replayed,true)
    const stored=listGenesisDocumentFindings(x.store,'hospital_demo','manual_demo')
    assert.equal(stored.candidateCount,6)
    assert.equal(stored.findings[0].value,'Farmacia')
    assert.equal(stored.findings[0].status,'proposed-unverified')
    const decision=decideGenesisFinding(x.store,{
      organizationId:'hospital_demo',documentId:'manual_demo',findingId:'finding_001',
      decision:'accept',recordId:'farmacia',siteId:'principal',role:'pharmacy'
    })
    assert.equal(decision.status,'registered-unit')
    assert.equal(x.store.dashboard('hospital_demo').units[0].unitId,'farmacia')
    assert.equal(x.store.dashboard('hospital_demo').units[0].staffCount,0)
    const software=decideGenesisFinding(x.store,{
      organizationId:'hospital_demo',documentId:'manual_demo',findingId:'finding_002',
      decision:'accept',recordId:'erp_demo'
    })
    assert.equal(software.status,'registered-system-pending-authorization')
    assert.equal(x.store.dashboard('hospital_demo').systems[0].state,'pending-authorization')
    assert.equal(decideGenesisFinding(x.store,{
      organizationId:'hospital_demo',documentId:'manual_demo',findingId:'finding_003',
      decision:'reject'
    }).status,'rejected')
    assert.throws(()=>decideGenesisFinding(x.store,{
      organizationId:'hospital_demo',documentId:'manual_demo',findingId:'finding_001',
      decision:'accept',recordId:'repeat',siteId:'principal'
    }),/ya fue resuelto/)
    assert.equal(listGenesisDocumentFindings(x.store,'hospital_demo','manual_demo')
      .findings[0].status,'registered-unit')
  }finally{x.cleanup()}
})
test('DOCX OpenXML se procesa localmente sin servicio externo ni dependencias extra',()=>{
  const xml='<?xml version="1.0" encoding="UTF-8"?>'+
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
    '<w:body><w:p><w:r><w:t>Departamento: Ingeniería</w:t></w:r></w:p>'+
    '<w:p><w:r><w:t>Software: Sistema &amp; Archivo</w:t></w:r></w:p>'+
    '</w:body></w:document>'
  const x=setup(docx(xml),'organigrama.docx')
  try{
    const result=previewGenesisDocument(x.store,x.input)
    assert.equal(result.fileType,'.docx')
    assert.equal(result.extractionMethod,'local-docx-xml')
    assert.equal(result.findings.length,2)
    assert.equal(result.findings[0].value,'Ingeniería')
    assert.equal(result.findings[1].value,'Sistema & Archivo')
  }finally{x.cleanup()}
})
test('integridad SHA, PII y extensiones: bloquea datos privados o alterados',()=>{
  {
    const x=setup()
    try{
      appendFileSync(x.filePath,'\nUnidad: otra')
      assert.throws(()=>previewGenesisDocument(x.store,x.input),/cambió/)
    }finally{x.cleanup()}
  }
  for(const privateLine of ['Cédula: 000-123-3456','Correo: persona@example.com',
    'Password: clave_de_ejemplo']){
    const x=setup('Departamento: Farmacia\n'+privateLine)
    try{assert.throws(()=>previewGenesisDocument(x.store,x.input),
      /datos personales potenciales/)}
    finally{x.cleanup()}
  }
  const x=setup()
  try{
    assert.throws(()=>previewGenesisDocument(x.store,{
      ...x.input,organizationId:'otra_organizacion'}),/inexistente/)
    assert.throws(()=>previewGenesisDocument(x.store,{
      ...x.input,filePath:join(x.root,'no_autorizado.dwg')}),/TXT, MD, DOCX y PDF/)
  }finally{x.cleanup()}
})
test('aprobación de unidad inválida revierte hallazgo y no crea registros parciales',()=>{
  const x=setup()
  try{
    inspectGenesisDocument(x.store,{...x.input,approved:true})
    assert.throws(()=>decideGenesisFinding(x.store,{
      organizationId:'hospital_demo',documentId:'manual_demo',findingId:'finding_001',
      decision:'accept',recordId:'farmacia',siteId:'sede_ficticia'
    }),/Sede inexistente/)
    assert.equal(x.store.dashboard('hospital_demo').units.length,0)
    assert.equal(listGenesisDocumentFindings(x.store,'hospital_demo','manual_demo')
      .findings[0].status,'proposed-unverified')
  }finally{x.cleanup()}
})
test('API local: autenticación, revisión humana y alta real de departamento',async()=>{
  const root=mkdtempSync(join(tmpdir(),'genesis-doc-http-'))
  const filePath=join(root,'manual.txt')
  writeFileSync(filePath,'Departamento: Mantenimiento\nSistema: Inventario local')
  const app=createGenesisConsole({dbPath:join(root,'genesis.sqlite'),adminToken:ADMIN})
  const {url}=await app.start()
  const request=async(path,method='GET',data,token=ADMIN)=>{
    const response=await fetch(url+path,{method,headers:{
      authorization:'Bearer '+token,
      ...(data===undefined?{}:{'content-type':'application/json'})
    },...(data===undefined?{}:{body:JSON.stringify(data)})})
    return {status:response.status,body:await response.json()}
  }
  try{
    assert.equal((await request('/v1/organizations','POST',spec())).status,201)
    const ev=await request('/v1/evidence','POST',{
      organizationId:'hospital_demo',filePath,kind:'manual',validated:true
    })
    assert.equal(ev.status,201)
    const input={organizationId:'hospital_demo',documentId:'manual_prueba',
      evidenceId:ev.body.result.evidenceId,filePath,documentKind:'manual'}
    const denied=await fetch(url+'/v1/documents/preview',{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify(input)})
    assert.equal(denied.status,401)
    const preview=await request('/v1/documents/preview','POST',input)
    assert.equal(preview.status,200)
    assert.equal(preview.body.result.findings.length,2)
    assert.equal((await request('/v1/documents/inspect','POST',input)).status,400)
    assert.equal((await request('/v1/documents/inspect','POST',
      {...input,approved:true})).status,201)
    const findings=await request('/v1/documents/findings?organizationId=hospital_demo&documentId=manual_prueba')
    assert.equal(findings.status,200)
    assert.equal(findings.body.findings[0].category,'unit')
    const approve=await request('/v1/documents/decide','POST',{
      organizationId:'hospital_demo',documentId:'manual_prueba',
      findingId:'finding_001',decision:'accept',
      recordId:'mantenimiento',siteId:'principal',role:'facilities'
    })
    assert.equal(approve.status,200)
    assert.equal(approve.body.result.status,'registered-unit')
    const db=await request('/v1/dashboard?organizationId=hospital_demo')
    assert.equal(db.body.units[0].unitId,'mantenimiento')
    assert.equal(db.body.units[0].role,'facilities')
  }finally{await app.close();rmSync(root,{recursive:true,force:true})}
})
