/**
 * Approval-gated extraction of evidence-located institutional rule candidates.
 * The model must not pretend that heuristic text recognition equals compliance.
 */
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ApprovalService } from '@phoenix-ai/dsh-user-approval'
import { defineTool, ToolArgsError, type ToolDefinition } from '@phoenix-ai/dsh-tools'

type ToolJsonValue = string | number | boolean | null | ToolJsonValue[] | { [key: string]: ToolJsonValue }
const EXTENSIONS = ['.pdf', '.docx', '.txt', '.md']

/**
 * Validate a path inside the current workspace or home; never open arbitrary system files.
 * @param provided - explicit local file path from the requesting user.
 * @returns canonical path, without symlink traversal outside the allowed roots.
 */
export async function validateInstitutionRulePath(provided: string): Promise<string> {
  if (typeof provided !== 'string' || provided.length > 2000 || !isAbsolute(provided)) {
    throw new ToolArgsError(['Proporciona una ruta local absoluta del reglamento que autorizas a leer.'])
  }
  const path = await realpath(provided)
  const roots = await Promise.all([homedir(), process.cwd()].map(async root => await realpath(root)))
  if (!roots.some(root => {
    const rel = relative(root, path)
    return rel === '' || (rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../') && !isAbsolute(rel))
  })) throw new ToolArgsError(['El reglamento debe estar en tu carpeta de usuario o espacio de trabajo.'])
  if (!EXTENSIONS.includes(extname(path).toLowerCase()) || !existsSync(path) || !statSync(path).isFile()
    || statSync(path).size > 15 * 1024 * 1024) {
    throw new ToolArgsError(['Se admite PDF/DOCX/TXT/MD local de hasta 15 MB.'])
  }
  return path
}
function findScript(): string {
  const name = 'phoenix-research-institution-rules.py'
  const root = dirname(fileURLToPath(import.meta.url))
  const paths = [
    join(process.cwd(), 'scripts', name),
    ...[1, 2, 3, 4, 5, 6].map(depth => resolve(root, ...Array(depth).fill('..'), 'scripts', name)),
  ]
  const script = paths.find(path => existsSync(path) && statSync(path).isFile())
  if (!script) throw new Error('No se encontró el extractor de reglamentos en Phoenix.')
  return script
}
async function invoke(bin: string, args: string[], filePath: string, signal: AbortSignal):
  Promise<Record<string, unknown>> {
  return await new Promise((fulfill, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(bin, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 80000, signal })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk; if (stdout.length > 150000) child.kill() })
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-1400) })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) return reject(new Error('El extractor no pudo leer el documento: ' + stderr))
      try {
        const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>
        if (parsed.state !== 'RULES_FOR_REVIEW' || !Array.isArray(parsed.candidates)) {
          return reject(new Error('El extractor no devolvió hallazgos verificables.'))
        }
        fulfill(parsed)
      } catch (error) { reject(error) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ path: filePath }))
  })
}
/**
 * Extract PDF/DOCX rule candidates from a user-approved document.
 * @param provided - actual file path.
 * @param signal - user cancellation.
 * @returns rule excerpts and their page/paragraph locations.
 */
export async function extractInstitutionRules(provided: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const path = await validateInstitutionRulePath(provided)
  const script = findScript()
  const attempts = [
    { bin: process.platform === 'win32' ? 'py' : 'python3',
      args: process.platform === 'win32' ? ['-3', script] : [script] },
    { bin: 'python', args: [script] },
    { bin: 'uv', args: ['run', '--no-project', '--with', 'python-docx', '--with', 'pymupdf', 'python', script] },
  ]
  const errors: string[] = []
  for (const item of attempts) {
    try { return await invoke(item.bin, item.args, path, signal) }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(message.slice(0, 160))
      if (!/ENOENT|module named|ModuleNotFoundError|ImportError/iu.test(message)) break
    }
  }
  throw new Error('No se pudo interpretar el reglamento. ' + errors.join(' / '))
}
/**
 * Expose a governed, read-only PDF/DOCX institutional-rule intake tool.
 * @param approval - native user approval authority.
 * @returns extraction tool with review-required evidence.
 */
export function createInstitutionRulesTool(approval: ApprovalService): ToolDefinition {
  return defineTool({
    name: 'phoenix_research_institution_rules',
    description: 'Lee un reglamento institucional PDF/DOCX/TXT/MD local DESPUÉS DE APROBACIÓN EXPLÍCITA y devuelve frases con página o párrafo de origen para márgenes, fuentes, interlineado, portada, referencias, extensión y capítulos. Extraer NO significa certificar cumplimiento: revisar con el usuario y trasladar solo reglas confirmadas al formato. No enviar reglamentos a Internet.',
    timeoutMs: 120000,
    parameters: {
      path: { type: 'string', required: true, description: 'Ruta absoluta local autorizada a una guía de universidad o revista.' },
    },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: 'Reglas para revisión: ' + JSON.stringify(value) }] },
    async execute(args, exec) {
      const file = await validateInstitutionRulePath(args.path)
      if (!exec.agent) throw new Error('Se requiere sesión de agente autenticada.')
      const result = await approval.request({
        agent: exec.agent, toolName: 'phoenix_research_institution_rules', callId: exec.callId,
        reason: 'Leer el documento académico local autorizado: ' + file,
        risk: 'high', reversible: true, signal: exec.signal,
      })
      if (result !== 'allowed-once') return { state: 'blocked', approved: false }
      return await extractInstitutionRules(file, exec.signal) as Record<string, ToolJsonValue>
    },
    presentCall() { return { card: 'generic', title: 'Leer normas de universidad o revista', kind: 'execute' } },
  })
}
