import assert from 'node:assert/strict'
import test from 'node:test'
import { exchangePublicReceipt, makeHealthiaExchangeProposal, mayDispatchHealthiaExchange } from './phoenix-healthia-exchange-contract.mjs'

const now = new Date('2026-11-21T12:00:00.000Z')
const valid = () => ({
  requestId: 'request_00000001',
  sourceInstanceId: 'phoenix_doctor_01',
  destinationInstanceId: 'phoenix_patient_01',
  subjectToken: 'opaqueToken_123456',
  purpose: 'continuity-of-care',
  scopes: ['allergies', 'medications'],
  output: 'fhir-r4-reference',
  requestedAt: '2026-11-21T12:00:00.000Z',
  expiresAt: '2026-11-21T12:15:00.000Z',
})

test('creates a bounded metadata proposal but never enables delivery', () => {
  const proposal = makeHealthiaExchangeProposal(valid(), now)
  assert.equal(proposal.transportEnabled, false)
  assert.equal(proposal.status, 'pending-recipient-approval')
  assert.equal(mayDispatchHealthiaExchange(proposal), false)
  assert.equal(Object.isFrozen(proposal), true)
  assert.equal(Object.isFrozen(proposal.scopes), true)
})

test('rejects raw patient data and arbitrary schema extensions', () => {
  assert.throws(() => makeHealthiaExchangeProposal({ ...valid(), patientName: 'Demo Person' }, now), /UNSUPPORTED_FIELD/)
  assert.throws(() => makeHealthiaExchangeProposal({ ...valid(), diagnosis: 'Test' }, now), /UNSUPPORTED_FIELD/)
  assert.throws(() => makeHealthiaExchangeProposal({ ...valid(), purpose: 'send everything' }, now), /PURPOSE/)
})

test('rejects unbounded or ineligible transmission intents', () => {
  assert.throws(() => makeHealthiaExchangeProposal({ ...valid(), scopes: ['allergies', 'allergies'] }, now), /SCOPES/)
  assert.throws(() => makeHealthiaExchangeProposal({ ...valid(), scopes: ['complete-ehr'] }, now), /SCOPES/)
  assert.throws(() => makeHealthiaExchangeProposal({ ...valid(), expiresAt: '2026-11-23T12:00:00.000Z' }, now), /EXPIRY/)
  assert.throws(() => makeHealthiaExchangeProposal({ ...valid(), destinationInstanceId: 'phoenix_doctor_01' }, now), /SAME_INSTANCE/)
})

test('public receipts redact internal subject and scope references', () => {
  const proposal = makeHealthiaExchangeProposal(valid(), now)
  const receipt = exchangePublicReceipt(proposal, 'pending-patient-consent')
  assert.equal(receipt.transportEnabled, false)
  assert.equal(receipt.status, 'pending-patient-consent')
  assert.equal('subjectToken' in receipt, false)
  assert.equal('scopes' in receipt, false)
  assert.equal(JSON.stringify(receipt).includes('opaqueToken'), false)
  assert.throws(() => exchangePublicReceipt(proposal, 'delivered'), /RECEIPT_STATE/)
})
