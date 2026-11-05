import test from 'node:test'
import assert from 'node:assert/strict'
import { makeFabricTask, planGenesisFabric } from './phoenix-genesis-fabric.mjs'

function hospital() {
  return {
    organizationId:'hospital_demo',name:'Hospital Ejemplo',industry:'hospital',
    adoptionMode:'hybrid',network:{mode:'lan'},
    sites:[{siteId:'santiago',name:'Sede central',workstations:40,
      reusableWorkstations:30,
      roles:[
        {roleId:'consulta',name:'Consulta',instances:4,
          capabilities:['appointments.read','prescriptions.request']},
        {roleId:'farmacia',name:'Farmacia',capabilities:['inventory.read']}
      ],
      software:[{systemId:'his',name:'HIS tradicional'}]
    }],
    costs:{workstationUsd:650},
    inference:{strategies:[{providerId:'local',execution:'local',monthlyBudgetUsd:500}]}
  }
}

test('dimensiona estaciones, instancias y costos sin mezclar cuentas con modelos',()=>{
  const result=planGenesisFabric(hospital())
  assert.equal(result.summary.workstationsToAcquire,10)
  assert.equal(result.summary.logicalInstances,5)
  assert.equal(result.summary.estimatedWorkstationCapexUsd,6500)
  assert.equal(result.network.transport,'private-lan-mtls')
  assert.equal(result.network.connectionState,'not-connected')
  assert.equal(result.network.publicIngressAllowed,false)
  assert.equal(result.network.autoScanAllowed,false)
  assert.equal(result.existingSoftware[0].authority,'source-system-until-explicit-cutover')
  assert.equal(result.inference.strategies[0].credentials,'not-in-plan')
})
test('universo abierto: cambia de industria sin reescribir el núcleo',()=>{
  const input=hospital()
  input.industry='universidad'
  input.sites[0].roles=[{roleId:'biblioteca',name:'Biblioteca',
    capabilities:['books.reserve']}]
  const plan=planGenesisFabric(input)
  assert.equal(plan.organization.industry,'universidad')
  assert.equal(plan.instances[0].capabilities[0],'books.reserve')
})
test('no inventa el precio cuando no existe una cotización',()=>{
  const input=hospital()
  delete input.costs
  assert.equal(planGenesisFabric(input).summary.estimatedWorkstationCapexUsd,null)
})
test('rechaza sedes y roles duplicados',()=>{
  const a=hospital()
  a.sites.push(structuredClone(a.sites[0]))
  assert.throws(()=>planGenesisFabric(a),/Sede duplicado/)
  const b=hospital()
  b.sites[0].roles.push(structuredClone(b.sites[0].roles[0]))
  assert.throws(()=>planGenesisFabric(b),/Función duplicado/)
})
test('no permite reutilizar más estaciones que las registradas',()=>{
  const input=hospital()
  input.sites[0].reusableWorkstations=41
  assert.throws(()=>planGenesisFabric(input),/No se pueden reutilizar/)
})
test('la LAN y la modalidad aislada no autorizan enlaces entre sedes',()=>{
  for(const mode of ['lan','isolated']){
    const input=hospital()
    input.network={mode,peers:[{from:'santiago',to:'capital',approved:true,
      peerFingerprint:'a'.repeat(64)}]}
    input.sites.push({siteId:'capital',name:'Otra sede',workstations:3,
      reusableWorkstations:3,roles:[]})
    assert.throws(()=>planGenesisFabric(input),/exigen overlay o relay/)
  }
})
test('conexión externa requiere consentimiento y huella de par',()=>{
  const input=hospital()
  input.sites.push({siteId:'capital',name:'Otra sede',workstations:3,
    reusableWorkstations:3,roles:[]})
  input.network={mode:'overlay',peers:[{from:'santiago',to:'capital',
    approved:false,peerFingerprint:'a'.repeat(64)}]}
  assert.throws(()=>planGenesisFabric(input),/aprobación explícita/)
  input.network.peers[0].approved=true
  input.network.peers[0].peerFingerprint='no-es-huella'
  assert.throws(()=>planGenesisFabric(input),/huella SHA-256/)
  input.network.peers[0].peerFingerprint='a'.repeat(64)
  const plan=planGenesisFabric(input)
  assert.equal(plan.network.transport,'private-overlay-mtls')
  assert.equal(plan.network.peers[0].connectionState,'not-connected')
  assert.equal(plan.network.peers[0].enrollment,'pending-mutual-authentication')
})
test('el relay solo planifica canales salientes autenticados',()=>{
  const input=hospital()
  input.network={mode:'relay'}
  assert.equal(planGenesisFabric(input).network.transport,'outbound-relay-mtls')
  assert.equal(planGenesisFabric(input).network.publicIngressAllowed,false)
})
test('la tarea queda sin enviar y pendiente de aprobación profesional',()=>{
  const task=makeFabricTask({taskId:'order1',organizationId:'hospital_demo',
    sourceInstanceId:'consulta1',targetCapability:'inventory.reserve',
    idempotencyKey:'req1',purpose:'Reserva de medicamento autorizado',
    requestedAt:'2026-11-04T20:00:00-04:00',references:['rx1'],
    requiresApproval:true})
  assert.equal(task.state,'pending-approval')
  assert.equal(task.transportStatus,'not-sent')
  assert.equal(task.requestedAt,'2026-11-05T00:00:00.000Z')
  assert.deepEqual(task.references,['rx1'])
})
test('el bus no acepta datos clínicos completos o credenciales',()=>{
  const base={taskId:'task1',organizationId:'org1',sourceInstanceId:'nurse1',
    targetCapability:'stock.check',idempotencyKey:'key1',purpose:'Inventario',
    requestedAt:'2026-11-04T20:00:00Z',references:[],requiresApproval:false}
  for(const key of ['patient','credentials','payload'])
    assert.throws(()=>makeFabricTask({...base,[key]:{secret:'test'}}),
      /No enviar datos sensibles/)
  assert.equal(makeFabricTask(base).state,'pending-authorization')
})
test('no acepta funciones, redes o modos de adopción desconocidos',()=>{
  const a=hospital();a.network.mode='public'
  assert.throws(()=>planGenesisFabric(a),/Modo de red desconocido/)
  const b=hospital();b.adoptionMode='all-access'
  assert.throws(()=>planGenesisFabric(b),/Modo de adopción desconocido/)
})

test('impide planes de instancias descontrolados',()=>{
  const input=hospital()
  input.sites[0].roles=Array.from({length:11},(_,i)=>({
    roleId:'role'+i,name:'Area '+i,instances:1000,capabilities:[]
  }))
  assert.throws(()=>planGenesisFabric(input),/excede 10 000 instancias/)
})
