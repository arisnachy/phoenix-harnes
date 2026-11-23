import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,readFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Script } from 'node:vm'
import { HealthClinicStore } from '../src/health-store.ts'
import { renderHealthPage } from '../src/health-ui.ts'
import { renderHealthPatientPage } from '../src/health-patient-page.ts'

const PASSWORD='operator-master-password-long-2026'
const PATIENT_PASSWORD='patient-extra-long-private-password'
const DOCTOR_PASSWORD='clinician-extra-long-password'
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'healthia-portal-pilot-'))
  const store=new HealthClinicStore(join(root,'clinic.sqlite'))
  t.after(()=>{try{store.close()}catch{}rmSync(root,{recursive:true,force:true})})
  store.initialize('operator1',PASSWORD,'Test clinic')
  const admin=store.login('operator1',PASSWORD).actor
  store.createStaff(admin,{username:'doctor1',password:DOCTOR_PASSWORD,role:'clinician'})
  store.createStaff(admin,{username:'doctor2',password:DOCTOR_PASSWORD,role:'clinician'})
  store.createStaff(admin,{username:'reception1',password:DOCTOR_PASSWORD,role:'reception'})
  const doctor=store.login('doctor1',DOCTOR_PASSWORD).actor
  const other=store.login('doctor2',DOCTOR_PASSWORD).actor
  const reception=store.login('reception1',DOCTOR_PASSWORD).actor
  const patient=store.create(admin,'patients',{name:'Fictitious patient',dateOfBirth:'1983-07-11'})
  store.assignPatient(admin,patient.id,'doctor1','Medical follow-up')
  return {store,root,admin,doctor,other,reception,patient}
}
test('patient invitation is scoped, short-lived and single-use, with independent credentials',t=>{
  const {store,doctor,other,reception,patient,root}=fixture(t)
  assert.throws(()=>store.issuePatientPortalInvite(other,patient.id),/asignado/)
  assert.throws(()=>store.issuePatientPortalInvite(reception,patient.id),/Permiso/)
  const invitation=store.issuePatientPortalInvite(doctor,patient.id)
  assert.match(invitation.invite,/^[a-f0-9]{64}$/)
  assert(Number.isFinite(Date.parse(invitation.expiresAt)))
  assert.throws(()=>store.redeemPatientPortalInvite('bad',PATIENT_PASSWORD),/Invitación/)
  const {accountId}=store.redeemPatientPortalInvite(invitation.invite,PATIENT_PASSWORD)
  assert.match(accountId,/^[a-f0-9]{32}$/)
  assert.throws(()=>store.redeemPatientPortalInvite(invitation.invite,PATIENT_PASSWORD),/Invitación/)
  assert.throws(()=>store.loginPatientPortal(accountId,'invalid-password-2026'),/Credenciales/)
  const session=store.loginPatientPortal(accountId,PATIENT_PASSWORD)
  assert.match(session.cookie,/^[a-f0-9]{64}$/)
  assert.throws(()=>store.patientPortalSession(session.cookie,'incorrect',true),/CSRF/)
  assert.equal(store.patientPortalSession(session.cookie,session.csrf,true).csrf,session.csrf)
  assert.deepEqual(store.patientPortalFeed(session.cookie),[])
  const raw=readFileSync(join(root,'clinic.sqlite'))
  assert(!raw.includes(Buffer.from(invitation.invite)))
  assert(!raw.includes(Buffer.from(PATIENT_PASSWORD)))
  store.logoutPatientPortal(session.cookie)
  assert.throws(()=>store.patientPortalFeed(session.cookie),/caducada/)
})
test('patient preconsultation stays encrypted, isolated and unverified until clinician review',t=>{
  const {store,root,admin,doctor,other,patient}=fixture(t)
  const invitation=store.issuePatientPortalInvite(doctor,patient.id)
  const account=store.redeemPatientPortalInvite(invitation.invite,PATIENT_PASSWORD)
  const portal=store.loginPatientPortal(account.accountId,PATIENT_PASSWORD)
  assert.throws(()=>store.patientPortalSubmitIntake(portal.cookie,'incorrect',{
    complaint:'Dolor ficticio, confidencial',
  }),/CSRF/)
  assert.throws(()=>store.patientPortalSubmitIntake(portal.cookie,portal.csrf,{
    complaint:'Dolor ficticio',unknownField:'foreign',
  }),/no permitido/)
  const saved=store.patientPortalSubmitIntake(portal.cookie,portal.csrf,{
    complaint:'SíntomaPrivadoNoPublicar24680',
    timeline:'Comenzó recientemente y evolucionó',
    allergies:'Alergia referida por paciente',
    medications:'Tratamiento informado, no conciliado',
    questions:'Dudas para el profesional',
  })
  assert.equal(saved.status,'pending-review')
  const patientFeed=store.patientPortalIntakes(portal.cookie)
  assert.equal(patientFeed.length,1)
  assert.equal(patientFeed[0].id,saved.id)
  assert.equal(patientFeed[0].status,'pending-review')
  assert(!JSON.stringify(patientFeed).includes('Alergia referida por paciente'))
  assert.throws(()=>store.patientIntakes(other,patient.id),/asignado/)
  const professional=store.patientIntakes(doctor,patient.id)
  assert.equal(professional.length,1)
  assert.equal(professional[0].answers.complaint,'SíntomaPrivadoNoPublicar24680')
  assert.equal(professional[0].source,'patient-portal')
  const chart=store.patientContext(doctor,patient.id)
  assert(!JSON.stringify(chart.patient.medicalHistory).includes('SíntomaPrivadoNoPublicar24680'))
  assert.throws(()=>store.reviewPatientIntake(other,saved.id,1),/asignado/)
  const reviewed=store.reviewPatientIntake(doctor,saved.id,1)
  assert.equal(reviewed.status,'reviewed')
  assert.equal(reviewed.verifiedHistoryTransfer,false)
  assert.throws(()=>store.reviewPatientIntake(doctor,saved.id,1),/revisada|Conflicto/)
  assert.equal(store.patientPortalIntakes(portal.cookie)[0].status,'reviewed')
  assert(!readFileSync(join(root,'clinic.sqlite')).includes(Buffer.from('SíntomaPrivadoNoPublicar24680')))
  assert(store.audits(admin).some(e=>e.action==='patient.portal.intake'))
  assert(store.audits(admin).some(e=>e.action==='patient.intake.reviewed'))
  const second=store.create(admin,'patients',{name:'Segundo sintético',dateOfBirth:'1987-03-04'})
  store.assignPatient(admin,second.id,'doctor2','Segunda consulta')
  const invitation2=store.issuePatientPortalInvite(other,second.id)
  const account2=store.redeemPatientPortalInvite(invitation2.invite,PATIENT_PASSWORD)
  const portal2=store.loginPatientPortal(account2.accountId,PATIENT_PASSWORD)
  assert.deepEqual(store.patientPortalIntakes(portal2.cookie),[])
  assert.deepEqual(store.patientIntakes(other,second.id),[])
})

