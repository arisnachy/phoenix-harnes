import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PATIENT_INTAKE, parsePatientIntakeTemplate, patientIntakeValues,
  patientIdentityMatch, validatePatientDocument,
} from '../src/health-patient-intake.ts'

test('editable schema is bounded, versioned and accepts only data fields',()=>{
  const input={version:1,fields:[
    {id:'custom_ars',label:'ARS',kind:'text',required:false},
    {id:'custom_modalidad',label:'Modalidad',kind:'select',required:true,
      choices:['Presencial','Teleconsulta']},
  ]}
  const form=parsePatientIntakeTemplate(input,2)
  assert.equal(form.fields.length,2)
  assert.equal(form.revision,2)
  assert.deepEqual(patientIntakeValues(form,{custom_ars:' Plan ficticio ',
    custom_modalidad:'Teleconsulta'}),{custom_ars:'Plan ficticio',custom_modalidad:'Teleconsulta'})
  assert.throws(()=>patientIntakeValues(form,{custom_modalidad:'Otra'}),/opción/)
  assert.throws(()=>patientIntakeValues(form,{custom_modalidad:'Presencial',custom_hidden:'x'}),/no autorizado/)
  assert.throws(()=>patientIntakeValues(form,{}),/obligatorio/)
  assert.throws(()=>parsePatientIntakeTemplate({version:1,fields:[
    {id:'custom_ars',label:'ARS',kind:'javascript',required:false},
  ]},1),/inválido/)
  assert.throws(()=>parsePatientIntakeTemplate({version:1,fields:[
    {id:'custom_ars',label:'ARS',kind:'text',required:false,onclick:'evil()'},
  ]},1),/desconocida/)
  assert.equal(DEFAULT_PATIENT_INTAKE.fields.length,0)
})

test('document format does not masquerade as JCE identity confirmation',()=>{
  assert.deepEqual(validatePatientDocument('cedula','001-0000000-1'),
    {documentType:'cedula',documentNumber:'00100000001'})
  assert.throws(()=>validatePatientDocument('cedula','123'),/11 dígitos/)
  assert.equal(validatePatientDocument('cedula',''),null)
})

test('patient identity matching differentiates document, possible duplicates and family contacts',()=>{
  const existing={name:'José García',dateOfBirth:'1982-02-20',
    documentType:'cedula',documentNumber:'00100000001',phone:'809-555-0000'}
  assert.equal(patientIdentityMatch(existing,{name:'Distinto',dateOfBirth:'1991-01-01',
    documentType:'cedula',documentNumber:'001-0000000-1'}),'document')
  assert.equal(patientIdentityMatch(existing,{name:'JOSE GARCIA',dateOfBirth:'1982-02-20'}),'name-and-birth')
  assert.equal(patientIdentityMatch(existing,{name:'Otro',dateOfBirth:'1991-01-01',phone:'8095550000'}),null)
  assert.equal(patientIdentityMatch(existing,{name:'Otro',dateOfBirth:'1982-02-20',phone:'8095550000'}),'contact-and-birth')
})
