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
  title?: string
  target_pages?: number
  page_scope?: 'all' | 'body' | 'unknown'
  visual_mode?: 'formal' | 'enhanced'
  cover?: { institution?: string; author?: string; authors?: Array<{ name?: string; student_id?: string }>;
    logo_path?: string; advisor?: string; course?: string; institutional_manual_path?: string }
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
/** Editorial evidence targets are guidance, never universal university requirements. */
export const THESIS_REFERENCE_TARGETS = {
  bachelors: { min: 20, max: 40, emphasis: 'artículos científicos y libros fundamentales' },
  masters: { min: 40, max: 80, emphasis: 'artículos indexados, relevantes y recientes' },
  doctorate: { min: 100, max: null, emphasis: 'literatura internacional amplia y síntesis crítica verificable' },
} as const

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
  const types: StudyType[] = ['brief', 'monograph', 'thesis', 'research_protocol', 'narrative_review',
    'systematic_review', 'original_research', 'journal_manuscript', 'policy_report']
  if (args.document_type !== undefined && !types.includes(args.document_type)) throw new ToolArgsError(['Tipo de estudio inválido.'])
  if (args.citation_style !== undefined && args.citation_style !== 'apa7' && args.citation_style !== 'vancouver') throw new ToolArgsError(['Estilo bibliográfico inválido.'])
  if (args.target_pages !== undefined && (!Number.isInteger(args.target_pages) || args.target_pages < 1 || args.target_pages > 350)) {
    throw new ToolArgsError(['El objetivo debe estar entre 1 y 350 páginas.'])
  }
  if (args.page_scope !== undefined && !['all', 'body', 'unknown'].includes(args.page_scope)) {
    throw new ToolArgsError(['Alcance de paginación inválido.'])
  }
  if (args.visual_mode !== undefined && !['formal', 'enhanced'].includes(args.visual_mode)) {
    throw new ToolArgsError(['visual_mode debe ser formal o enhanced.'])
  }
  if (args.document_type === 'thesis' && args.level !== undefined
    && args.level !== 'bachelors' && args.level !== 'masters' && args.level !== 'doctorate') {
    throw new ToolArgsError(['La tesis requiere nivel bachelors, masters o doctorate.'])
  }
  return args
}
function chooseEntry(args: Intake): Entry | null {
  if (args.entry !== undefined) return args.entry
  const intent = (args.intent ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
  if (/articulo cientifico|journal (article|manuscript)|manuscrito cientifico/u.test(intent)) return 'scientific_article'
  if (/vancouver/u.test(intent)) return 'vancouver'
  if (/\bapa(?:\s*7|\s*septima)?\b|\bnormas?\s*apa\b/u.test(intent)) return 'apa7'
  if (args.citation_style !== undefined) return args.citation_style
  return null
}
function allocate(input: ReadonlyArray<readonly [string, string, number]>, target: number) {
  const sum = input.reduce((total, item) => total + item[2], 0)
  const raw = input.map(row => row[2] * target / sum)
  const base = raw.map(Math.floor)
  const remaining = target - base.reduce((a, b) => a + b, 0)
  const ranking = raw.map((value, index) => ({ index, fraction: value - base[index]! }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (const row of ranking.slice(0, remaining)) base[row.index]! += 1
  return input.map(([kind, label], index) => ({ kind, label, pages: base[index]! }))
}
/**
 * Construct a source-neutral academic intake and bounded page distribution.
 * @param input - user intent and optional research/cover/page constraints.
 * @returns structured intake, chapter plan, missing fields and unverified evidence status.
 */
export function planAcademicResearch(input: unknown) {
  const args = parse(input)
  const entry = chooseEntry(args)
  const intent = (args.intent ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
  const visualMode = args.visual_mode ?? (/hermos|bonit|elegant|premium|atractiv|modern/u.test(intent)
    ? 'enhanced' : 'formal')
  const inferredType: StudyType = args.document_type ?? (entry === 'scientific_article'
    ? 'journal_manuscript' : /\b(tesis|thesis|disertacion|dissertation)\b/u.test(intent)
      || args.level === 'masters' || args.level === 'doctorate' ? 'thesis' : 'monograph')
  const level = args.level ?? (inferredType === 'thesis' ? 'masters'
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
  if (inferredType === 'thesis' && args.level === undefined) missing.add('nivel de tesis: licenciatura, maestría o doctorado')
  if (academic) {
    if (!cover?.institution) missing.add('institución')
    if (!cover?.author && !cover?.authors?.some(a => a.name?.trim())) missing.add('participantes')
  }
  if (args.target_pages !== undefined && (args.page_scope === undefined || args.page_scope === 'unknown')) {
    missing.add('si las páginas incluyen portada, bibliografía y anexos')
  }
  const checklist = inferredType === 'research_protocol' ? 'protocolo: resultados esperados, no hallazgos inventados'
    : inferredType === 'systematic_review' ? 'PRISMA 2020 cuando la búsqueda y selección estén documentadas'
      : inferredType === 'original_research' ? 'STROBE/CONSORT/COREQ/SRQR según el diseño realmente ejecutado'
        : 'estructura, citas y requisitos de institución o revista'
  const referenceTarget = inferredType === 'thesis' && args.level !== undefined
    ? THESIS_REFERENCE_TARGETS[args.level as keyof typeof THESIS_REFERENCE_TARGETS] : undefined
  const citationGuidance = citationStyle === 'vancouver'
    ? ['citas numéricas por orden de primera aparición', 'bibliografía numerada correlativamente',
      'abreviaturas de revistas según índice aplicable y comprobación de DOI/PMID']
    : ['APA 7: citas autor-fecha', 'referencias en orden alfabético',
      'DOI, volumen, número, páginas y cursivas según el tipo de fuente']
  return {
    state: missing.size ? 'INTAKE_INCOMPLETE' : 'PLAN_READY',
    entries: ENTRIES.map(row => ({ ...row })),
    entry, citation_style: citationStyle, document_type: inferredType,
    presentation: entry === 'scientific_article' || visualMode === 'enhanced' ? 'hybrid' : 'academic',
    level, title: args.title ?? null,
    pages: { target: suggestedPages, explicitly_requested: args.target_pages !== undefined,
      suggested_range: [...defaultRange], scope: args.page_scope ?? 'unknown',
      page_plan: allocate(outline, suggestedPages), planned_total: suggestedPages,
      verification: 'pending PDF rendering; never pad invented evidence' },
    missing_fields: [...missing],
    cover_fields: ['institution', 'faculty', 'department', 'degree', 'course', 'course_code',
      'lecturer', 'advisor', 'city', 'country', 'date', 'logo_path', 'authors[{name, student_id, affiliation, orcid}]',
      'institutional_manual_path', 'dedication', 'acknowledgements'],
    reporting_standard_hint: checklist,
    reference_guidance: referenceTarget ? {
      min: referenceTarget.min, max: referenceTarget.max, emphasis: referenceTarget.emphasis,
      advisory_only: true, verified_count: 0, status: 'not_assessed',
      priority: 'manual institucional verificado > instrucciones expresas > guía orientativa',
      note: 'Rangos orientativos, NO mínimos universales. La cantidad no sustituye pertinencia, rigor ni calidad de las fuentes.',
    } : null,
    citation_guidance: {
      style: citationStyle, requirements: citationStyle === null ? [] : citationGuidance,
      verify_in_text_and_bibliography: true,
      note: 'El publicador recibe style=apa7 o style=vancouver y transforma [@key] según el formato; verificar reglas institucionales.',
    },
    visual_guidance: {
      presentation: visualMode === 'enhanced' ? 'hybrid' : 'academic',
      design_preset: visualMode === 'enhanced' ? 'minimal_graphite' : 'academic_classic',
      intent: 'diseño académico elegante, legible y coherente, subordinado al manual institucional',
      figures: ['barras para comparaciones', 'líneas para tendencias', 'dispersión para relaciones',
        'forest para metaanálisis con intervalos reales', 'diagrama de flujo para métodos documentados'],
      safeguards: ['solo datos reales con fuentes', 'títulos, ejes, unidades, leyenda y texto alternativo',
        'tablas y figuras numeradas, accesibles y sin ornamentos que contradigan APA o Vancouver'],
    },
    evidence_status: 'not_verified',
    guidance: 'Recopila juntos los campos ausentes. Si hay manual o plantilla institucional, extrae primero sus reglas. Verifica cada DOI/PMID y la existencia de los estudios; no inventes resultados, permisos éticos ni bibliografía.',
  }
}
/**
 * Expose the deterministic planner through Phoenix's governed tool registry.
 * @returns the model-facing academic planning tool.
 */
export function createResearchPlanTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_research_plan',
    description: 'PLANIFICA ANTES DE REDACTAR una investigación APA 7, Vancouver o Artículo científico. Para tesis usa guías orientativas de 20-40 referencias (licenciatura), 40-80 (maestría) y 100+ (doctorado), sin afirmar mínimos universales; prevalece el manual institucional confirmado. Incluye reglas de citas y diseño académico clásico con tablas y gráficos respaldados por datos reales.  Detecta la intención y devuelve una SOLA agrupación de datos faltantes, capítulos, presupuesto de páginas (10-250+ según nivel), recomendación académica, advertencias de métodos y alcance de páginas. Artículo científico es un tipo de documento distinto de APA/Vancouver, que son estilos bibliográficos. Si hay guía institucional, léela antes de cerrar el plan; no presumas requisitos universales. Úsalo antes de phoenix_research_publish para tesis, monografías, protocolos, artículos, revisiones y trabajos de 60-120 páginas.',
    parameters: { input: { type: 'object', required: true, additionalProperties: true,
      description: 'intent, entry (apa7/vancouver/scientific_article), citation_style, document_type, level (bachelors/masters/doctorate para tesis), title, target_pages, page_scope, visual_mode (formal/enhanced), cover con datos ya conocidos.' } },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text',
        text: 'Plan académico: ' + String(value.document_type)
          + '; estilo: ' + String(value.citation_style ?? 'por definir')
          + '; estado: ' + String(value.state)
          + '. Extensión estimada, NO páginas escritas: '
          + String((value.pages as Record<string, unknown>).target)
          + '. Campos pendientes: ' + (Array.isArray(value.missing_fields)
            ? value.missing_fields.map(String).join(', ') : 'ninguno'),
      }],
    },
    async execute(args) { return planAcademicResearch(args.input) },
    presentCall() { return { card: 'generic', title: 'Plan académico y extensión verificable', kind: 'execute' } },
  })
}
