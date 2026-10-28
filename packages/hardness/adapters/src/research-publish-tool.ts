/**
 * A real, source-linked research report publisher. Publication does not validate the
 * truth of references supplied by the researcher; it validates source identity,
 * citations, file integrity, and exact paths before claiming REPORT_READY.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool, ToolArgsError, type ToolDefinition } from '@phoenix-ai/dsh-tools'

type Report = Record<string, unknown>

/** Stable report location; identical contents reuse one local output directory. */
export function researchOutputPaths(report: Report): { docx: string; pdf: string; html: string } {
  const signature = createHash('sha256').update(JSON.stringify(report)).digest('hex').slice(0, 16)
  const root = join(homedir(), '.dsh', 'research-reports', signature)
  return { docx: join(root, 'informe.docx'), pdf: join(root, 'informe.pdf'), html: join(root, 'informe.html') }
}

/**
 * Fail closed before any Python process or file write. Does not pretend that
 * unverified model-provided references are independently verified.
 */
export function validateResearchPublication(input: unknown): Report {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ToolArgsError(['El informe debe ser un objeto con título, secciones y fuentes.'])
  }
  const report = input as Report
  if (typeof report.title !== 'string' || report.title.trim().length < 5 || report.title.length > 240) {
    throw new ToolArgsError(['El título debe tener entre 5 y 240 caracteres.'])
  }
  if (!Array.isArray(report.sections) || report.sections.length < 1 || report.sections.length > 140) {
    throw new ToolArgsError(['Se requieren entre 1 y 140 secciones redactadas.'])
  }
  if (!Array.isArray(report.references) || report.references.length < 1 || report.references.length > 500) {
    throw new ToolArgsError(['Falta report.references: antes de publicar, investiga fuentes reales con research_search o web_search, comprueba sus URL HTTPS y metadatos y añade al menos una entrada {key, authors, year, title, url} a report.references. Cita cada fuente en sections[].text mediante [@key]. No inventes referencias ni reintentes el mismo informe incompleto.'])
  }
  const serialized = JSON.stringify(report)
  if (serialized.length > 1000000) throw new ToolArgsError(['El informe excede el tamaño permitido.'])
  const references = report.references as unknown[]
  const keys = new Set<string>()
  for (const source of references) {
    if (typeof source !== 'object' || source === null || Array.isArray(source)) {
      throw new ToolArgsError(['Cada fuente debe tener key, authors, year, title y url.'])
    }
    const item = source as Record<string, unknown>
    if (typeof item.key !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(item.key) || keys.has(item.key)) {
      throw new ToolArgsError(['Las claves bibliográficas deben ser únicas y válidas.'])
    }
    for (const field of ['authors', 'year', 'title', 'url']) {
      if (typeof item[field] !== 'string' || (item[field] as string).trim() === '') {
        throw new ToolArgsError(['La fuente ' + item.key + ' necesita ' + field + '.'])
      }
    }
    if (typeof item.url !== 'string' || !item.url.startsWith('https://')) {
      throw new ToolArgsError(['Las fuentes requieren enlaces HTTPS reales.'])
    }
    keys.add(item.key)
  }
  const citedKeys = new Set<string>()
  const hasCitation = (value: string): string[] => {
    const tokens: string[] = []
    const all = /\[@([^\]\r\n]*)\]/gu
    for (const match of value.matchAll(all)) {
      if (!/^\[@[A-Za-z0-9_-]{1,64}(?:\s*[,;]\s*@?[A-Za-z0-9_-]{1,64})*\]$/u.test(match[0])) {
        throw new ToolArgsError(['Grupo de citas inválido: ' + match[0].slice(0, 120)])
      }
      tokens.push(...match[1]!.split(/[,;]/u).map(key => key.trim().replace(/^@/u, '')))
    }
    if ((value.match(/\[@/gu) ?? []).length !== (value.match(all) ?? []).length) {
      throw new ToolArgsError(['Existe una cita [@clave] incompleta.'])
    }
    return tokens
  }
  for (const section of report.sections as unknown[]) {
    if (typeof section !== 'object' || section === null || Array.isArray(section)) {
      throw new ToolArgsError(['Sección inválida.'])
    }
    const item = section as Record<string, unknown>
    if (typeof item.heading !== 'string' || typeof item.text !== 'string' || item.text.length > 65000) {
      throw new ToolArgsError(['Cada sección requiere heading y text; no más de 65000 caracteres.'])
    }
    for (const key of hasCitation(item.text)) {
      citedKeys.add(key)
      if (!keys.has(key)) throw new ToolArgsError(['Cita sin fuente registrada: ' + key])
    }
  }
  if (Array.isArray(report.appendices)) {
    for (const appendix of report.appendices as unknown[]) {
      if (typeof appendix === 'object' && appendix !== null && !Array.isArray(appendix)) {
        const text = (appendix as Record<string, unknown>).text
        if (typeof text === 'string') {
          for (const key of hasCitation(text)) {
            citedKeys.add(key)
            if (!keys.has(key)) throw new ToolArgsError(['Cita de anexo sin fuente: ' + key])
          }
        }
      }
    }
  }
  if (citedKeys.size === 0) throw new ToolArgsError(['El texto debe vincular afirmaciones y referencias mediante [@clave].'])
  if (report.document_type === 'thesis') {
    const level = report.thesis_level ?? report.level
    if (level !== undefined && !['bachelors', 'masters', 'doctorate'].includes(String(level))) {
      throw new ToolArgsError(['thesis_level debe ser bachelors, masters o doctorate.'])
    }
    if (report.style === undefined || !['apa', 'apa7', 'vancouver'].includes(String(report.style))) {
      throw new ToolArgsError(['Indica el estilo de la tesis: APA 7 o Vancouver; no adivines la norma.'])
    }
  }
  const institutionalMin = typeof report.institutional_rules === 'object' && report.institutional_rules !== null
    && !Array.isArray(report.institutional_rules)
    ? (report.institutional_rules as Record<string, unknown>).min_references : undefined
  if (institutionalMin !== undefined) {
    if (typeof institutionalMin !== 'number' || !Number.isInteger(institutionalMin)
      || institutionalMin < 1 || institutionalMin > 500) {
      throw new ToolArgsError(['institutional_rules.min_references debe estar entre 1 y 500.'])
    }
    if ((report.institutional_rules as Record<string, unknown>).reviewed_by_user !== true) {
      throw new ToolArgsError(['La norma institucional requiere revisión del usuario.'])
    }
    if (citedKeys.size < institutionalMin) {
      throw new ToolArgsError(['La institución exige ' + institutionalMin
        + ' referencias distintas citadas; hay ' + citedKeys.size + '. No inventes fuentes.'])
    }
  }
  const quality = report.quality_profile ?? 'professional'
  if (quality !== 'professional' && quality !== 'educational_brief') {
    throw new ToolArgsError(['quality_profile debe ser professional o educational_brief.'])
  }
  if (quality === 'educational_brief') {
    if (report.document_type !== 'brief' || report.user_requested_brief !== true) {
      throw new ToolArgsError(['Un resumen corto solo procede si el usuario lo solicitó expresamente.'])
    }
  } else {
    const type = report.document_type
    if (type === undefined || type === 'brief') {
      throw new ToolArgsError(['No publiques una investigación profesional como brief. Identifica el tipo de estudio y desarrolla un manuscrito completo.'])
    }
    // The 15-source editorial floor remains distinct from nonbinding degree-specific guidance.
    const minima: Record<string, readonly [number, number]> = {
      narrative_review: [2400, 8], systematic_review: [3000, 10],
      original_research: [1500, 8], journal_manuscript: [1500, 8],
      thesis: [8000, 15], monograph: [4000, 12],
      research_protocol: [1800, 8], policy_report: [1800, 8],
    }
    const thresholds = minima[String(type)]
    if (thresholds) {
      const count = (report.sections as Array<{ text: string }>).reduce(
        (total, section) => total + (section.text.match(/[\p{L}\p{N}_]+/gu) ?? []).length, 0)
      if (count < thresholds[0] || citedKeys.size < thresholds[1]) {
        throw new ToolArgsError(['Investigación insuficiente: ' + count + ' palabras y '
          + citedKeys.size + ' referencias citadas. Estándar editorial interno para '
          + type + ': ' + thresholds[0] + ' palabras y ' + thresholds[1]
          + ' fuentes. Amplía la evidencia; no rellenes con texto artificial.'])
      }
    }
    if (['narrative_review', 'systematic_review', 'original_research',
      'journal_manuscript', 'thesis', 'monograph'].includes(String(type))
      && !(Array.isArray(report.tables) && report.tables.length > 0)
      && !(Array.isArray(report.charts) && report.charts.length > 0)) {
      throw new ToolArgsError(['Informe profesional sin tabla de evidencia ni figura documentada.'])
    }
  }
  if (report.style !== undefined && !['apa', 'apa7', 'vancouver', 'ama'].includes(String(report.style))) {
    throw new ToolArgsError(['Estilo de citas inválido: APA 7, Vancouver o AMA preliminar.'])
  }
  if (report.presentation !== undefined && !['academic', 'journal', 'editorial', 'hybrid'].includes(String(report.presentation))) {
    throw new ToolArgsError(['Presentación inválida: academic, journal, editorial o hybrid.'])
  }
  const designPresets = ['auto', 'academic_classic', 'editorial_navy', 'clinical_teal',
    'executive_amber', 'minimal_graphite', 'creative_coral',
    'journal_ink', 'research_violet', 'biotech_green', 'ocean_blue', 'terracotta_report', 'clinical_white'] as const
  if (report.design_preset !== undefined && (
    typeof report.design_preset !== 'string' || !designPresets.includes(report.design_preset as typeof designPresets[number])
  )) {
    throw new ToolArgsError(['Diseño desconocido. Usa auto, academic_classic o uno de los 11 estilos visuales registrados.'])
  }
  const journalMode = report.document_type === 'journal_manuscript'
    || (typeof report.journal_requirements === 'object' && report.journal_requirements !== null
      && !Array.isArray(report.journal_requirements)
      && typeof (report.journal_requirements as Record<string, unknown>).journal === 'string')
  const presentation = report.presentation ?? (journalMode ? 'journal' : quality === 'professional' ? 'hybrid' : 'academic')
  if (['academic', 'journal'].includes(String(presentation)) && report.design_preset !== undefined
    && report.design_preset !== 'auto' && report.design_preset !== 'academic_classic') {
    throw new ToolArgsError(['Los modos academic y journal no admiten una portada decorativa.'])
  }
  if (!['academic', 'journal'].includes(String(presentation)) && report.design_preset === 'academic_classic') {
    throw new ToolArgsError(['academic_classic requiere presentación academic o journal.'])
  }
  if (report.document_type !== undefined && !['brief', 'monograph', 'research_protocol',
    'narrative_review', 'systematic_review', 'original_research', 'thesis',
    'journal_manuscript', 'policy_report'].includes(String(report.document_type))) {
    throw new ToolArgsError(['Tipo de investigación no reconocido.'])
  }
  if (report.page_plan !== undefined) {
    if (typeof report.page_plan !== 'object' || report.page_plan === null || Array.isArray(report.page_plan)) {
      throw new ToolArgsError(['page_plan debe ser un objeto.'])
    }
    const plan = report.page_plan as Record<string, unknown>
    if (plan.target_pages !== undefined && (typeof plan.target_pages !== 'number'
      || !Number.isInteger(plan.target_pages) || plan.target_pages < 1 || plan.target_pages > 350)) {
      throw new ToolArgsError(['target_pages debe ser un entero de 1 a 350.'])
    }
    if (plan.scope !== undefined && plan.scope !== 'all' && plan.scope !== 'body') {
      throw new ToolArgsError(['page_plan.scope debe indicar all o body.'])
    }
  }
  if (report.institutional_rules !== undefined) {
    if (typeof report.institutional_rules !== 'object' || report.institutional_rules === null
      || Array.isArray(report.institutional_rules)
      || (report.institutional_rules as Record<string, unknown>).reviewed_by_user !== true) {
      throw new ToolArgsError(['Las normas institucionales extraídas requieren revisión antes de aplicarse.'])
    }
  }
  if (report.journal_requirements !== undefined
    && (typeof report.journal_requirements !== 'object' || report.journal_requirements === null
      || Array.isArray(report.journal_requirements))) {
    throw new ToolArgsError(['Los límites de la revista deben ser un objeto validado.'])
  }
  if (report.submission_ready === true) {
    throw new ToolArgsError(['La publicación en una revista requiere normas de la revista, autoría, declaraciones y revisión humana.'])
  }
  return report
}

