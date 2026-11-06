/** Domain-specific professional research guidance, without claiming empirical verification. */
export type ExpertDiscipline = 'medicine' | 'neuroscience' | 'public_health' | 'science' | 'engineering'
  | 'software' | 'law' | 'economics' | 'finance' | 'sports' | 'education' | 'general'

/** Evidence is read but not necessarily independently fact-checked. */
export interface ExpertEvidenceInput {
  readonly question: string
  readonly domain: string
  readonly readRelevantCount: number
  readonly independentReadCount: number
  readonly duplicateContentCount: number
  readonly challengesCount: number
  readonly budgetExhausted: boolean
}

/** Structured requirements for the specialist answer and verified visual output. */
export interface ExpertResearchContract {
  readonly discipline: ExpertDiscipline
  readonly technicalDimensions: readonly string[]
  readonly requiredSections: readonly string[]
  readonly specialistChecks: readonly string[]
  readonly evidenceState: 'not_read' | 'single_owner_unverified' | 'multiple_owners_unverified'
  readonly evidenceGaps: readonly string[]
  readonly visualRules: readonly string[]
  readonly deliveryRules: readonly string[]
}

const DOMAINS: Record<string, ExpertDiscipline> = {
  medicine: 'medicine', neuroscience: 'neuroscience',
  public_health: 'public_health', science: 'science', patents: 'science',
  agriculture: 'science', environment: 'science',
  energy: 'engineering', transport: 'engineering', geography: 'engineering',
  software: 'software', cybersecurity: 'software', law: 'law',
  economics: 'economics', businesses: 'economics',
  finance: 'finance', fx: 'finance', crypto: 'finance',
  sports: 'sports', education: 'education',
}

const TECHNICAL: Record<ExpertDiscipline, readonly string[]> = {
  medicine: ['Anatomía, fisiología y fisiopatología pertinentes',
    'Diagnóstico diferencial, pruebas, indicaciones y contraindicaciones',
    'Farmacología, dosis contextualizadas, interacciones y monitorización cuando proceda'],
  neuroscience: ['Estructuras y circuitos cerebrales implicados y su conectividad funcional',
    'Secuencia autonómica, simpático-adrenal y neuroendocrina con escalas temporales',
    'Neurotransmisores, receptores, señalización intracelular y mecanismos de retroalimentación',
    'Plasticidad, adaptación aguda versus crónica, evidencia humana/animal y límites causales'],
  public_health: ['Diseño epidemiológico, definición de población y denominadores',
    'Tasas e indicadores con fecha, unidades y fuente', 'Sesgos, alternativas y evaluación de intervenciones'],
  science: ['Pregunta investigable y metodología', 'Diseño, muestra y medición',
    'Resultados originales, incertidumbre, reproducibilidad y límites estadísticos'],
  engineering: ['Especificaciones y supuestos', 'Ecuaciones, unidades y materiales',
    'Cálculos, simulaciones, tolerancias, seguridad y validación'],
  software: ['Arquitectura y contratos ejecutables', 'Código real, pruebas y seguridad',
    'Rendimiento, observabilidad, regresiones y mantenimiento'],
  law: ['Jurisdicción, versión vigente y jerarquía normativa',
    'Artículos, doctrina y jurisprudencia verificables', 'Procedimientos y excepciones'],
  economics: ['Definiciones de indicadores, denominadores y períodos',
    'Fuentes primarias, escenarios y modelos cuantitativos', 'Causalidad, incertidumbre y políticas'],
  finance: ['Cotizaciones, fechas y datos originales', 'Supuestos, cálculos y escenarios',
    'Riesgos, límites, sensibilidades y regulación'],
  sports: ['Evento, calendario y participantes confirmados', 'Estadísticas comparables',
    'Forma, bajas, contexto y evidencia para cada conclusión'],
  education: ['Nivel y objetivos de aprendizaje', 'Métodos didácticos y ejemplos',
    'Evaluación, accesibilidad y bibliografía'],
  general: ['Definiciones y fundamentos necesarios', 'Método o procedimiento comprobable',
    'Alternativas, resultados, riesgos y limitaciones'],
}

const BASIC_SECTIONS = [
  'Conclusión principal y hallazgos relevantes',
  'Desarrollo técnico con contexto, métodos y procedimientos',
  'Datos y cálculos necesarios, comprobados y con unidades',
  'Alternativas, límites, riesgos e incertidumbre',
  'Referencias verificables vinculadas con las afirmaciones',
] as const

/** Resolve specialty from explicit research routing, with an intentionally conservative fallback.
 * @param question - User's original request.
 * @param domain - Search router domain.
 * @returns Expert discipline, not a professional credential.
 */
