import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,writeFileSync,appendFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GenesisWorkbench } from './phoenix-genesis-workbench.mjs'
import { importGenesisLegacyCsv,previewGenesisLegacyCsv } from './phoenix-genesis-legacy-csv.mjs'

function spec(){
  return {
    organizationId:'hospital_demo',name:'Hospital de prueba',industry:'healthcare',
    adoptionMode:'hybrid',network:{mode:'lan'},
    sites:[{siteId:'principal',name:'Principal',workstations:10,
      reusableWorkstations:7,roles:[],software:[]}]
  }
}
function setup(contents){
  const root=mkdtempSync(join(tmpdir(),'genesis-legacy-csv-'))
  const csv=join(root,'legacy-export.csv')
  writeFileSync(csv,contents,'utf8')
  const store=new GenesisWorkbench(join(root,'genesis.sqlite'))
  store.createOrganization(spec())
  const ev=store.registry.registerEvidence({
    organizationId:'hospital_demo',filePath:csv,kind:'legacy_export',validated:true
  })
  return {root,csv,store,evidenceId:ev.evidenceId,
    clean:()=>{store.close();rmSync(root,{recursive:true,force:true})}}
}
function base(x,kind,mapping,batchId='legacy_202611'){
  return {organizationId:'hospital_demo',evidenceId:x.evidenceId,
    filePath:x.csv,kind,batchId,mapping}
}
test('CSV real: vista previa, comillas, jerarquía, transacción e idempotencia',()=>{
  const x=setup('id,sede,area,superior,dotacion,pc,funcion\r\n'+
    'farmacia,principal,"Farmacia, central",direccion,4,2,pharmacy\r\n'+
    'direccion,principal,Dirección,,3,3,admin\r\n')
  try{
    const input=base(x,'units',{unitId:'id',siteId:'sede',name:'area',
      parentId:'superior',staffCount:'dotacion',workstations:'pc',role:'funcion'})
    const first=previewGenesisLegacyCsv(x.store,input)
    assert.equal(first.count,2)
    assert.equal(first.state,'preview-only')
    assert.equal(x.store.dashboard('hospital_demo').units.length,0)
    assert.throws(()=>importGenesisLegacyCsv(x.store,input),/aprobación explícita/)
    const done=importGenesisLegacyCsv(x.store,{...input,approved:true})
    assert.equal(done.state,'imported-pending-human-review')
    assert.equal(done.replayed,false)
    const units=x.store.dashboard('hospital_demo').units
    assert.equal(units.length,2)
    assert.equal(units.find(y=>y.unitId==='farmacia').name,'Farmacia, central')
    assert.equal(units.find(y=>y.unitId==='farmacia').parentId,'direccion')
    const second=importGenesisLegacyCsv(x.store,{...input,approved:true})
    assert.equal(second.replayed,true)
    assert.equal(x.store.dashboard('hospital_demo').units.length,2)
    assert.throws(()=>importGenesisLegacyCsv(x.store,{...input,
      batchId:'legacy_202611',mapping:{...input.mapping,role:'area'},approved:true}),
      /Lote CSV ya usado/)
  }finally{x.clean()}
})
test('reversión integral cuando el software tradicional exporta una sede inválida',()=>{
  const x=setup('id,sede,area\nfarmacia,principal,Farmacia\ninventario,otra_sede,Almacén\n')
  try{
    const input={...base(x,'units',{unitId:'id',siteId:'sede',name:'area'}),approved:true}
    assert.throws(()=>importGenesisLegacyCsv(x.store,input),/Sede inexistente/)
    assert.equal(x.store.dashboard('hospital_demo').units.length,0)
    assert.equal(x.store.dashboard('hospital_demo').audit.filter(a=>a.action==='unit-upsert').length,0)
  }finally{x.clean()}
})
test('se rechazan archivos alterados y no validados después de tomar su huella',()=>{
  const x=setup('id,sede,area\nfarmacia,principal,Farmacia\n')
  try{
    const input=base(x,'units',{unitId:'id',siteId:'sede',name:'area'})
    appendFileSync(x.csv,'nuevo,principal,Otra área\n')
    assert.throws(()=>previewGenesisLegacyCsv(x.store,input),/ha cambiado/)
    const wrong={...input,organizationId:'otra_org'}
    assert.throws(()=>previewGenesisLegacyCsv(x.store,wrong),/requiere evidencia/)
  }finally{x.clean()}
})
test('los CSV con datos personales, columnas duplicadas y comillas corruptas no se importan',()=>{
  for(const bad of [
    'id,cedula,sede,area\nfarmacia,1234,principal,Farmacia\n',
    'id,id,sede,area\nfarmacia,otro,principal,Farmacia\n',
    'id,sede,area\nfarmacia,principal,"Campo no cerrado\n'
  ]){
    const x=setup(bad)
    try{
      assert.throws(()=>previewGenesisLegacyCsv(x.store,
        base(x,'units',{unitId:'id',siteId:'sede',name:'area'})))
      assert.equal(x.store.dashboard('hospital_demo').units.length,0)
    }finally{x.clean()}
  }
})
test('sistemas tradicionales quedan sin conectar aunque se importen',()=>{
  const x=setup('identificador,nombre,metodo\nhis_1,Sistema heredado,fhir\n')
  try{
    const done=importGenesisLegacyCsv(x.store,{
      ...base(x,'systems',{systemId:'identificador',name:'nombre',method:'metodo'}),
      approved:true})
    assert.equal(done.count,1)
    const sys=x.store.dashboard('hospital_demo').systems[0]
    assert.equal(sys.method,'fhir')
    assert.equal(sys.state,'pending-authorization')
    assert.equal(done.connectedToExternalSystem,false)
  }finally{x.clean()}
})
test('datos financieros importados solo con importes declarados y fuentes verificadas',()=>{
  const x=setup('id,concepto,categoria,cantidad,precio,divisa,periodicidad\n'+
    'servidor,Servidor,hardware,2,750.50,USD,one-time\n')
  try{
    importGenesisLegacyCsv(x.store,{...base(x,'costs',{
      itemId:'id',label:'concepto',category:'categoria',
      quantity:'cantidad',unitPrice:'precio',
      currency:'divisa',recurrence:'periodicidad'
    }),approved:true})
    assert.equal(x.store.dashboard('hospital_demo').budgetByCurrencyAndPeriod['USD:one-time'],1501)
  }finally{x.clean()}
})
