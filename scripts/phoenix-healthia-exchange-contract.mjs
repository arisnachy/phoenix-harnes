/**
 * PHOENIX Fabric / Healthia: metadata-only exchange proposal contract.
 *
 * Deliberately NO transport, patient data lookup, consent authentication,
 * authorization, encryption or cross-instance delivery. An authenticated
 * clinical service must own those boundaries in a future phase.
 */
const PURPOSES = new Set(['continuity-of-care', 'patient-access', 'referral', 'second-opinion', 'lab-review'])
const OUTPUTS = new Set(['fhir-r4-reference', 'clinical-summary-pdf-reference', 'protected-document-reference'])
const SCOPES = new Set(['allergies', 'medications', 'lab-results', 'encounter-summary', 'care-plan'])
const RECEIPT_STATES = new Set(['requested', 'pending-recipient-approval', 'pending-patient-consent', 'denied', 'expired', 'revoked'])
const ID = /^[a-zA-Z][a-zA-Z0-9_-]{7,95}$/
const PROPOSAL_KEYS = new Set([
  'requestId', 'sourceInstanceId', 'destinationInstanceId', 'subjectToken',
  'purpose', 'scopes', 'output', 'requestedAt', 'expiresAt',
])
const PUBLIC_KEYS = new Set(['requestId', 'sourceInstanceId', 'destinationInstanceId', 'purpose', 'output', 'requestedAt', 'expiresAt'])

function fail(reason) { throw new TypeError('HEALTHIA_EXCHANGE_' + reason) }
function validateId(key, value) { if (typeof value !== 'string' || !ID.test(value)) fail('INVALID_' + key.toUpperCase()) }
function timestamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value) }

/**
 * Validate an outbound intent WITHOUT embedding clinical material.
 * `subjectToken` must be an opaque, time-limited reference issued by a trusted backend.
 * We cannot prove it is opaque here: the backend MUST validate provenance.
 */
export function makeHealthiaExchangeProposal(input, now = new Date()) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_PROPOSAL')
  if (Object.keys(input).some(key => !PROPOSAL_KEYS.has(key))) fail('UNSUPPORTED_FIELD')
  if (Object.keys(input).length !== PROPOSAL_KEYS.size) fail('INCOMPLETE_PROPOSAL')
  for (const key of ['requestId', 'sourceInstanceId', 'destinationInstanceId', 'subjectToken']) validateId(key, input[key])
  if (input.sourceInstanceId === input.destinationInstanceId) fail('SAME_INSTANCE')
  if (!PURPOSES.has(input.purpose)) fail('PURPOSE')
  if (!OUTPUTS.has(input.output)) fail('OUTPUT')
  if (!Array.isArray(input.scopes) || input.scopes.length === 0 || input.scopes.length > SCOPES.size) fail('SCOPES')
  if (new Set(input.scopes).size !== input.scopes.length || input.scopes.some(v => !SCOPES.has(v))) fail('SCOPES')
  if (!timestamp(input.requestedAt) || !timestamp(input.expiresAt)) fail('TIME')
  const requestTime = Date.parse(input.requestedAt)
  const expiryTime = Date.parse(input.expiresAt)
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN
  if (!Number.isFinite(nowMs) || requestTime > nowMs + 60_000 || expiryTime <= nowMs || expiryTime > requestTime + 86_400_000) fail('EXPIRY')
  return Object.freeze({
    ...input,
    scopes: Object.freeze([...input.scopes]),
    status: 'pending-recipient-approval',
    transportEnabled: false,
  })
}

/** Redacted, bounded UI receipt: no subjectToken, scopes, patient or free-text content. */
export function exchangePublicReceipt(proposal, status = 'requested') {
  if (!RECEIPT_STATES.has(status)) fail('RECEIPT_STATE')
  if (!proposal || proposal.transportEnabled !== false || proposal.status !== 'pending-recipient-approval') fail('UNTRUSTED_PROPOSAL')
  const result = {}
  for (const key of PUBLIC_KEYS) result[key] = proposal[key]
  return Object.freeze({ ...result, status, transportEnabled: false })
}

/** Fail-closed until recipient trust, patient consent, authentication, audit and encryption exist. */
export function mayDispatchHealthiaExchange() { return false }
