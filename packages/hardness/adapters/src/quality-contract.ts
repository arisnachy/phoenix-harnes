/** Task-specific quality requirements layered on HARDNESS completion. */

const MAX_REQUIREMENTS = 8

const GENERAL_REQUIREMENTS = [
  'The final result is complete, internally consistent, and usable without unfinished placeholders, scaffolds, mocks, or partial substitutes.',
  'Every critical behavior or conclusion is supported by reproducible evidence, deterministic verification, or independently inspectable output.',
  'Relevant failure modes, assumptions, edge cases, and limitations are checked rather than silently ignored.',
] as const

const SOFTWARE_REQUIREMENTS = [
  'Critical software behavior is covered by executable tests, type checks, or equivalent deterministic verification.',
  'Error handling, recovery paths, and important failure conditions are exercised and shown to behave robustly.',
  'Security boundaries, permissions, unsafe inputs, credentials, and externally controlled data are handled without avoidable exposure or unsafe defaults.',
] as const

const UI_REQUIREMENTS = [
  'Visual output is inspected in a rendered form or screenshot at the relevant viewport rather than inferred from source code alone.',
  'The interface remains coherent and usable across relevant responsive sizes without overlap, clipping, or inaccessible controls.',
  'Accessibility basics relevant to the surface, including semantics, keyboard use, readable contrast, and understandable labels, are verified.',
] as const

const RESEARCH_REQUIREMENTS = [
  'Material factual claims are traceable to appropriate sources, citations, or directly inspectable evidence.',
  'Unsupported claims, source contradictions, uncertainty, and material factual gaps are identified rather than presented as established fact.',
  'The reasoning and document structure are complete enough that a reviewer can follow how the evidence supports the conclusions.',
] as const

const DATA_REQUIREMENTS = [
  'The analysis is reproducible from identified inputs, transformations, assumptions, and calculations.',
  'Inputs, intermediate results, and outputs receive validation, sanity checks, or cross-checks appropriate to the analysis.',
  'Material data limitations, missingness, uncertainty, and interpretation risks are surfaced in the final result.',
] as const

const AUTOMATION_REQUIREMENTS = [
  'The automation or integration is verified end-to-end at its real boundary, including authentication and external hand-offs where available.',
  'Retries, idempotency, interruption, duplicate execution, and restart behavior are handled where the operation can be repeated or resumed.',
  'Credentials, authorization state, user data, and external inputs are kept within the intended security and permission boundaries.',
] as const

function requestText(need: unknown): string {
  try { return JSON.stringify(need).toLocaleLowerCase() } catch { return String(need).toLocaleLowerCase() }
}

function matches(value: string, pattern: RegExp): boolean { return pattern.test(value) }

/**
 * Derive a bounded quality contract from a capability request.
 * Generic guarantees always remain; relevant domain requirements are appended.
 */
export function qualityRequirementsForNeed(need: unknown): readonly string[] {
  const text = requestText(need)
  const requirements: string[] = [...GENERAL_REQUIREMENTS]

  if (matches(text, /\b(?:code|software|program|application|app|web|api|service|typescript|javascript|python|node|backend|frontend)\b/u)) {
    requirements.push(...SOFTWARE_REQUIREMENTS)
  }
  if (matches(text, /\b(?:ui|ux|visual|interface|dashboard|frontend|website|layout|responsive|design|presentation|slide)\b/u)) {
    requirements.push(...UI_REQUIREMENTS)
  }
  if (matches(text, /\b(?:research|report|document|paper|literature|evidence|review|study|citation|source)\b/u)) {
    requirements.push(...RESEARCH_REQUIREMENTS)
  }
  if (matches(text, /\b(?:analysis|analyze|analytics|data|dataset|spreadsheet|statistics|statistical|table|csv)\b/u)) {
    requirements.push(...DATA_REQUIREMENTS)
  }
  if (matches(text, /\b(?:automation|integration|connector|oauth|mcp|workflow|scheduler|scheduled|webhook|sync)\b/u)) {
    requirements.push(...AUTOMATION_REQUIREMENTS)
  }

  return [...new Set(requirements)].slice(0, MAX_REQUIREMENTS)
}
