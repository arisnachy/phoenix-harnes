/** Deterministic academic intake and page budget. No model-made evidence or page claims. */
import { defineTool, ToolArgsError, type ToolDefinition } from '@phoenix-ai/dsh-tools'

type Entry = 'apa7' | 'vancouver' | 'scientific_article'
type StudyType = 'brief' | 'monograph' | 'thesis' | 'research_protocol' | 'narrative_review'
  | 'systematic_review' | 'original_research' | 'journal_manuscript' | 'policy_report'
type Level = 'short' | 'monograph' | 'bachelors' | 'masters' | 'doctorate'

type Intake = {
  intent?: string
  entry?: Entry
  citation_style?: 'apa7' | 'vancouver'
  document_type?: StudyType
  level?: Level
  visual_preference?: 'standard' | 'premium'
  title?: string
  target_pages?: number
  page_scope?: 'all' | 'body' | 'unknown'
  cover?: {
    institution?: string
    author?: string
    authors?: Array<{ name?: string; student_id?: string }>
    logo_path?: string
    advisor?: string
    course?: string
    institutional_manual_path?: string
  }
}
const ENTRIES = [
  { id: 'apa7', label: 'Investigación APA 7', default_citation_style: 'apa7' },
  { id: 'vancouver', label: 'Investigación Vancouver', default_citation_style: 'vancouver' },
  { id: 'scientific_article', label: 'Artículo científico', default_citation_style: null },
] as const
const RANGES: Record<Level, readonly [number, number]> = {
  short: [10, 20], monograph: [20, 40], bachelors: [40, 80],
  masters: [60, 120], doctorate: [120, 250],
}
const THESIS_BUDGET = [
  ['preliminaries', 'Portada y preliminares', 9],
  ['introduction', 'Introducción', 4],
  ['problem', 'Planteamiento del problema y justificación', 6],
  ['objectives', 'Objetivos e hipótesis', 2],
  ['framework', 'Marco teórico y antecedentes', 15],
  ['methods', 'Metodología', 12],
  ['results', 'Resultados', 12],
  ['discussion', 'Discusión y análisis crítico', 9],
  ['conclusions', 'Conclusiones y recomendaciones', 5],
  ['references', 'Referencias bibliográficas', 6],
] as const
const ARTICLE_BUDGET = [
  ['abstract', 'Resumen estructurado', 1], ['introduction', 'Introducción', 1],
  ['methods', 'Métodos', 3], ['results', 'Resultados', 3],
  ['discussion', 'Discusión y limitaciones', 3], ['conclusions', 'Conclusiones', 1],
  ['references', 'Referencias', 2],
] as const
const PROTOCOL_BUDGET = [
  ['preliminaries', 'Portada y resumen', 2], ['introduction', 'Introducción y problema', 3],
  ['objectives', 'Objetivos e hipótesis', 2], ['framework', 'Estado del arte', 4],
  ['methods', 'Diseño y análisis previstos', 6], ['ethics', 'Ética y cronograma', 2],
  ['references', 'Referencias', 2],
] as const