export function resolveExpertDiscipline(question: string, domain: string): ExpertDiscipline {
  if (Object.hasOwn(DOMAINS, domain)) return DOMAINS[domain] ?? 'general'
  const q = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
  if (/\b(neurociencia|cerebral|cerebal|cerebro|hipotalamo|hipocampo|neurofisiologia)\b/u.test(q))
    return 'neuroscience'
  if (/\b(paciente|farmaco|medicamento|fisiopatologia|diagnostico)\b/u.test(q)) return 'medicine'
  if (/\b(ingenieria|estructura|hidraulica|circuito)\b/u.test(q)) return 'engineering'
  if (/\b(programacion|python|typescript|software|depurar)\b/u.test(q)) return 'software'
  if (/\b(jurisprudencia|ley|tribunal|derecho|normativa)\b/u.test(q)) return 'law'
  if (/\b(hipotesis|metodologia cientifica|experimento)\b/u.test(q)) return 'science'
  return 'general'
}

/** Build an expert answer contract tied to observed acquisition receipts.
 * @param input - Domain, original question, and measured evidence acquisition.
 * @returns Professional output requirements without inventing verified findings.
 */
export function buildExpertResearchContract(input: ExpertEvidenceInput): ExpertResearchContract {
  const discipline = resolveExpertDiscipline(input.question, input.domain)
  const normalized = input.question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
  const evidenceState = input.readRelevantCount === 0
    ? 'not_read' : input.independentReadCount < 2 ? 'single_owner_unverified' : 'multiple_owners_unverified'
  const specialistChecks = [
    ...(discipline === 'neuroscience' && /\b(estres|estress?|stress|hpa|cortisol)\b/u.test(normalized)
      ? ['Contrastar amígdala, hipocampo, PFC, hipotálamo, locus coeruleus y eje HPA; '
        + 'distinguir tiempos agudos/crónicos, receptores MR/GR y datos humanos frente a animales']
      : []),
    ...(/\b(dosis|dosificacion|posologia|dose)\b/u.test(normalized) && discipline === 'medicine'
      ? ['Comprobar indicación, edad, peso, función renal/hepática, interacciones y guías antes de dosificar'] : []),
    ...(/\b(comparar|versus| vs |comparacion)\b/u.test(normalized)
      ? ['Comprobar comparabilidad de población, período, unidades y métodos'] : []),
  ]
  const evidenceGaps = [
    ...(input.readRelevantCount === 0 ? ['No se ha leído evidencia primaria pertinente.'] : []),
    ...(input.readRelevantCount > 0 && input.independentReadCount < 2
      ? ['Falta contrastar fuentes independientes.'] : []),
    ...(input.duplicateContentCount > 0 ? ['Se encontraron textos duplicados, no corroboraciones.'] : []),
    ...(input.challengesCount > 0 ? ['Hay fuentes bloqueadas: buscar alternativas legítimas.'] : []),
    ...(input.budgetExhausted ? ['Presupuesto de investigación agotado: declarar lagunas.'] : []),
    'Dos instituciones independientes no prueban por sí solas la verdad de cada afirmación.',
  ]
  return {
    discipline,
    technicalDimensions: TECHNICAL[discipline],
    requiredSections: BASIC_SECTIONS,
    specialistChecks,
    evidenceState,
    evidenceGaps,
    visualRules: [
      ...(discipline === 'neuroscience' ? [
        'Diagrama causal y anatómico rotulado de estructuras y vías biológicas cuando ayude a comprender el mecanismo; generar solo con herramienta visual real y marcarlo ilustrativo.',
      ] : []),
      'Tablas cuando permitan comparar información auténtica.',
      'Gráficas solo cuando existan datos numéricos comprobados, fuente, período y unidades.',
      'Imágenes pertinentes con procedencia y texto alternativo; preferir miniaturas en caché.',
      'No usar imágenes, gráficas o interfaces decorativas como sustitutos de evidencia.',
    ],
    deliveryRules: [
      'Respuesta profesional proporcional a la pregunta; no rellenar ni resumir tanto que falten procesos.',
      'Incluir fundamentos, fórmulas, procedimientos, dosis y cálculos pertinentes, nunca inventados.',
      'Distinguir hechos observados, interpretaciones, recomendaciones e incertidumbre.',
      'Ejecutar y verificar las operaciones solicitadas; un formulario decorativo no equivale a una calculadora.',
      'Mostrar texto útil antes de cargar medios; no prometer latencia de imágenes externas.',
    ],
  }
}
