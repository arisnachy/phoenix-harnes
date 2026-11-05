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

const FIRST_PASS = '<first_pass_quality>\nBefore the first action, lock the deliverable, hard constraints, assumptions, and observable acceptance evidence. Challenge the highest-impact assumption with a credible alternative. Make the shortest tool call that yields relevant evidence; check while executing, not in a ceremonial extra round. Verify the actual requested output and never invent completion or repeat unchanged work.'
// A question about the best option is a real decision even without "please plan".
// oxlint-disable-next-line @stylistic/max-len -- Optimization questions require comparing alternatives.
const DECISION_QUESTION = /\b(?:cu[aá]l(?:es)?|which|what)\b.{0,90}(?:mejor|[oó]ptim\p{L}*|m[aá]s\s+barat\p{L}*|m[aá]s\s+eficient\p{L}*|cheapest|best|optimal|minimum|maximum)/iu
// oxlint-disable-next-line @stylistic/max-len -- A question about viability is not idle conversation.
const FEASIBILITY_QUESTION = /\b(?:es\s+posible|se\s+puede|ser[ií]a\s+viable|is\s+it\s+possible|is\s+it\s+feasible|can\s+we)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Bilingual action conjugations avoid costly classifier calls.
const ACTION_ADDITIONAL = /\b(?:resu[eé]lv\p{L}*|resolv\p{L}*|solucion\p{L}*|planific\p{L}*|program\p{L}*|analiz\p{L}*|investig\p{L}*|revis\p{L}*|arregl\p{L}*|corrig\p{L}*|optimiz\p{L}*|compar\p{L}*|comprob\p{L}*|verific\p{L}*|asign\p{L}*|distribu\p{L}*|repart\p{L}*|organiza\p{L}*|calcul\p{L}*|demuestr\p{L}*|demostr\p{L}*|valida\p{L}*|redact\p{L}*|ay[uú]dame)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Broad but deterministic decision vocabulary.
const DECISION_ADDITIONAL = /\b(?:plans?|planes|planific\p{L}*|asignaci[oó]n|optimizaci[oó]n|planificaci[oó]n|turnos?|opciones?|alternativas?|soluci[oó]n|elegir|escoger|best|cheapest|cohortes?|cupos?|recursos?|itinerarios?|distribuci[oó]n)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Efficiency constraints trigger bounded checks.
const PERFORMANCE = /\b(?:latencia|latency|rendimiento|performance|escalabilidad|scalability|tiempo\s+de\s+ejecuci[oó]n|execution\s+time|sin\s+demoras|sin\s+aumentar\s+(?:el\s+)?tiempo|without\s+extra\s+calls|benchmark\p{L}*)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Explicit non-domain problem solving may still merit the universal contract.
const GENERAL_PROBLEM = /\b(?:problemas?|problems?|casos?|cases?|tareas?|tasks?|resu[eé]lv\p{L}*|solucion\p{L}*)\b/iu

/** Each group is a single local string addition, never another model step. */
// oxlint-disable-next-line @stylistic/max-len -- Match actual interactive calculators, scales, tests and forms.
const INTERACTIVE_FORM = /\b(?:calculadora\p{L}*|calculator\p{L}*|formulario\p{L}*|forms?|quiz(?:zes)?|cuestionario\p{L}*|escala\s+(?:cl[ií]nica|de\s+riesgo|de\s+puntuaci[oó]n)|(?:imc|bmi)\s+calculator)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Specific requests for scored instruments in any domain.
const ASSESSMENT_FORM = /\\b(?:mini[ -]?cog|deterioro\\s+cognitivo|cognitive\\s+(?:impairment|screening)|prueba\\s+(?:psicol[oó]gica|m[eé]dica|cognitiva)|evaluaci[oó]n\\s+(?:cognitiva|psicol[oó]gica)|assessment|tamizaje|cribado|inventario|cuestionario|escala(?:s)?|likert|psychometric|psicom[eé]tric\\p{L}*)\\b/iu
const MAX_CHECK_GROUPS = 3
const DOMAIN_CHECKS = {
  decisions: 'For feasibility: separate constraints from assumptions; compare alternatives, seek a counterexample and prove the bound or qualify optimality/impossibility claims.',
  quantities: 'For quantitative claims: recompute material totals, rates, units and reserves from stated inputs.',
  code: 'For implementation: inspect the affected entrypoint and run one focused executable check.',
  evidence: 'For research: verify source, date and contradictions; separate evidence from inference.',
  artifact: 'For deliverables: inspect the actual generated file or live output for correctness, completeness and format.',
  performance: 'For efficiency: avoid redundant calls and test one relevant worst-case input.',
  interactive: 'For calculators: emit native smart_form with input-dependent outputs.expression and live results, never decorative buttons.',
  assessment: 'For tests, scales and assessments: distinguish administration from score entry. Use scale_form with administration steps (prepare/administer/score), item options and exact points, scoring min/max, source, version, population and cautious interpretation; or smart_form for complex expressions. Verify an officially named protocol and authorized language version; never invent clinical validity, cutoffs or licensed test stimuli. Show what is missing instead of pretending a two-question score entry is the entire instrument.',
} as const

/**
 * Return a concise first-request quality contract for a substantive task.
 * Nothing here authorizes tools, creates agents, blocks a turn or starts a retry.
 * @param userText - Original directly supplied human text, never tool output.
 * @returns A short trusted system section, or empty string for ordinary chat.
 */
export function firstPassQualityGuidance(userText: string): string {
  const text = userText.slice(0, 16_000).trim()
  if (text.length === 0) return ''
  const decision = DECISION.test(text) || DECISION_ADDITIONAL.test(text)
  const assessment = ASSESSMENT_FORM.test(text)
  const interactive = INTERACTIVE_FORM.test(text) || assessment
  const actionable = ACTION.test(text) || ACTION_ADDITIONAL.test(text) || interactive
    || (decision && (DECISION_QUESTION.test(text) || FEASIBILITY_QUESTION.test(text)))
  if (!actionable) return ''
  const quantities = QUANTITIES.test(text)
  const code = CODE.test(text)
  const evidence = EVIDENCE.test(text)
  const artifact = ARTIFACT.test(text)
  const performance = PERFORMANCE.test(text)
  if (!decision && !quantities && !code && !evidence && !artifact && !performance
    && !interactive && !GENERAL_PROBLEM.test(text) && !(text.length > 240 && COMPLEX.test(text))) return ''

  // Group related risks instead of truncating the last requested deliverable.
  // Six possible concerns fit in at most three bounded groups, with no extra
  // model/tool call. The grouping preserves source and artifact checks even when
  // planning + code + numbers occur in the same request.
  const planning = [
    ...(decision ? [DOMAIN_CHECKS.decisions] : []),
    ...(quantities ? [DOMAIN_CHECKS.quantities] : []),
  ]
  const execution = [
    ...(assessment ? [DOMAIN_CHECKS.assessment] : interactive ? [DOMAIN_CHECKS.interactive] : []),
    ...(code ? [DOMAIN_CHECKS.code] : []),
    ...(artifact ? [DOMAIN_CHECKS.artifact] : []),
    ...(performance ? [DOMAIN_CHECKS.performance] : []),
  ]
  const provenance = evidence ? [DOMAIN_CHECKS.evidence] : []
  const groups = [planning, execution, provenance]
    .filter(group => group.length > 0)
    .slice(0, MAX_CHECK_GROUPS)
    .map(group => group.join(' '))
  return FIRST_PASS + (groups.length > 0 ? '\n' + groups.join('\n') : '')
    + '\n</first_pass_quality>'
}
