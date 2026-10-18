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
    throw new ToolArgsError(['Se requieren fuentes reales con URL y metadatos.'])
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
  let cited = false
  for (const section of report.sections as unknown[]) {
    if (typeof section !== 'object' || section === null || Array.isArray(section)) {
      throw new ToolArgsError(['Sección inválida.'])
    }
    const item = section as Record<string, unknown>
    if (typeof item.heading !== 'string' || typeof item.text !== 'string' || item.text.length > 65000) {
      throw new ToolArgsError(['Cada sección requiere heading y text; no más de 65000 caracteres.'])
    }
    for (const match of item.text.matchAll(/\[@([A-Za-z0-9_-]{1,64})\]/gu)) {
      cited = true
      if (!keys.has(match[1]!)) throw new ToolArgsError(['Cita sin fuente registrada: ' + match[1]])
    }
  }
  if (!cited) throw new ToolArgsError(['El texto debe vincular afirmaciones y referencias mediante [@clave].'])
  if (report.style !== undefined && !['apa', 'apa7', 'vancouver'].includes(String(report.style))) {
    throw new ToolArgsError(['Estilo de citas no implementado: elige APA 7 o Vancouver.'])
  }
  if (report.presentation !== undefined && !['academic', 'editorial', 'hybrid'].includes(String(report.presentation))) {
    throw new ToolArgsError(['Presentación inválida: academic, editorial o hybrid.'])
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
    description: 'PUBLICA el manuscrito COMPLETO de una investigación en DOCX editable, PDF real y HTML. PARA TESIS, MONOGRAFÍAS, ANTEPROYECTOS O ARTÍCULOS primero ejecuta phoenix_research_plan, recopila una sola vez los datos institucionales faltantes, revisa manual/plantilla si fue suministrado, verifica fuentes y después redacta secciones completas: NO generes 5 páginas cuando se pidieron 80. report={title,document_type:"thesis"|"monograph"|"research_protocol"|"journal_manuscript"|"original_research"|"narrative_review"|"systematic_review"|"brief"|"policy_report",style:"apa7"|"vancouver",presentation:"academic"|"hybrid"|"editorial",paper:"A4"|"Letter",cover:{institution,faculty,department,degree,course,course_code,lecturer,advisor,city,country,date,authors:[{name,student_id?,affiliation?,orcid?}],logo_path?},front_matter:{approval?,originality?,dedication?,acknowledgements?,abstract_en?},table_of_contents?:boolean,page_plan?:{target_pages:number,scope:"all"|"body"},keywords?:string[],sections:[{kind,heading,text:"Texto científico profundo con [@fuente1]"}],references:[{key,authors,year,title,journal,url,doi?}],tables?:[{title,columns,rows,source_key,note?}],charts?:[{type:"bar"|"forest",title,labels,values,ci_low?,ci_high?,method?,source_key}]}. Entrega capítulos académicos ordenados: problema, objetivos, marco teórico, metodología, resultados y discusión si hubo datos reales, conclusiones, recomendaciones y referencias. Un protocolo usa ética y RESULTADOS ESPERADOS, nunca resultados inventados. Incluir solo originales, aprobaciones o dedicatorias facilitados por el usuario. El índice Word es un campo TOC que Word actualiza al abrir; PDF tiene índice paginado. Verifica la paginación REAL después de maquetar; receipt.pagination.pdf_pages compara contra target_pages y warnings informa si falta extensión: NO falsifiques ni rellenes páginas. Los estilos bibliográficos completos de cada revista y la autenticidad de metadatos no están certificados, revisar antes de entregar o enviar. Artículo científico es TIPO de documento, independiente de APA7/Vancouver. Distribución por correo y Telegram es una operación distinta y autorizada.',
    timeoutMs: 240000,
    parameters: {
      report: {
        type: 'object', required: true, additionalProperties: true,
        description: 'Informe estructurado y document_type + presentation, APA7/Vancouver, secciones científicas con [@key], tablas y figuras con fuente.',
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
            + '; páginas PDF: ' + String((value.pagination as Record<string, unknown> | undefined)?.pdf_pages ?? 'sin verificar')
            + '; observaciones: ' + (Array.isArray(value.warnings) ? value.warnings.map(String).join('; ') : 'ninguna')
            + '. No se ha certificado la veracidad de las fuentes ni el cumplimiento específico de una revista.'
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
