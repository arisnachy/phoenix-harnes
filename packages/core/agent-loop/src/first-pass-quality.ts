/**
 * Zero-tool, zero-extra-model-turn quality preflight for substantive user tasks.
 * The section is computed from the incoming user message only. All checks happen
 * inside the existing model request, leaving conversation and continuation fast paths intact.
 * @module dsh-agent-loop/first-pass-quality
 */

// oxlint-disable-next-line @stylistic/max-len -- Closed bilingual matcher kept auditable as one regex.
const ACTION = /\b(?:build|implement|develop|fix|repair|create|write|draft|prepare|plan|compare|analyse|analyze|research|investigate|review|audit|design|generate|optimize|solve|evaluate|improve|deliver|make|need|want|haz|hacer|crea|crear|escribe|redacta|prepara|preparar|planifica|planificar|compara|comparar|analiza|analizar|investiga|investigar|revisa|revisar|diseña|diseñar|genera|generar|optimiza|optimizar|resuelve|resolver|eval[uú]a|evaluar|mejora|mejorar|entrega|entregar|arregla|arreglar|corrige|corregir|quiero|necesito)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Closed bilingual matcher kept auditable as one regex.
const DECISION = /\b(?:schedule|scheduling|calendar|calendario|programaci[oó]n|planning|planificaci[oó]n|allocation|asignaci[oó]n|constraints?|restricciones?|capacity|capacidad|feasib\w*|viab\w*|factib\w*|infeasib\w*|imposib\w*|optimal|optimum|optimiza\w*|minimum|minimize|maximum|maximize|m[ií]nim\w*|m[aá]xim\w*|alternativas?|alternatives?|decision|decisi[oó]n)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Closed bilingual matcher kept auditable as one regex.
const QUANTITIES = /\b(?:budgets?|presupuestos?|costs?|costos?|precios?|prices?|totals?|sumas?|rates?|tarifas?|percentages?|porcentajes?|statistics|estad[ií]sticas?|forecast|pron[oó]stico|financial|financier\w*|revenue|ingresos?|profit|beneficios?|calculat\w*|c[aá]lcul\w*)\b|\d+\s*%/iu
// oxlint-disable-next-line @stylistic/max-len -- Closed bilingual matcher kept auditable as one regex.
const CODE = /\b(?:repository|repositorio|code|c[oó]digo|software|script|function|funci[oó]n|typescript|javascript|python|api|tests?|pruebas?|bugs?|errores?|compile|compilar|build|app|aplicaci[oó]n|website|sitio\s+web|frontend|backend)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Closed bilingual matcher kept auditable as one regex.
const EVIDENCE = /\b(?:research|investigaci[oó]n|investiga\w*|sources?|fuentes?|citations?|citas?|evidence|evidencia|referencias?|references?|papers?|art[ií]culos?|news|noticias?|current|actualizad\w*)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Closed bilingual matcher kept auditable as one regex.
const ARTIFACT = /\b(?:docx|word|pdf|pptx|powerpoint|slides?|diapositivas?|spreadsheets?|excel|documentos?|documents?|archivos?|files?|reportes?|informes?|artifacts?|entregables?|presentaciones?|presentations?)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Closed bilingual matcher kept auditable as one regex.
const COMPLEX = /\b(?:professional|profesional|complete|completo|integral|exhaustive|exhaustivo|complex|complejo|production|producci[oó]n|rigorous|riguroso|high-quality|calidad)\b/iu

const FIRST_PASS = '<first_pass_quality>\nBefore the first action, silently lock the requested deliverable, non-negotiable constraints, assumptions and acceptance evidence. Challenge the highest-impact assumption with a credible alternative before committing to a plan. Reuse the shortest authorized tool path and perform the highest-value check while doing the work, not in a ceremonial extra round. Avoid redundant planners, reviewers, repeated reads and unverified success claims.'
const DOMAIN_CHECKS = {
  decisions: 'For feasibility, impossibility, uniqueness or optimality: compare genuine options, seek a counterexample, and prove the bound with an appropriate tool or explicitly qualify the claim.',
  quantities: 'For quantitative claims: recompute material totals, rates, units, margins and reserves from primary inputs.',
  code: 'For implementation: identify the affected entrypoint and failure mode; make the smallest coherent change and run one focused executable check.',
  evidence: 'For research: confirm the material source, date and contradiction risks; distinguish verified observations from inference.',
  artifact: 'For deliverables: inspect the actual generated file or live result against requested format, content and usability.',
} as const

/**
 * Return a concise first-request quality contract for a substantive task.
 * Nothing here authorizes tools, creates agents, blocks a turn or starts a retry.
 * @param userText - Original directly supplied human text, never tool output.
 * @returns A short trusted system section, or empty string for ordinary chat.
 */
export function firstPassQualityGuidance(userText: string): string {
  const text = userText.slice(0, 16_000).trim()
  if (text.length === 0 || !ACTION.test(text)) return ''
  const decision = DECISION.test(text)
  const quantities = QUANTITIES.test(text)
  const code = CODE.test(text)
  const evidence = EVIDENCE.test(text)
  const artifact = ARTIFACT.test(text)
  if (!decision && !quantities && !code && !evidence && !artifact
    && !(text.length > 240 && COMPLEX.test(text))) return ''

  const checks: string[] = []
  if (decision) checks.push(DOMAIN_CHECKS.decisions)
  if (quantities) checks.push(DOMAIN_CHECKS.quantities)
  if (code) checks.push(DOMAIN_CHECKS.code)
  if (evidence) checks.push(DOMAIN_CHECKS.evidence)
  if (artifact) checks.push(DOMAIN_CHECKS.artifact)
  return FIRST_PASS + (checks.length > 0 ? '\n' + checks.join(' ') : '') + '\n</first_pass_quality>'
}
