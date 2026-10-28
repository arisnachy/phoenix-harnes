import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HealthClinicStore } from '../src/health-store.ts'

const PASSWORD = 'a-long-operator-only-master-password-2026'
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'phoenix-health-test-'))
  let db=new HealthClinicStore(join(root,'clinic.sqlite'))
  t.after(()=>{db.close();rmSync(root,{recursive:true,force:true})})
  db.initialize('clinicaladmin',PASSWORD,'Hospital de pruebas')
  const admin=db.login('clinicaladmin',PASSWORD)
  return {db,admin,root}
}
test('real SQLite encrypted record persists across restart and plaintext is absent',t=>{
  const f=fixture(t)
  const actor=f.admin.actor
  const patient=f.db.create(actor,'patients',{name:'NombreReservadoUnicoFicticioXYZ',
    dateOfBirth:'2001-02-03',email:'test@example.com',emailConsent:false})
  assert.equal(f.db.list(actor,'patients')[0].name,'NombreReservadoUnicoFicticioXYZ')
  const dbFile=join(f.root,'clinic.sqlite')
  assert(!readFileSync(dbFile).includes(Buffer.from('NombreReservadoUnicoFicticioXYZ')))
  f.db.close()
  f.db=new HealthClinicStore(dbFile)
  assert.throws(()=>f.db.session(f.admin.cookie),/caducada/)
  assert.throws(()=>f.db.login('clinicaladmin','incorrect password'),/Credenciales/)
  const restored=f.db.login('clinicaladmin',PASSWORD)
  assert.equal(f.db.list(restored.actor,'patients')[0].id,patient.id)
  assert.equal(f.db.list(restored.actor,'patients')[0].name,'NombreReservadoUnicoFicticioXYZ')
})
test('staff permissions isolate clinical operations and require signed encounters',t=>{
  const {db,admin}=fixture(t)
  db.createStaff(admin.actor,{username:'doctor1',password:'another-secure-password-2026',role:'clinician'})
  db.createStaff(admin.actor,{username:'labuser',password:'another-secure-password-2026',role:'lab'})
  db.createStaff(admin.actor,{username:'radiouser',password:'another-secure-password-2026',role:'radiology'})
  db.createStaff(admin.actor,{username:'reception1',password:'another-secure-password-2026',role:'reception'})
  const doctor=db.login('doctor1','another-secure-password-2026').actor
  const lab=db.login('labuser','another-secure-password-2026').actor
  const radiology=db.login('radiouser','another-secure-password-2026').actor
  const reception=db.login('reception1','another-secure-password-2026').actor
  const patient=db.create(reception,'patients',{name:'Paciente de prueba',dateOfBirth:'1985-01-01'})
  const visit=db.create(doctor,'encounters',{patientId:patient.id,complaint:'Molestia simulada',specialty:'Medicina familiar',mode:'mixed'})
  assert.throws(()=>db.create(doctor,'orders',{encounterId:visit.id,description:'Hemograma',modality:'laboratory'}),/firmar/)
  assert.throws(()=>db.create(reception,'prescriptions',{encounterId:visit.id,medication:'Medicamento',directions:'Dosis'}),/Permiso/)
  assert.equal(db.list(lab,'patients').length,0)
})
test('clinical revision and signing enforce concurrency and professional ownership',t=>{
  const {db,admin}=fixture(t)
  db.createStaff(admin.actor,{username:'doctor1',password:'another-secure-password-2026',role:'clinician'})
  db.createStaff(admin.actor,{username:'doctor2',password:'another-secure-password-2026',role:'clinician'})
  const d=db.login('doctor1','another-secure-password-2026').actor
  const other=db.login('doctor2','another-secure-password-2026').actor
  const p=db.create(admin.actor,'patients',{name:'Paciente',dateOfBirth:'1980-01-01'})
  let e=db.create(d,'encounters',{patientId:p.id,specialty:'General',complaint:'Control',mode:'manual'})
  assert.throws(()=>db.update(d,'encounters',e.id,e.version,{action:'sign'}),/revisada/)
  e=db.update(d,'encounters',e.id,e.version,{action:'document',history:'Anamnesis registrada',exam:'Sin datos ficticios'})
  assert.throws(()=>db.update(other,'encounters',e.id,e.version,{action:'review'}),/otro profesional/)
  e=db.update(d,'encounters',e.id,e.version,{action:'review'})
  assert.throws(()=>db.update(d,'encounters',e.id,e.version-1,{action:'sign'}),/Conflicto/)
  e=db.update(d,'encounters',e.id,e.version,{action:'sign'})
  assert.equal(e.signedBy,'doctor1')
  assert.throws(()=>db.update(d,'encounters',e.id,e.version,{action:'document',history:'Edit'}),/firmada/)
  let order=db.create(d,'orders',{encounterId:e.id,modality:'laboratory',description:'Control de laboratorio'})
  const med=db.create(d,'prescriptions',{encounterId:e.id,medication:'Medicamento',directions:'Plan revisado'})
  assert.equal(med.signedBy,'doctor1')
  db.createStaff(admin.actor,{username:'labuser',password:'another-secure-password-2026',role:'lab'})
  const lab=db.login('labuser','another-secure-password-2026').actor
  order=db.update(lab,'orders',order.id,order.version,{action:'result',result:'Informe validado'})
  assert.equal(order.status,'resulted')
  order=db.update(d,'orders',order.id,order.version,{action:'review'})
  assert.equal(order.reviewedBy,'doctor1')
  assert(db.audits(admin.actor).some(x=>x.action==='encounters.update'))
})
test('CSRF, organization, collision and role gates are enforced',t=>{
  const {db,admin}=fixture(t)
  assert.throws(()=>db.session(admin.cookie,'wrong',true),/CSRF/)
  const act=db.session(admin.cookie,admin.csrf,true).actor
  assert.equal(act.role,'admin')
  const patient=db.create(admin.actor,'patients',{name:'Paciente válido',dateOfBirth:'1992-06-02'})
  db.create(admin.actor,'appointments',{patientId:patient.id,practitioner:'doctor1',startsAt:'2026-11-20T13:00:00Z',reason:'Control'})
  assert.throws(()=>db.create(admin.actor,'appointments',{patientId:patient.id,practitioner:'doctor1',startsAt:'2026-11-20T13:00:00Z',reason:'Repetida'}),/ya tiene/)
  const byOrg={...admin.actor,org:'another-institution'}
  assert.deepEqual(db.list(byOrg,'patients'),[])
  assert.throws(()=>db.create(byOrg,'encounters',{patientId:patient.id,specialty:'General',complaint:'Prueba'}))
})
