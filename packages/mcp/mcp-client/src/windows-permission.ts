/**
 * Native Windows MCP trust boundary.
 *
 * A curated third-party UIA server can focus, type, launch and click on the
 * user's actual desktop. Neither discovery nor installation grants authority.
 * Every allowed call (including reads/screenshots) requires one real human
 * response; unknown tools and batched/compound actions fail closed.
 */
export const WINDOWS_FLAUI_SERVER_NAME = 'windows-flaui'

const ALLOWED = new Set([
  'windows_list_windows',
  'windows_snapshot',
  'windows_get_text',
  'windows_screenshot',
  'windows_focus',
  'windows_click',
  'windows_type',
  'windows_send_keys',
  'windows_fill',
  'windows_close',
  'windows_launch',
])

/** No commands, shell interpreters, custom paths or arbitrary arguments. */
const LAUNCH_APPS = new Set([
  'calc.exe', 'notepad.exe', 'mspaint.exe', 'explorer.exe',
  'excel.exe', 'winword.exe', 'powerpnt.exe',
])
const QUESTION_ID = 'phoenix-windows-mcp-one-action'
const ALLOW = 'Autorizar una sola acción'
const DENY = 'Cancelar: no ejecutar'

export interface WindowsMcpQuestionService {
  ask(request: {
    questions: readonly {
      id: string
      header: string
      question: string
      detail: string
      sensitive: true
      options: readonly { label: string; description: string; recommended?: boolean }[]
    }[]
    agent?: unknown
    signal?: AbortSignal
  }): Promise<{
    automatic?: boolean
    answers?: readonly { id?: string; selected?: readonly string[] }[]
  }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Unknown capabilities are not even advertised to the model. */
export function isAllowedWindowsMcpTool(rawName: string): boolean {
  return ALLOWED.has(rawName)
}

/** A model cannot sneak a script path, URL or arguments into a launcher. */
export function windowsMcpPreflight(rawName: string, args: unknown): string | null {
  if (!ALLOWED.has(rawName)) return 'WINDOWS_MCP_TOOL_NOT_ALLOWLISTED'
  if (!isRecord(args)) return 'WINDOWS_MCP_INVALID_ARGUMENTS'
  let serialized: string
  try { serialized = JSON.stringify(args) } catch { return 'WINDOWS_MCP_INVALID_ARGUMENTS' }
  if (serialized.length > 2000) return 'WINDOWS_MCP_ARGUMENTS_TOO_LARGE'
  if (rawName === 'windows_launch') {
    if (Object.keys(args).length !== 1 || typeof args.app !== 'string'
      || !LAUNCH_APPS.has(args.app.toLowerCase())) {
      return 'WINDOWS_MCP_LAUNCH_NOT_ALLOWLISTED'
    }
  }
  if (rawName === 'windows_screenshot') {
    // Prevent unreviewed writes or arbitrary filesystem destinations.
    if (Object.keys(args).some(key => key !== 'handle' && key !== 'background')) {
      return 'WINDOWS_MCP_SCREENSHOT_DISK_WRITE_DISABLED'
    }
  }
  return null
}

function safePreview(value: unknown, key = ''): unknown {
  if (/password|token|secret|credential|api.?key|text|value/i.test(key)) {
    return typeof value === 'string' ? '[texto oculto: ' + value.length + ' caracteres]' : '[dato oculto]'
  }
  if (Array.isArray(value)) return value.map(entry => safePreview(entry))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safePreview(v, k)]))
  return value
}

/** No implicit grants, auto-answers, session-wide bypasses or approvals on replay. */
export async function authorizeWindowsMcpCall(options: {
  rawName: string
  args: unknown
  agent?: unknown
  signal?: AbortSignal
  questions?: WindowsMcpQuestionService
}): Promise<boolean> {
  if (windowsMcpPreflight(options.rawName, options.args) !== null
    || options.agent === undefined || options.questions === undefined
    || options.signal?.aborted) return false
  let details: string
  try { details = JSON.stringify(safePreview(options.args)) } catch { return false }
  if (details.length > 2000) return false
  try {
    const response = await options.questions.ask({
      questions: [{
        id: QUESTION_ID,
        header: 'PHOENIX · Permiso de Windows',
        question: '¿Autorizas «' + options.rawName + '» en tu escritorio Windows?',
        detail: 'Acción única. Parámetros (los textos sensibles se ocultan): ' + details
          + '\\nEsta autorización no se extiende a otras acciones ni aplicaciones.',
        sensitive: true,
        options: [
          { label: DENY, description: 'No usar el escritorio.', recommended: true },
          { label: ALLOW, description: 'Ejecutar únicamente esta llamada con estos parámetros.' },
        ],
      }],
      agent: options.agent,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    if (response.automatic === true || options.signal?.aborted) return false
    const picked = response.answers?.find(answer => answer.id === QUESTION_ID)?.selected
    return picked?.length === 1 && picked[0] === ALLOW
  } catch {
    return false
  }
}
