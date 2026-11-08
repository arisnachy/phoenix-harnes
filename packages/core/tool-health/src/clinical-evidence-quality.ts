/**
 * Source-to-draft completeness audit for visual and document-based clinical reasoning.
 *
 * No LLM or image bytes are accessed here. The caller supplies claims and
 * observations, and this validator cannot independently verify their truth.
 * This is not an automated diagnostic device or clearance to dismiss disease.
 */

export type ClinicalEvidenceDecision =
  | 'BLOCK_UNEXAMINED_SOURCE'
  | 'BLOCK_UNVERIFIED_MEASUREMENT'
  | 'BLOCK_UNSUPPORTED_REASSURANCE'
  | 'NEEDS_EVIDENCE_COMPLETION'
  | 'DRAFT_READY_FOR_CLINICIAN'

/** One independently identified region or dimension of the source study. */
export interface ObservedClinicalDomain {
  readonly domain: string
  readonly status: 'assessed' | 'not-assessable' | 'not-reviewed'
  readonly evidence: string
}

/** Metadata only; never pass personal identifiers or complete medical records. */
export interface ClinicalEvidenceInput {
  readonly modality: unknown
  readonly sourceKind: unknown
  readonly sourceReviewed: unknown
  readonly sourceQuality: unknown
  readonly calibration: unknown
  readonly domains: unknown
  readonly claim: unknown
  readonly urgencyReviewed: unknown
  readonly impression?: unknown
  readonly differentials?: unknown
  readonly imageWidth?: unknown
  readonly imageHeight?: unknown
  readonly prMs?: unknown
  readonly qrsMs?: unknown
}

/** Domain checks inspect coverage, not a fixed list of possible diseases. */
const ECG_DOMAINS = [
  'rhythm', 'rate', 'axis', 'intervals', 'qrs-morphology',
  'repolarization', 'lead-distribution',
] as const
const IMAGING_DOMAINS = [
  'technique', 'anatomical-findings', 'distribution', 'limitations',
] as const
const REPORT_DOMAINS = [
  'readable-text', 'reported-impression', 'limitations',
] as const
const GENERIC_DOMAINS = [
  'technique', 'observations', 'limitations',
] as const

/** Return which non-diagnostic assessment dimensions apply to one study. */
function domainsFor(modality: string, sourceKind: string): readonly string[] {
  if (sourceKind === 'report') return REPORT_DOMAINS
  if (/^(?:ecg|ekg|electrocardiogram)$/iu.test(modality)) return ECG_DOMAINS
  if (/^(?:xray|radiograph|radiografia|chest_xray|ct|mri|ultrasound|mammography)$/iu.test(modality))
    return IMAGING_DOMAINS
  return GENERIC_DOMAINS
}

function bounded(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f<>]/u.test(value))
    throw new Error('Invalid clinical evidence ' + label)
  return value.trim()
}

function optionalDimension(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1 || value > 100_000)
    throw new Error('Invalid source image dimension')
  return value
}

/**
 * Evaluate whether the *documentation* supports an AI draft without declaring
 * a patient normal, free of acute pathology, or clinically verified.
 * @param input - Anonymized source provenance, domain observations and claim.
 * @returns Auditable limitations and missing evidence; never a diagnosis.
 */
