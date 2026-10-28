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
  t.after(()=>{try{db.close()}catch {/* already closed */} rmSync(root,{recursive:true,force:true})})
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
  f.db.close()
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
  db.assignPatient(reception,patient.id,'doctor1','Consulta programada')
  const visit=db.create(doctor,'encounters',{patientId:patient.id,complaint:'Molestia simulada',specialty:'Medicina familiar',mode:'mixed'})
  assert.throws(()=>db.create(doctor,'orders',{encounterId:visit.id,description:'Hemograma',modality:'laboratory'}),/firmar/)
  assert.throws(()=>db.create(reception,'prescriptions',{encounterId:visit.id,medication:'Medicamento',directions:'Dosis'}),/Permiso/)
  assert.throws(()=>db.list(lab,'patients'),/Permiso/)
})
test('clinical revision and signing enforce concurrency and professional ownership',t=>{
  const {db,admin}=fixture(t)
  db.createStaff(admin.actor,{username:'doctor1',password:'another-secure-password-2026',role:'clinician'})
  db.createStaff(admin.actor,{username:'doctor2',password:'another-secure-password-2026',role:'clinician'})
  const d=db.login('doctor1','another-secure-password-2026').actor
  const other=db.login('doctor2','another-secure-password-2026').actor
  const p=db.create(admin.actor,'patients',{name:'Paciente',dateOfBirth:'1980-01-01'})
  db.assignPatient(admin.actor,p.id,'doctor1','Valoración médica')
  let e=db.create(d,'encounters',{patientId:p.id,specialty:'General',complaint:'Control',mode:'manual'})
  assert.throws(()=>db.update(d,'encounters',e.id,e.version,{action:'sign'}),/revisada/)
  e=db.update(d,'encounters',e.id,e.version,{action:'document',history:'Anamnesis registrada',exam:'Sin datos ficticios'})
  assert.throws(()=>db.update(other,'encounters',e.id,e.version,{action:'review'}),/no asignado/)
  e=db.update(d,'encounters',e.id,e.version,{action:'review'})
  assert.throws(()=>db.update(d,'encounters',e.id,e.version-1,{action:'sign'}),/Conflicto/)
  e=db.update(d,'encounters',e.id,e.version,{action:'sign'})
  assert.equal(e.signedBy,'doctor1')
  assert.throws(()=>db.update(d,'encounters',e.id,e.version,{action:'document',history:'Edit'}),/firmada/)
  let order=db.create(d,'orders',{encounterId:e.id,modality:'laboratory',description:'Control de laboratorio'})
  const profile=db.list(d,'patients').find(x=>x.id===p.id)
  db.update(d,'patients',p.id,profile.version,{action:'allergy-review',status:'none-known',details:''})
  const med=db.create(d,'prescriptions',{encounterId:e.id,medication:'Medicamento',directions:'Plan revisado',safetyAcknowledged:true})
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

test('real Kira reminder reservation requires clinician ownership, verified email, consent and one delivery',t=>{
  const {db,admin}=fixture(t)
  db.createStaff(admin.actor,{username:'doctor1',password:'another-secure-password-2026',role:'clinician'})
  db.createStaff(admin.actor,{username:'doctor2',password:'another-secure-password-2026',role:'clinician'})
  const clinician=db.login('doctor1','another-secure-password-2026').actor
  const other=db.login('doctor2','another-secure-password-2026').actor
  const patientNoConsent=db.create(admin.actor,'patients',{name:'Sin consentimiento',dateOfBirth:'1974-04-01',email:'not-consented@example.org'})
  db.assignPatient(admin.actor,patientNoConsent.id,'doctor1','Control médico')
  const apptNo=db.create(admin.actor,'appointments',{patientId:patientNoConsent.id,practitioner:'doctor1',startsAt:'2026-12-20T13:00:00Z',reason:'Control'})
  assert.throws(()=>db.beginReminder(clinician,apptNo.id,'kira@institution.org'),/consentimiento/)
  const patient=db.create(admin.actor,'patients',{name:'Con consentimiento',dateOfBirth:'1975-04-02',
    email:'verified@example.org',emailConsent:true,emailVerified:true})
  db.assignPatient(admin.actor,patient.id,'doctor1','Control médico')
  const approved=db.update(admin.actor,'patients',patient.id,patient.version,
    {action:'contact',consent:'granted',emailVerified:true,method:'signed-document',evidenceRef:'FORM-1001'})
  assert.equal(approved.contactEvidence.recordedBy,'clinicaladmin')
  const appt=db.create(admin.actor,'appointments',{patientId:patient.id,practitioner:'doctor1',startsAt:'2026-12-21T13:00:00Z',reason:'Control'})
  assert.throws(()=>db.beginReminder(other,appt.id,'kira@institution.org'),/no asignado/)
  const plan=db.beginReminder(clinician,appt.id,'kira@institution.org')
  assert.equal(plan.recipient,'verified@example.org')
  assert(!plan.body.includes('Con consentimiento'))
  assert.throws(()=>db.beginReminder(clinician,appt.id,'kira@institution.org'),/ya fue reservado/)
  db.finishReminder(clinician,appt.id,'gmail-message-id-001')
  assert.equal(db.reminders(admin.actor)[0].status,'sent')
  assert.equal(db.reminders(admin.actor)[0].sender,'kira@institution.org')
})

test('real pharmacy dispensing is atomic, signed, single-use, and decrements stock',t=>{
  const {db,admin}=fixture(t)
  db.createStaff(admin.actor,{username:'doctor1',password:'another-secure-password-2026',role:'clinician'})
  db.createStaff(admin.actor,{username:'pharmacy1',password:'another-secure-password-2026',role:'pharmacy'})
  const doctor=db.login('doctor1','another-secure-password-2026').actor
  const pharmacist=db.login('pharmacy1','another-secure-password-2026').actor
  const patient=db.create(admin.actor,'patients',{name:'Consulta farmacéutica',dateOfBirth:'1986-01-02'})
  db.assignPatient(admin.actor,patient.id,'doctor1','Prescripción médica')
  let encounter=db.create(doctor,'encounters',{patientId:patient.id,specialty:'Medicina',complaint:'Control',mode:'manual'})
  encounter=db.update(doctor,'encounters',encounter.id,encounter.version,{action:'document',history:'Historia profesional'})
  encounter=db.update(doctor,'encounters',encounter.id,encounter.version,{action:'review'})
  encounter=db.update(doctor,'encounters',encounter.id,encounter.version,{action:'sign'})
  const profile=db.list(doctor,'patients').find(x=>x.id===patient.id)
  db.update(doctor,'patients',patient.id,profile.version,{action:'allergy-review',status:'none-known',details:''})
  const rx=db.create(doctor,'prescriptions',{encounterId:encounter.id,medication:'Producto autorizado',directions:'Instrucciones clínicas redactadas por profesional',safetyAcknowledged:true})
  let stock=db.create(pharmacist,'inventory',{item:'Producto autorizado'})
  stock=db.update(pharmacist,'inventory',stock.id,stock.version,{delta:2})
  const result=db.dispense(pharmacist,rx.id,stock.id)
  assert.equal(result.prescription.status,'dispensed')
  assert.equal(result.inventory.units,1)
  assert.throws(()=>db.dispense(pharmacist,rx.id,stock.id),/ya fue/)
  assert.equal(db.list(pharmacist,'inventory')[0].units,1)
  assert.throws(()=>db.dispense(doctor,rx.id,stock.id),/farmacéutico/)
})
test('psychotherapy notes are restricted to the author even inside one clinic',t=>{
  const {db,admin}=fixture(t)
  db.createStaff(admin.actor,{username:'psychologist1',password:'another-secure-password-2026',role:'psychologist'})
  db.createStaff(admin.actor,{username:'doctor1',password:'another-secure-password-2026',role:'clinician'})
  const psych=db.login('psychologist1','another-secure-password-2026').actor
  const doctor=db.login('doctor1','another-secure-password-2026').actor
  const patient=db.create(admin.actor,'patients',{name:'Paciente privado',dateOfBirth:'1990-01-01'})
  db.assignPatient(admin.actor,patient.id,'psychologist1','Psicoterapia autorizada')
  db.create(psych,'encounters',{patientId:patient.id,specialty:'Psicología',complaint:'Sesión confidencial',mode:'manual'})
  assert.equal(db.list(psych,'encounters').length,1)
  assert.equal(db.list(doctor,'encounters').length,0)
  assert.equal(db.list(admin.actor,'encounters').length,0)
  db.createStaff(admin.actor,{username:'nurse1',password:'another-secure-password-2026',role:'nurse'})
  const nurse=db.login('nurse1','another-secure-password-2026').actor
  db.assignPatient(admin.actor,patient.id,'nurse1','Nursing care')
  assert.equal(db.list(nurse,'encounters').length,0)
  const session=db.list(psych,'encounters')[0]
  assert.equal(session.confidentialPsychotherapy,true)
  assert.throws(()=>db.update(nurse,'encounters',session.id,session.version,
    {action:'document',history:'not allowed'}),/Permiso clínico|Acceso al episodio/)
  assert.throws(()=>db.update(admin.actor,'encounters',session.id,session.version,
    {action:'review'}),/Permiso clínico|Acceso al episodio/)
})

test('patient assignments enforce consented care-team access and revocation in every clinical list and write',t=>{
  const {db,admin}=fixture(t)
  db.createStaff(admin.actor,{username:'doctor1',password:'another-secure-password-2026',role:'clinician'})
  db.createStaff(admin.actor,{username:'doctor2',password:'another-secure-password-2026',role:'clinician'})
  const clinician=db.login('doctor1','another-secure-password-2026').actor
  const other=db.login('doctor2','another-secure-password-2026').actor
  const patient=db.create(admin.actor,'patients',{name:'Paciente confidencial',dateOfBirth:'1982-05-04'})
  assert.deepEqual(db.list(clinician,'patients'),[])
  assert.throws(()=>db.create(clinician,'encounters',{patientId:patient.id,complaint:'Control',specialty:'Medicina'}),/no asignado/)
  db.assignPatient(admin.actor,patient.id,'doctor1','Atención primaria autorizada')
  assert.equal(db.list(clinician,'patients').length,1)
  assert.deepEqual(db.list(other,'patients'),[])
  assert.throws(()=>db.assignPatient(clinician,patient.id,'doctor2','Acceso sin autorización'),/Solo admisión/)
  assert.equal(db.assignments(admin.actor).length,1)
  const encounter=db.create(clinician,'encounters',{patientId:patient.id,complaint:'Revisión',specialty:'General'})
  assert.equal(db.list(clinician,'encounters').length,1)
  assert.deepEqual(db.list(other,'encounters'),[])
  db.revokePatient(admin.actor,patient.id,'doctor1')
  assert.deepEqual(db.list(clinician,'patients'),[])
  assert.deepEqual(db.list(clinician,'encounters'),[])
  assert.throws(()=>db.update(clinician,'encounters',encounter.id,encounter.version,{action:'document',history:'No autorizado'}),/no asignado/)
  assert.equal(db.assignments(admin.actor).length,0)
  assert(db.audits(admin.actor).some(x=>x.action==='patient.revoke'))
})

test('clinical email consent is not a boolean from the form; only auditable proof activates delivery',t=>{
  const {db,admin}=fixture(t)
  const p=db.create(admin.actor,'patients',{name:'Con consentimiento',dateOfBirth:'1984-03-04',
    email:'example@hospital.org',emailConsent:true,emailVerified:true})
  assert.equal(p.emailConsent,false)
  assert.equal(p.emailVerified,false)
  assert.equal(p.contactEvidence,null)
  assert.throws(()=>db.update(admin.actor,'patients',p.id,p.version,
    {action:'contact',consent:'granted',emailVerified:true,method:'bad',evidenceRef:'FORM-1234'}),/Método/)
  const approved=db.update(admin.actor,'patients',p.id,p.version,
    {action:'contact',consent:'granted',emailVerified:true,method:'in-person',evidenceRef:'FORM-1234'})
  assert.equal(approved.contactEvidence.recordedBy,'clinicaladmin')
  assert.equal(approved.contactEvidence.recipient,'example@hospital.org')
  const revoked=db.update(admin.actor,'patients',p.id,approved.version,
    {action:'contact',consent:'revoked',emailVerified:false,method:'in-person',evidenceRef:'REV-1235'})
  assert.equal(revoked.emailConsent,false)
  assert.equal(revoked.contactEvidence.consent,'revoked')
  assert(db.audits(admin.actor).some(x=>x.action==='patients.update'))
})

test('an online SQLite backup can be restored and retains encrypted clinical content',async t=>{
  const {db,admin,root}=fixture(t)
  const p=db.create(admin.actor,'patients',{name:'UnusualEncryptedBackupOnlyName77',dateOfBirth:'1988-06-01'})
  const report=await db.backup(admin.actor)
  assert.equal(report.records,1)
  assert.equal(db.backups(admin.actor).length,1)
  const filename=join(root,'backups',report.name)
  assert(!readFileSync(filename).includes(Buffer.from('UnusualEncryptedBackupOnlyName77')))
  const restored=new HealthClinicStore(filename)
  try {
    const login=restored.login('clinicaladmin',PASSWORD)
    assert.equal(restored.list(login.actor,'patients')[0].id,p.id)
    assert.equal(restored.list(login.actor,'patients')[0].name,'UnusualEncryptedBackupOnlyName77')
  }finally{restored.close()}
  assert(db.audits(admin.actor).some(x=>x.action==='backup.create'))
})

test('tampering with the authenticated clinical audit journal prevents reopening the clinic',async t=>{
  const {db,admin,root}=fixture(t)
  db.create(admin.actor,'patients',{name:'Audit tamper demonstration',dateOfBirth:'1991-01-01'})
  const file=join(root,'clinic.sqlite')
  db.close()
  const { DatabaseSync }=await import('node:sqlite')
  const raw=new DatabaseSync(file)
  try{raw.prepare("UPDATE health_audit SET action=? WHERE action='patients.create'").run('patient.force-change')}
  finally{raw.close()}
  const reopened=new HealthClinicStore(file)
  try{assert.throws(()=>reopened.login('clinicaladmin',PASSWORD),/Integridad del historial/)}
  finally{reopened.close()}
})

test('billing sees only minimum patient locator and cannot read clinical demographics',t=>{
 const {db,admin}=fixture(t)
 db.createStaff(admin.actor,{username:'billing1',password:'another-secure-password-2026',role:'billing'})
 const billing=db.login('billing1','another-secure-password-2026').actor
 const patient=db.create(admin.actor,'patients',{name:'Recepción factura',dateOfBirth:'1987-01-02',
   email:'private@example.org',phone:'809-555-0000'})
 const options=db.patientOptions(billing)
 assert.deepEqual(options,[{id:patient.id,name:'Recepción factura'}])
 assert.throws(()=>db.list(billing,'patients'),/Permiso/)
 const invoice=db.create(billing,'invoices',{patientId:patient.id,concept:'Consulta',amountCents:40000})
 assert.equal(invoice.patientId,patient.id)
})

test('prescription cannot bypass explicit professional allergy and pharmacology review',t=>{
  const {db,admin}=fixture(t)
  db.createStaff(admin.actor,{username:'doctor1',password:'another-secure-password-2026',role:'clinician'})
  const doctor=db.login('doctor1','another-secure-password-2026').actor
  const patient=db.create(admin.actor,'patients',{name:'Safety control',dateOfBirth:'1988-01-01'})
  db.assignPatient(admin.actor,patient.id,'doctor1','Tratamiento')
  let encounter=db.create(doctor,'encounters',{patientId:patient.id,specialty:'General',complaint:'Consulta',mode:'manual'})
  encounter=db.update(doctor,'encounters',encounter.id,encounter.version,{action:'document',history:'Historia'})
  encounter=db.update(doctor,'encounters',encounter.id,encounter.version,{action:'review'})
  encounter=db.update(doctor,'encounters',encounter.id,encounter.version,{action:'sign'})
  const rx={encounterId:encounter.id,medication:'Fármaco',directions:'Indicación profesional',safetyAcknowledged:true}
  assert.throws(()=>db.create(doctor,'prescriptions',rx),/Falta revisión/)
  const fresh=db.list(doctor,'patients')[0]
  db.update(doctor,'patients',patient.id,fresh.version,{action:'allergy-review',status:'documented',
    details:'Alergia declarada por el paciente; requiere contraste'})
  assert.throws(()=>db.create(doctor,'prescriptions',{...rx,safetyAcknowledged:false}),/confirmar revisión/)
  const result=db.create(doctor,'prescriptions',rx)
  assert.equal(result.safetyReview.attestedBy,'doctor1')
  assert.equal(result.safetyReview.drugInteractionCatalogChecked,false)
})

test('Kira interview reads only the assigned encounter and saves adaptive answers encrypted',t=>{
 const {db,admin,root}=fixture(t)
 db.createStaff(admin.actor,{username:'doctor1',password:'another-secure-password-2026',role:'clinician'})
 db.createStaff(admin.actor,{username:'doctor2',password:'another-secure-password-2026',role:'clinician'})
 const doctor=db.login('doctor1','another-secure-password-2026').actor
 const other=db.login('doctor2','another-secure-password-2026').actor
 const patient=db.create(admin.actor,'patients',{name:'Consulta dolor abdominal',dateOfBirth:'1980-01-02'})
 db.assignPatient(admin.actor,patient.id,'doctor1','Atención clínica')
 let encounter=db.create(doctor,'encounters',{patientId:patient.id,specialty:'Medicina familiar',complaint:'dolor abdominal',mode:'kira'})
 assert.throws(()=>db.interviewGuide(other,encounter.id),/no asignado/)
 const guide=db.interviewGuide(doctor,encounter.id)
 assert.equal(guide.pathway,'abdominal')
 assert.equal(guide.patientDataPersisted,false)
 const field=guide.nextQuestions[0].key
 encounter=db.update(doctor,'encounters',encounter.id,encounter.version,
   {action:'answer',field,answer:'RespuestaClinicaCifradaUnica9876543'})
 assert.equal(encounter.interviewAnswers[field],'RespuestaClinicaCifradaUnica9876543')
 assert(!db.interviewGuide(doctor,encounter.id).nextQuestions.some(x=>x.key===field))
 assert(!readFileSync(join(root,'clinic.sqlite')).includes(Buffer.from('RespuestaClinicaCifradaUnica9876543')))
 assert.throws(()=>db.update(doctor,'encounters',encounter.id,encounter.version,
   {action:'answer',field,answer:'Replay'}),/ya fue registrada/)
 assert(db.audits(admin.actor).some(x=>x.action==='encounters.update'))
})

test('longitudinal clinical history stays encrypted, versioned and restricted to assigned physician',t=>{
  const {db,admin,root}=fixture(t)
  db.createStaff(admin.actor,{username:'doctor1',password:'another-secure-password-2026',role:'clinician'})
  db.createStaff(admin.actor,{username:'doctor2',password:'another-secure-password-2026',role:'clinician'})
  const doctor=db.login('doctor1','another-secure-password-2026').actor
  const other=db.login('doctor2','another-secure-password-2026').actor
  const patient=db.create(admin.actor,'patients',{name:'Synthetic longitudinal history',dateOfBirth:'1980-01-01'})
  db.assignPatient(admin.actor,patient.id,'doctor1','Longitudinal follow-up')
  assert.throws(()=>db.update(other,'patients',patient.id,patient.version,{
    action:'history',record:{pastMedical:'Should not save'},
  }),/no asignado/)
  assert.throws(()=>db.update(admin.actor,'patients',patient.id,patient.version,{
    action:'history',record:{pastMedical:'Admin cannot create medical findings'},
  }),/profesional/)
  const history=db.update(doctor,'patients',patient.id,patient.version,{
    action:'history',
    record:{pastMedical:'EncryptedSyntheticCondition8675309',pastSurgical:'',familyHistory:'',
      currentMedications:'',vaccinations:'',habits:'',problems:''},
  })
  assert.equal(history.medicalHistory.pastMedical,'EncryptedSyntheticCondition8675309')
  assert.equal(history.medicalHistoryReview.reviewedBy,'doctor1')
  assert.throws(()=>db.update(doctor,'patients',patient.id,patient.version,{
    action:'history',record:{pastMedical:'Stale edit'},
  }),/Conflicto/)
  assert(!readFileSync(join(root,'clinic.sqlite')).includes(Buffer.from('EncryptedSyntheticCondition8675309')))
  assert(db.audits(admin.actor).some(x=>x.action==='patients.update'))
})

test('physician drafts a subjective note only from protected recorded answers, never invents assessment',t=>{
  const {db,admin}=fixture(t)
  db.createStaff(admin.actor,{username:'doctor1',password:'another-secure-password-2026',role:'clinician'})
  const doctor=db.login('doctor1','another-secure-password-2026').actor
  const patient=db.create(admin.actor,'patients',{name:'Synthetic SOAP patient',dateOfBirth:'1985-01-01'})
  db.assignPatient(admin.actor,patient.id,'doctor1','SOAP review')
  let e=db.create(doctor,'encounters',{patientId:patient.id,complaint:'cefalea',specialty:'Medicina familiar',mode:'mixed'})
  assert.throws(()=>db.update(doctor,'encounters',e.id,e.version,{action:'draft-from-interview'}),/al menos una/)
  const first=db.interviewGuide(doctor,e.id).nextQuestions[0].key
  e=db.update(doctor,'encounters',e.id,e.version,{action:'answer',field:first,answer:'Respuesta sintética del profesional'})
  e=db.update(doctor,'encounters',e.id,e.version,{action:'draft-from-interview'})
  assert.match(e.history,/Respuesta sintética del profesional/)
  assert.equal(e.assessment,'')
  assert.equal(e.exam,'')
  assert.equal(e.reviewedVersion,null)
  assert.throws(()=>db.update(doctor,'encounters',e.id,e.version,{action:'draft-from-interview'}),/no sobrescribir/)
})

test('critical results need documented acknowledgment by the responsible physician only',t=>{
  const {db,admin}=fixture(t)
  db.createStaff(admin.actor,{username:'doctor1',password:'another-secure-password-2026',role:'clinician'})
  db.createStaff(admin.actor,{username:'doctor2',password:'another-secure-password-2026',role:'clinician'})
  db.createStaff(admin.actor,{username:'labuser',password:'another-secure-password-2026',role:'lab'})
  const doctor=db.login('doctor1','another-secure-password-2026').actor
  const other=db.login('doctor2','another-secure-password-2026').actor
  const lab=db.login('labuser','another-secure-password-2026').actor
  const patient=db.create(admin.actor,'patients',{name:'Synthetic critical lab',dateOfBirth:'1990-01-01'})
  db.assignPatient(admin.actor,patient.id,'doctor1','Critical follow-up')
  db.assignPatient(admin.actor,patient.id,'doctor2','Collaborative care')
  let e=db.create(doctor,'encounters',{patientId:patient.id,specialty:'General',complaint:'Prueba clínica',mode:'manual'})
  e=db.update(doctor,'encounters',e.id,e.version,{action:'document',history:'Historia registrada'})
  e=db.update(doctor,'encounters',e.id,e.version,{action:'review'})
  e=db.update(doctor,'encounters',e.id,e.version,{action:'sign'})
  let order=db.create(doctor,'orders',{encounterId:e.id,modality:'laboratory',description:'Prueba simulada'})
  order=db.update(lab,'orders',order.id,order.version,{action:'result',
    result:'Resultado marcado crítico por laboratorio (dato sintético)',critical:true})
  assert.equal(order.status,'critical-pending-review')
  assert.throws(()=>db.update(other,'orders',order.id,order.version,{
    action:'review',criticalAcknowledged:true}),/médico responsable|otro profesional|Acceso al episodio/)
  assert.throws(()=>db.update(doctor,'orders',order.id,order.version,{action:'review'}),/confirmación explícita/)
  order=db.update(doctor,'orders',order.id,order.version,{action:'review',criticalAcknowledged:true})
  assert.equal(order.status,'reviewed')
  assert.equal(order.criticalAcknowledged,true)
  assert.equal(order.reviewedBy,'doctor1')
})

test('Kira rechecks consent, clinician assignment and appointment state just before dispatch',t=>{
  const {db,admin}=fixture(t)
  db.createStaff(admin.actor,{username:'doctor1',password:'another-secure-password-2026',role:'clinician'})
  const clinician=db.login('doctor1','another-secure-password-2026').actor
  const p=db.create(admin.actor,'patients',{name:'Synthetic consent race',dateOfBirth:'1980-02-03',
    email:'synthetic@example.org'})
  db.assignPatient(admin.actor,p.id,'doctor1','Continuity of care')
  const accepted=db.update(admin.actor,'patients',p.id,p.version,{
    action:'contact',consent:'granted',emailVerified:true,method:'signed-document',evidenceRef:'FORM-9876',
  })
  const appointment=db.create(admin.actor,'appointments',{
    patientId:p.id,practitioner:'doctor1',startsAt:'2026-12-22T13:00:00Z',reason:'Synthetic follow-up',
  })
  const planned=db.beginReminder(clinician,appointment.id,'kira@example.org')
  assert.doesNotThrow(()=>db.confirmReminderDelivery(
    clinician,appointment.id,'kira@example.org',planned.recipient))
  assert.throws(()=>db.confirmReminderDelivery(
    clinician,appointment.id,'wrong@example.org',planned.recipient),/no autorizado/)
  const revoked=db.update(admin.actor,'patients',p.id,accepted.version,{
    action:'contact',consent:'revoked',emailVerified:false,method:'signed-document',evidenceRef:'REV-9876',
  })
  assert.equal(revoked.emailConsent,false)
  assert.throws(()=>db.confirmReminderDelivery(
    clinician,appointment.id,'kira@example.org',planned.recipient),/Consentimiento/)
  db.finishReminder(clinician,appointment.id,undefined,true)
  assert.equal(db.reminders(admin.actor)[0].status,'cancelled')
  assert.throws(()=>db.confirmReminderDelivery(
    clinician,appointment.id,'kira@example.org',planned.recipient),/no pendiente/)
  assert.throws(()=>db.beginReminder(clinician,appointment.id,'kira@example.org'),/consentimiento|reservado/)
})

test('Kira blocks a queued reminder when clinician access is revoked or appointment cancelled',t=>{
  const {db,admin}=fixture(t)
  db.createStaff(admin.actor,{username:'doctor1',password:'another-secure-password-2026',role:'clinician'})
  const doctor=db.login('doctor1','another-secure-password-2026').actor
  const p=db.create(admin.actor,'patients',{name:'Synthetic appointment cancellation',dateOfBirth:'1984-01-01',
    email:'patient@example.org'})
  db.assignPatient(admin.actor,p.id,'doctor1','Clinic follow-up')
  db.update(admin.actor,'patients',p.id,p.version,{
    action:'contact',consent:'granted',emailVerified:true,method:'in-person',evidenceRef:'FORM-2222',
  })
  let appointment=db.create(admin.actor,'appointments',{
    patientId:p.id,practitioner:'doctor1',startsAt:'2026-12-24T13:00:00Z',reason:'Control',
  })
  const queued=db.beginReminder(doctor,appointment.id,'kira@example.org')
  appointment=db.update(admin.actor,'appointments',appointment.id,appointment.version,{status:'cancelled'})
  assert.throws(()=>db.confirmReminderDelivery(
    doctor,appointment.id,'kira@example.org',queued.recipient),/cancelada|cancelada, completada/)
  db.revokePatient(admin.actor,p.id,'doctor1')
  assert.throws(()=>db.confirmReminderDelivery(
    doctor,appointment.id,'kira@example.org',queued.recipient),/no asignado/)
})