test('clinical publication requires owning prescriber and never exposes unpublished history',t=>{
  const {store,admin,doctor,other,patient}=fixture(t)
  const appointment=store.create(admin,'appointments',{
    patientId:patient.id,practitioner:doctor.username,startsAt:'2026-11-25T14:00:00Z',reason:'Private internal reason',
  })
  const invite=store.issuePatientPortalInvite(doctor,patient.id)
  const {accountId}=store.redeemPatientPortalInvite(invite.invite,PATIENT_PASSWORD)
  const logged=store.loginPatientPortal(accountId,PATIENT_PASSWORD)
  assert.deepEqual(store.patientPortalFeed(logged.cookie),[])
  assert.throws(()=>store.publishPatientPortalItem(other,'appointments',appointment.id),/asignado|no asignado/)
  assert.throws(()=>store.publishPatientPortalItem(admin,'appointments',appointment.id),/Permiso/)
  assert.throws(()=>store.publishPatientPortalItem(doctor,'encounters',appointment.id),/Permiso/)
  store.publishPatientPortalItem(doctor,'appointments',appointment.id)
  const feed=store.patientPortalFeed(logged.cookie)
  assert.equal(feed.length,1)
  assert.equal(feed[0].kind,'appointment')
  assert.equal(feed[0].at,'2026-11-25T14:00:00.000Z')
  assert(!JSON.stringify(feed).includes('Private internal reason'))
  assert(!JSON.stringify(feed).includes(patient.name))
  assert(!JSON.stringify(feed).includes(patient.id))
  assert(store.audits(admin).some(entry=>entry.action==='patient.portal.publish'))
  store.revokePatientPortalAccess(doctor,patient.id)
  assert.throws(()=>store.patientPortalFeed(logged.cookie),/caducada|revocada/)
  assert.throws(()=>store.loginPatientPortal(accountId,PATIENT_PASSWORD),/Credenciales/)
})
test('patient portal UI uses isolated nonce script and production-safe opt-in controls',()=>{
  const nonce='PatientTestNonce0000000'
  const html=renderHealthPatientPage(nonce)
  assert.match(html,/PHOENIX Healthia/)
  assert.match(html,/script nonce="PatientTestNonce0000000"/)
  assert.ok(html.includes('/health/patient/api/'))
  assert.doesNotMatch(html,/localStorage|sessionStorage|https:\/\/cdn|external\.js/u)
  const source=/<script nonce="PatientTestNonce0000000">([\s\S]+?)<\/script>/u.exec(html)?.[1]
  assert.equal(typeof source,'string')
  assert.doesNotThrow(()=>new Script(source,{filename:'health-patient-portal-inline.js'}))
  const clinicianDisabled=renderHealthPage('safe-nonce',false)
  const clinicianEnabled=renderHealthPage('safe-nonce',true)
  assert.match(clinicianDisabled,/const patientPortalEnabled=false/)
  assert.match(clinicianEnabled,/const patientPortalEnabled=true/)
  assert.match(clinicianEnabled,/portalPublish/)
})