function parse(input: unknown): Intake {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ToolArgsError(['Indica una intención o una entrada académica.'])
  const args = input as Intake
  if (args.entry !== undefined && !ENTRIES.some(e => e.id === args.entry)) throw new ToolArgsError(['Entrada inválida.'])
  if (args.level !== undefined && !Object.hasOwn(RANGES, args.level)) throw new ToolArgsError(['Nivel académico inválido.'])
  if (args.visual_preference !== undefined && !['standard', 'premium'].includes(args.visual_preference)) {
    throw new ToolArgsError(['Preferencia visual inválida.'])
  }
  const types: StudyType[] = ['brief', 'monograph', 'thesis', 'research_protocol', 'narrative_review',
    'systematic_review', 'original_research', 'journal_manuscript', 'policy_report']
  if (args.document_type !== undefined && !types.includes(args.document_type)) throw new ToolArgsError(['Tipo de estudio inválido.'])
  if (args.citation_style !== undefined && !['apa7', 'vancouver'].includes(args.citation_style)) {
    throw new ToolArgsError(['Estilo bibliográfico inválido.'])
  }
  if (args.target_pages !== undefined && (!Number.isInteger(args.target_pages) || args.target_pages < 1 || args.target_pages > 350)) {
    throw new ToolArgsError(['El objetivo debe estar entre 1 y 350 páginas.'])
  }
  if (args.page_scope !== undefined && !['all', 'body', 'unknown'].includes(args.page_scope)) {
    throw new ToolArgsError(['Alcance de paginación inválido.'])
  }
  return args
}
function chooseEntry(args: Intake): Entry | null {
  if (args.entry !== undefined) return args.entry
  const intent = (args.intent ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
  if (/articulo cientifico|journal (article|manuscript)|manuscrito cientifico/u.test(intent)) return 'scientific_article'
  if (/vancouver/u.test(intent)) return 'vancouver'
  if (/apa\s*7|apa\s*septima|normas?\s*apa|\bapa\b/u.test(intent)) return 'apa7'
  return args.citation_style ?? null
}
function allocate(input: ReadonlyArray<readonly [string, string, number]>, target: number) {
  const sum = input.reduce((total, item) => total + item[2], 0)
  const raw = input.map(row => row[2] * target / sum)
  const base = raw.map(Math.floor)
  const remaining = target - base.reduce((a, b) => a + b, 0)
  const ranking = raw.map((value, index) => ({ index, fraction: value - (base[index] ?? 0) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (const row of ranking.slice(0, remaining)) base[row.index] = (base[row.index] ?? 0) + 1
  return input.map(([kind, label], index) => ({ kind, label, pages: base[index] ?? 0 }))
}
/** Recommended bibliography coverage; never a universal university requirement. */
const THESIS_REFERENCE_GUIDANCE = {
  bachelors: { minimum: 20, suggested_maximum: 40 },
  masters: { minimum: 40, suggested_maximum: 80 },
  doctorate: { minimum: 100, suggested_maximum: null },
} as const

function inferThesisLevel(intent: string): Level | undefined {
  const text = intent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
  if (/doctorad|doctorat|ph\.?d|doctoral/u.test(text)) return 'doctorate'
  if (/maestria|master|magister/u.test(text)) return 'masters'
  if (/pregrado|licenciatura|grado|bachelor/u.test(text)) return 'bachelors'
  return undefined
}

/**
 * Construct a source-neutral academic intake and bounded page distribution.
 * @param input - user intent and optional research/cover/page constraints.
 * @returns structured intake, chapter plan, missing fields and unverified evidence status.
 */
function buildAcademicPlan(input: unknown) {
  const args = parse(input)
  const entry = chooseEntry(args)
  const intent = args.intent ?? ''
  const inferredLevel = args.level ?? inferThesisLevel(intent)
  const isThesis = /tesis|disertaci[oó]n|thesis|dissertation/iu.test(intent)
  const inferredType: StudyType = args.document_type ?? (entry === 'scientific_article'
    ? 'journal_manuscript' : isThesis || ['bachelors', 'masters', 'doctorate'].includes(inferredLevel ?? '')
      ? 'thesis' : 'monograph')
  const level = inferredLevel ?? (inferredType === 'thesis' ? 'masters'
    : inferredType === 'monograph' ? 'monograph' : 'short')
  const defaultRange: readonly [number, number] = inferredType === 'journal_manuscript'
    ? [8, 20] : inferredType === 'systematic_review' ? [20, 50] : RANGES[level]
  const suggestedPages = args.target_pages ?? Math.round((defaultRange[0] + defaultRange[1]) / 2)
  const outline = inferredType === 'journal_manuscript' || inferredType === 'original_research'
    || inferredType === 'narrative_review' || inferredType === 'systematic_review'
    ? ARTICLE_BUDGET : inferredType === 'research_protocol' ? PROTOCOL_BUDGET : THESIS_BUDGET
  const citationStyle = args.citation_style ?? (entry === 'scientific_article' ? null : entry)
  const missing = new Set<string>()
  if (entry === null) missing.add('entrada: APA 7, Vancouver o Artículo científico')
  if (citationStyle === null) missing.add('estilo de citas del artículo: APA 7 o Vancouver')
  const academic = entry !== 'scientific_article' && inferredType !== 'journal_manuscript'
  const cover = args.cover
  if (academic) {
    if (typeof cover?.institution !== 'string' || !cover.institution.trim()) missing.add('institución')
    const namedAuthors = Array.isArray(cover?.authors) && cover.authors.some(author =>
      typeof author.name === 'string' && author.name.trim() !== '')
    if ((typeof cover?.author !== 'string' || !cover.author.trim()) && !namedAuthors) missing.add('participantes')
  }
  if (args.target_pages !== undefined && (args.page_scope === undefined || args.page_scope === 'unknown')) {
    missing.add('si las páginas incluyen portada, bibliografía y anexos')
  }
  const sourceTarget = inferredType === 'thesis' && Object.hasOwn(THESIS_REFERENCE_GUIDANCE, level)
    ? THESIS_REFERENCE_GUIDANCE[level as keyof typeof THESIS_REFERENCE_GUIDANCE] : null
  const premium = args.visual_preference === 'premium' || /hermos[oa]|premium|elegante|bonit[oa]/iu.test(intent)
  const checklist = inferredType === 'research_protocol' ? 'protocolo: resultados esperados, no hallazgos inventados'
    : inferredType === 'systematic_review' ? 'PRISMA 2020 cuando la búsqueda y selección estén documentadas'
      : inferredType === 'original_research' ? 'STROBE/CONSORT/COREQ/SRQR según el diseño realmente ejecutado'
        : 'estructura, citas y requisitos de institución o revista'
  return {
    state: missing.size ? 'INTAKE_INCOMPLETE' : 'PLAN_READY',
    entries: ENTRIES.map(row => ({ ...row })),
    entry, citation_style: citationStyle, document_type: inferredType,
    presentation: entry === 'scientific_article' ? 'hybrid' : 'academic',
    level, title: args.title ?? null,
    reference_guidance: sourceTarget === null ? null : {
      ...sourceTarget, policy: 'advisory', precedence: 'reviewed_institutional_manual',
      counted_as: 'distinct verified and cited sources',
      note: 'Rango orientativo, no mínimo universal. La norma institucional revisada prevalece.',
    },
    citation_requirements: citationStyle === 'apa7'
      ? { style: 'apa7', citations: 'author-date', bibliography: 'alphabetical', edition: 7 }
      : citationStyle === 'vancouver'
        ? { style: 'vancouver', citations: 'numeric', bibliography: 'first-appearance', guide: 'ICMJE/NLM' }
        : null,
    visual_plan: {
      preference: premium ? 'premium' : 'standard',
      layout: academic ? 'formal-academic' : 'professional-editorial',
      design_preset: academic ? 'academic_classic' : 'auto',
      evidence_required: true,
      recommended_charts: ['bar', 'line', 'scatter', 'forest'],
      table_and_figure_rules: 'Numeración, títulos, fuente, unidades y notas; sin datos inventados.',
      note: 'Gráficos elegantes solo con datos verificables y respetando la plantilla institucional.',
    },
    pages: { target: suggestedPages, explicitly_requested: args.target_pages !== undefined,
      suggested_range: [...defaultRange], scope: args.page_scope ?? 'unknown',
      page_plan: allocate(outline, suggestedPages), planned_total: suggestedPages,
      verification: 'pending PDF rendering; never pad invented evidence' },
    missing_fields: [...missing],
    cover_fields: ['institution', 'faculty', 'department', 'degree', 'course', 'course_code',
      'lecturer', 'advisor', 'city', 'country', 'date', 'logo_path', 'authors[{name, student_id, affiliation, orcid}]',
      'institutional_manual_path', 'dedication', 'acknowledgements'],
    reporting_standard_hint: checklist,
    evidence_status: 'not_verified',
    research_workflow: {
      minimum_distinct_cited_sources: sourceTarget?.minimum ?? null,
      evidence_collection: ['scope and questions', 'official institutions by source batches',
        'scientific literature by subtopic and pagination', 'DOI/PMID and primary document verification',
        'deduplicate and assess study quality', 'gap analysis and focused searches', 'write and audit'],
      note: 'Source counts are advisory, not global caps or evidence-quality certification. Never treat a subagent limit of 15 as the thesis reference limit.',
      blocked_sources: 'Report institution, dataset, required years, status and replacement without inventing values.',
    },
    guidance: 'Recopila juntos los campos ausentes. Si hay manual o plantilla institucional, extrae primero sus reglas. Para tesis usa la orientación de referencias solo como advertencia, prioriza calidad y citas reales. Respeta APA 7/Vancouver y diseña figuras elegantes únicamente con datos auténticos. Verifica DOI/PMID; no inventes resultados, permisos ni bibliografía.',
  }
}
/**
 * Plan a thesis with typed chapters, citations, guidance, and source provenance checks.
 * @param input - the user's academic research request.
 * @returns a level-aware plan with nonbinding source recommendations.
 */
export function planAcademicResearch(input: unknown): ReturnType<typeof buildAcademicPlan> {
  return buildAcademicPlan(input)
}

/**
 * Expose the deterministic planner through Phoenix's governed tool registry.
 * @returns the model-facing academic planning tool.
 */
export function createResearchPlanTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_research_plan',
    description: 'PLANIFICA investigación científica y tesis de pregrado, maestría y doctorado. Recibe input:{intent,level,citation_style,document_type,target_pages,page_scope,cover?}; también acepta los mismos campos sin input. Los datos de portada son opcionales en la fase de búsqueda: si falla su esquema, reintenta con intent,level,citation_style y target_pages, NO suspendas la misión. Orquesta búsquedas institucionales por lotes (research_search domain=public_health batch=0..3 para APS RD), literatura temática paginada (research_scholar cursor_mark), verificación bibliográfica, evaluación de sesgos, análisis de vacíos y redacción. 15 referencias de un subagente nunca son el techo de una tesis: metas orientativas 20–40/40–80/100+ por nivel; prevalece manual universitario. APA7/Vancouver exactos, gráficos con fuentes y paginación real, no datos inventados.',
    parameters: {
      input: { type: 'object', additionalProperties: true,
        description: 'Objeto con intent, citation_style, document_type, level, target_pages; portada opcional.' },
      intent: { type: 'string', description: 'Intención académica; usar si no se suministra input.' },
      entry: { type: 'string', description: 'apa7, vancouver, scientific_article' },
      citation_style: { type: 'string', description: 'apa7 o vancouver' },
      document_type: { type: 'string', description: 'thesis, monograph, research_protocol, etc.' },
      level: { type: 'string', description: 'bachelors, masters, doctorate, etc.' },
      target_pages: { type: 'integer', description: 'Objetivo estimado de páginas (no contenido ya escrito).' },
      page_scope: { type: 'string', description: 'all, body o unknown' },
      visual_preference: { type: 'string', description: 'standard o premium' },
      cover: { type: 'object', additionalProperties: true, description: 'Portada opcional, no bloqueante.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text',
        text: 'Plan académico: ' + (typeof value.document_type === 'string' ? value.document_type : 'monograph')
          + '; estilo: ' + (typeof value.citation_style === 'string' ? value.citation_style : 'por definir')
          + '; referencia orientativa: ' + JSON.stringify(value.reference_guidance)
          + '; diseño: ' + JSON.stringify(value.visual_plan)
          + '; estado: ' + (typeof value.state === 'string' ? value.state : 'INTAKE_INCOMPLETE')
          + '. Extensión estimada, NO páginas escritas: '
          + String((value.pages as Record<string, unknown>).target)
          + '. Campos pendientes: ' + (Array.isArray(value.missing_fields)
          ? value.missing_fields.map(String).join(', ') : 'ninguno'),
      }],
    },
    execute(args) { return Promise.resolve(planAcademicResearch(args.input ?? args)) },
    presentCall() { return { card: 'generic', title: 'Plan académico y extensión verificable', kind: 'execute' } },
  })
}