function findPublisher(): string {
  const override = process.env.PHOENIX_RESEARCH_PUBLISHER_SCRIPT
  const file = 'phoenix-research-publisher.py'
  const root = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    ...(override ? [resolve(override)] : []),
    join(process.cwd(), 'scripts', file),
    ...[1, 2, 3, 4, 5, 6].map(level => resolve(root, ...Array(level).fill('..'), 'scripts', file)),
  ]
  const script = candidates.find(path => existsSync(path) && statSync(path).isFile())
  if (script === undefined) throw new Error('No se encontró scripts/phoenix-research-publisher.py en el runtime de Phoenix.')
  return script
}

type PublisherOutcome = {
  state: 'REPORT_READY' | 'REPORT_NEEDS_REVISION'
  report_id: string
  title: string
  files: { docx: string; pdf: string; html: string }
  source_count: number
  source_verification: string
  pagination?: { pdf_pages: number; requested_pages: number | null; scope: string; target_met: boolean | null }
  warnings?: string[]
  presentation?: string
  design_preset?: string
  document_type?: string
  quality?: { required_sections_checked: boolean; submission_certified: boolean;
    bibliographic_metadata_network_verified: boolean; visual_page_review: string }
}

async function runAttempt(bin: string, args: string[], payload: string, signal: AbortSignal): Promise<PublisherOutcome> {
  return await new Promise<PublisherOutcome>((resolveOutcome, rejectOutcome) => {
    let output = ''
    let errors = ''
    const child = spawn(bin, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], signal, timeout: 180000 })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { output = (output + chunk).slice(-16000) })
    child.stderr.on('data', (chunk: string) => { errors = (errors + chunk).slice(-12000) })
    child.on('error', rejectOutcome)
    child.on('close', code => {
      if (code !== 0) {
        rejectOutcome(new Error((errors.trim() || 'RESEARCH_PUBLISH_FAILED') + ' (exit ' + String(code) + ')'))
        return
      }
      try {
        const value = JSON.parse(output.trim()) as PublisherOutcome
        if ((value.state !== 'REPORT_READY' && value.state !== 'REPORT_NEEDS_REVISION') || !/^[0-9a-f]{16}$/u.test(value.report_id) || typeof value.files !== 'object') {
          throw new Error('La respuesta del publicador no confirmó un documento listo.')
        }
        resolveOutcome(value)
      } catch (error) {
        rejectOutcome(error)
      }
    })
    child.stdin.on('error', () => { /* Child may have exited after a failed import. */ })
    child.stdin.end(payload)
  })
}