export function auditClinicalEvidenceDraft(input: ClinicalEvidenceInput) {
  const modality = bounded(input.modality, 80, 'modality')
  const sourceKind = bounded(input.sourceKind, 24, 'sourceKind')
  const sourceQuality = bounded(input.sourceQuality, 24, 'sourceQuality')
  const calibration = bounded(input.calibration, 24, 'calibration')
  const claim = bounded(input.claim, 48, 'claim')
  if (!['image', 'waveform', 'report', 'document'].includes(sourceKind)) throw new Error('Unknown source kind')
  if (!['adequate', 'limited', 'unknown'].includes(sourceQuality)) throw new Error('Unknown source quality')
  if (!['verified', 'unverified', 'not-applicable'].includes(calibration))
    throw new Error('Unknown calibration evidence')
  if (!['provisional', 'unremarkable', 'acute-condition-excluded'].includes(claim))
    throw new Error('Unsupported clinical clearance claim')
  if (typeof input.sourceReviewed !== 'boolean' || typeof input.urgencyReviewed !== 'boolean')
    throw new Error('Clinical source and urgency assessment flags are required')
  if (!Array.isArray(input.domains) || input.domains.length > 40) throw new Error('Invalid study observations')
  const required = domainsFor(modality, sourceKind)
  const observed = new Map<string, ObservedClinicalDomain>()
  for (const item of input.domains as unknown[]) {
    if (typeof item !== 'object' || item === null) throw new Error('Invalid evidence domain')
    const record = item as Record<string, unknown>
    const domain = bounded(record.domain, 80, 'domain')
    const status = bounded(record.status, 24, 'status')
    const evidence = bounded(record.evidence, 500, 'observation')
    if (!['assessed', 'not-assessable', 'not-reviewed'].includes(status)
      || observed.has(domain)) throw new Error('Duplicate or invalid evidence domain status')
    observed.set(domain, { domain, status: status as ObservedClinicalDomain['status'], evidence })
  }
  const imageWidth = optionalDimension(input.imageWidth)
  const imageHeight = optionalDimension(input.imageHeight)
  if ((imageWidth === undefined) !== (imageHeight === undefined))
    throw new Error('Image dimensions must be supplied together')
  const impression = input.impression === undefined ? '' : bounded(input.impression, 800, 'impression')
  const differential = input.differentials === undefined ? [] : input.differentials
  if (!Array.isArray(differential) || differential.length > 12
    || !differential.every(d => typeof d === 'string' && d.length <= 200))
    throw new Error('Invalid diagnostic differential')
  const missingDomains = required.filter(domain => {
    const found = observed.get(domain)
    return found?.status !== 'assessed' || found.evidence.length === 0
  })
  const verifiedIntervals = calibration === 'verified'
    && sourceQuality === 'adequate'
    && input.sourceReviewed === true
  const numericProvided = input.prMs !== undefined || input.qrsMs !== undefined
  for (const value of [input.prMs, input.qrsMs]) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value)
      || value <= 0 || value > 500)) throw new Error('Invalid numerical interval')
  }
  const hasObservedEvidence = [...observed.values()].some(
    entry => entry.status === 'assessed' && entry.evidence.length > 0)
  const documented = missingDomains.length === 0 && impression.length > 0
    && input.urgencyReviewed === true
  const sourceReviewed = input.sourceReviewed === true
  let decision: ClinicalEvidenceDecision = 'DRAFT_READY_FOR_CLINICIAN'
  if (!sourceReviewed || !hasObservedEvidence) decision = 'BLOCK_UNEXAMINED_SOURCE'
  else if (numericProvided && !verifiedIntervals) decision = 'BLOCK_UNVERIFIED_MEASUREMENT'
  else if (claim === 'acute-condition-excluded'
    || (claim === 'unremarkable' && (sourceQuality !== 'adequate'
      || calibration === 'unverified' || !documented)))
    decision = 'BLOCK_UNSUPPORTED_REASSURANCE'
  else if (!documented) decision = 'NEEDS_EVIDENCE_COMPLETION'
  return {
    decision,
    modality, sourceKind, sourceQuality, calibration,
    sourceReviewed, hasObservedEvidence,
    evaluatedDomains: required.filter(domain =>
      observed.get(domain)?.status === 'assessed' && (observed.get(domain)?.evidence.length ?? 0) > 0),
    missingDomains,
    sourceImageDimensions: imageWidth === undefined || imageHeight === undefined
      ? null : [imageWidth, imageHeight] as const,
    acceptedMeasuredIntervals: !numericProvided || verifiedIntervals,
    clinicalInterpretationVerifiedByThisTool: false,
    clinicianReviewRequired: true,
    canIssueFinalDiagnosis: false,
    canExcludeAcuteDisease: false,
    nextAction: decision === 'DRAFT_READY_FOR_CLINICIAN'
      ? 'Present source-grounded provisional findings and uncertainties for clinician review.'
      : 'Re-examine the actual study, fill missing evidence, or remove unsupported reassurance and measurements.',
  }
}