/**
 * Generate real DOCX, PDF, and readable HTML using the pinned local Python
 * publisher. Prefer installed Python packages; allow uv dependency bootstrap
 * only when the current environment lacks them.
 */
export async function publishResearchReport(report: Report, signal: AbortSignal): Promise<PublisherOutcome> {
  validateResearchPublication(report)
  const script = findPublisher()
  const payload = JSON.stringify(report)
  const attempts: { bin: string; args: string[] }[] = [
    { bin: process.platform === 'win32' ? 'py' : 'python3', args: process.platform === 'win32' ? ['-3', script] : [script] },
    { bin: 'python', args: [script] },
    { bin: 'uv', args: ['run', '--no-project', '--with', 'python-docx', '--with', 'reportlab', '--with', 'pillow', 'python', script] },
  ]
  const problems: string[] = []
  for (const attempt of attempts) {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Publicación cancelada')
    try {
      const result = await runAttempt(attempt.bin, attempt.args, payload, signal)
      const expected = researchOutputPaths(report)
      for (const ext of ['docx', 'pdf', 'html'] as const) {
        if (result.files[ext] !== expected[ext] || !existsSync(expected[ext]) || !statSync(expected[ext]).isFile()
          || statSync(expected[ext]).size < 128) {
          throw new Error('El archivo ' + ext + ' no existe, es inválido o no coincide con la ruta prevista.')
        }
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      problems.push(attempt.bin + ': ' + message.slice(0, 330))
      if (!/ENOENT|DEPENDENCIES_MISSING|No module named|module named|not found/i.test(message)) break
    }
  }
  throw new Error('No fue posible publicar el documento. ' + problems.join('; '))
}

/** Model-facing academic report publication with actual file evidence. */
export function createResearchPublishTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_research_publish',
    description: 'PRECONDICIÓN: NO llames esta herramienta sin report.references con fuentes reales HTTPS y metadatos {key,authors,year,title,url}; cada fuente usada debe citarse como [@key] en sections[].text. Si faltan fuentes, INVESTIGA primero mediante research_search/web_search, comprueba las URL y usa phoenix_research_verify_sources para verificar metadatos disponibles. Nunca inventes referencias para pasar la validación. RECHAZA automáticamente textos cortos como informes científicos completos; sigue investigando hasta subsanar todas las deficiencias. El perfil professional predeterminado exige contenido profundo, referencias citadas y visuales sustentados; para un resumen corto debe existir petición explícita de brief y quality_profile=educational_brief. Convierte todos los grupos [@a; @b] a citas finales sin marcadores. PUBLICA el manuscrito COMPLETO de una investigación en DOCX editable, PDF real y HTML. PARA TESIS: indica thesis_level=bachelors|masters|doctorate y estilo APA 7/Vancouver. Orientación no universal de fuentes distintas citadas: 20-40 licenciatura, 40-80 maestría y 100+ doctorado; reportar insuficiencia como aviso, nunca inventar fuentes. Manual institucional revisado prevalece (institutional_rules.min_references validado). Mantén gráficos elegantes con títulos, unidades y fuentes verificables; respetar requisitos formales, sin fabricar visuales. PARA TESIS, MONOGRAFÍAS, ANTEPROYECTOS O ARTÍCULOS primero ejecuta phoenix_research_plan, recopila una sola vez los datos institucionales faltantes, revisa manual/plantilla si fue suministrado, verifica fuentes y después redacta secciones completas: NO generes 5 páginas cuando se pidieron 80. DISEÑO: usa design_preset="auto" (recomendado) o cualquiera de los once estilos: editorial_navy, clinical_teal, executive_amber, minimal_graphite, creative_coral, journal_ink, research_violet, biotech_green, ocean_blue, terracotta_report, clinical_white. Los documentos para lectores NO muestran etiquetas Phoenix Research Studio ni Edición profesional. academic_classic solo con presentation=academic y respetando las normas académicas, sin adorno. Nunca inventes logos, fotografías, números ni citas para mejorar la apariencia. report={title,design_preset?:"auto"|"editorial_navy"|"clinical_teal"|"executive_amber"|"minimal_graphite"|"creative_coral"|"journal_ink"|"research_violet"|"biotech_green"|"ocean_blue"|"terracotta_report"|"clinical_white"|"academic_classic",thesis_level?:"bachelors"|"masters"|"doctorate",document_type:"thesis"|"monograph"|"research_protocol"|"journal_manuscript"|"original_research"|"narrative_review"|"systematic_review"|"brief"|"policy_report",style:"apa7"|"vancouver"|"ama",presentation:"academic"|"journal"|"hybrid"|"editorial",paper:"A4"|"Letter",cover:{institution,faculty,department,degree,course,course_code,lecturer,advisor,city,country,date,authors:[{name,student_id?,affiliation?,orcid?}],logo_path?},front_matter:{approval?,originality?,dedication?,acknowledgements?,abstract_en?,key_points?:string[]},table_of_contents?:boolean,page_plan?:{target_pages:number,scope:"all"|"body"},institutional_rules?:{reviewed_by_user:true,min_references?,margin_cm?,font_family?,line_spacing?},journal_requirements?:{journal,max_words?,max_abstract_words?,max_references?,max_tables_figures?,require_key_points?},keywords?:string[],sections:[{kind,heading,text:"Texto científico profundo con [@fuente1]"}],references:[{key,authors,year,title,journal,url,doi?}],tables?:[{title,columns,rows,source_key,note?,units?,sample_size?,method?,statistical_note?,abbreviations?}],charts?:[{type:"bar"|"horizontal_bar"|"line"|"scatter"|"forest",title,labels,values,x_values?,ci_low?,ci_high?,interval_label?,x_label?,y_label?,units?,sample_size?,method?,statistical_note?,abbreviations?,alt_text?,source_key}]}. Entrega capítulos académicos ordenados: problema, objetivos, marco teórico, metodología, resultados y discusión si hubo datos reales, conclusiones, recomendaciones y referencias. Un protocolo usa ética y RESULTADOS ESPERADOS, nunca resultados inventados. Incluir solo originales, aprobaciones o dedicatorias facilitados por el usuario. El índice Word es un campo TOC que Word actualiza al abrir; PDF tiene índice paginado. Verifica la paginación REAL después de maquetar; receipt.pagination.pdf_pages compara contra target_pages y warnings informa si falta extensión: NO falsifiques ni rellenes páginas. Los estilos bibliográficos completos de cada revista y la autenticidad de metadatos no están certificados, revisar antes de entregar o enviar. Artículo científico es TIPO de documento, independiente de APA7/Vancouver. Antes de reclamar fuentes verificadas usa phoenix_research_verify_sources (Crossref/Europe PMC); lee guías con phoenix_research_institution_rules y consulta límites iniciales de revista con phoenix_research_journal_profile. Todas las tablas y figuras deben llevar títulos numerados, fuente verificable, unidades, tamaño muestral, métodos y notas estadísticas/intervalos cuando se conozcan, sin fabricar datos. presentation=journal crea manuscrito austero sin ornamentos, distinto del PDF de lectura hybrid. El editor no certifica AMA completo ni una revista; distribución por correo y Telegram sigue siendo una operación distinta y autorizada.',
    timeoutMs: 240000,
    parameters: {
      report: {
        type: 'object', required: true, additionalProperties: true,
        description: 'OBLIGATORIO: report.references:[{key,authors,year,title,url:https://...,journal?,doi?}], obtenidas de fuentes reales; report.sections:[{heading,text: texto con citas [@key]}]. Incluye document_type, presentation y profundidad suficiente. Sin referencias, investiga antes de llamar.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.state === 'REPORT_READY' || value.state === 'REPORT_NEEDS_REVISION'
          ? (value.state === 'REPORT_READY' ? 'Informe completo para revisión académica. Word: ' : 'Informe generado, PERO AÚN NO COMPLETO: la paginación requiere ampliación o revisión. Word: ') + String((value.files as Record<string, unknown>).docx)
            + '; PDF: ' + String((value.files as Record<string, unknown>).pdf)
            + '; vista HTML: ' + String((value.files as Record<string, unknown>).html)
            + '. Edición: ' + String(value.presentation ?? 'academic')
             + '; diseño: ' + String(value.design_preset ?? 'academic_classic')
            + '; páginas PDF: ' + String((value.pagination as Record<string, unknown> | undefined)?.pdf_pages ?? 'sin verificar')
            + '; observaciones: ' + (Array.isArray(value.warnings) ? value.warnings.map(String).join('; ') : 'ninguna')
            + '. Estas son rutas locales de archivos, NO enlaces web. Ábrelos desde los archivos generados al pie del turno en Phoenix, no como una URL del navegador. No se ha certificado la veracidad de las fuentes ni el cumplimiento específico de una revista.'
          : 'El informe no alcanzó estado REPORT_READY.',
      }],
    },
    async execute(args, exec) {
      return await publishResearchReport(validateResearchPublication(args.report), exec.signal)
    },
    presentCall(args) {
      try {
        const report = validateResearchPublication(args.report)
        const files = researchOutputPaths(report)
        return {
          card: 'generic', title: 'Generar investigación DOCX + PDF + HTML', kind: 'edit',
          locations: [{ path: files.docx }, { path: files.pdf }, { path: files.html }],
        }
      } catch {
        return { card: 'generic', title: 'Validar informe académico', kind: 'execute' }
      }
    },
  })
}
