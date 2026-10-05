/** Runtime-grounded execution evidence for visible Agent Team claims. */

import type { SessionEvent } from '@phoenix-ai/dsh-session'

/** Strength of proof required by a delegated assignment. */
export type TeamExecutionRequirement = 'none' | 'evidence' | 'effect'

/** Runtime receipt derived only from durable child-session events. */
export interface TeamExecutionProof {
  readonly requirement: TeamExecutionRequirement
  readonly assignmentSeq?: number
  readonly tools: readonly string[]
  readonly satisfied: boolean
}

// oxlint-disable-next-line @stylistic/max-len -- Bilingual operational vocabulary stays auditable as one regex.
const OPERATIONAL_OBJECT = /\b(?:email|e-mail|mail|gmail|correo|mensaje|message|file|files|archivo|archivos|repo|repository|repositorio|branch|rama|commit|pull\s+request|\bpr\b|code|c[oó]digo|script|package|paquete|dependency|dependencia|test|tests|prueba|pruebas|build|cli|api|app|application|aplicaci[oó]n|web|website|sitio|form|formulario|calendar|calendario|event|evento|database|base\s+de\s+datos|document|documento|sheet|spreadsheet|drive|github|slack|setting|settings|config|configuraci[oó]n|account|cuenta|record|registro|deployment|despliegue)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Bilingual action vocabulary stays auditable as one regex.
const EFFECT_ACTION = /\b(?:send|create|update|edit|modify|write|save|upload|deploy|publish|commit|push|install|uninstall|delete|remove|move|rename|copy|submit|schedule|book|fill|reply|forward|archive|label|merge|apply|execute|run|env[ií]a\p{L}*|mand\p{L}*|crea\p{L}*|actualiz\p{L}*|edit\p{L}*|modific\p{L}*|escrib\p{L}*|guard\p{L}*|sub\p{L}*|despleg\p{L}*|public\p{L}*|fusion\p{L}*|instal\p{L}*|desinstal\p{L}*|elimin\p{L}*|borr\p{L}*|muev\p{L}*|mov\p{L}*|renombr\p{L}*|copi\p{L}*|rellen\p{L}*|complet\p{L}*|respond\p{L}*|reenv[ií]\p{L}*|archiva\p{L}*|archiv[eéó]\p{L}*|etiquet\p{L}*|ejecut\p{L}*)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Bilingual verification vocabulary stays auditable as one regex.
const VERIFY_ACTION = /\b(?:verify|check|test|inspect|review|audit|search|research|investigate|validate|confirm|compare|verific\p{L}*|comprob\p{L}*|prueb\p{L}*|inspeccion\p{L}*|revis\p{L}*|audit\p{L}*|busc\p{L}*|investig\p{L}*|valid\p{L}*|confirm\p{L}*|compar\p{L}*)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Paired send-noun matcher is clearer as one expression.
const SEND_NOUN = /(?:\b(?:env[ií]o|delivery|sending)\b.{0,80}\b(?:correo|email|e-mail|mail|mensaje|message)\b|\b(?:correo|email|e-mail|mail|mensaje|message)\b.{0,80}\b(?:env[ií]o|delivery|sending)\b)/iu

// oxlint-disable-next-line @stylistic/max-len -- Keep the non-evidence Team tool set in one visible gate.
const COORDINATION_TOOL = /^(?:spawn_teammate|send_message|followup_task|team_react|team_chat_react|team_chat_read|team_chat_answer|list_agents|wait_agent|interrupt_agent|team_task_.+|subagent(?:_fork)?|todo_write|ask_user_question|report)$/u
// oxlint-disable-next-line @stylistic/max-len -- Effectful tool verbs are intentionally one auditable allowlist.
const EFFECT_TOOL = /^(?:send|create|update|edit|modify|write|save|upload|deploy|publish|commit|push|install|uninstall|delete|remove|move|rename|copy|submit|schedule|book|fill|reply|forward|archive|label|merge|apply|set|add|insert|execute|run|bash|pwsh|run_code|click|type|press|select|navigate)(?:_|$)/u

function textOf(content: readonly { readonly type: string; readonly text?: unknown }[]): string {
  return content
    .flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])
    .join('\n')
}

function operationName(toolName: string): string {
  const normalized = toolName.toLowerCase().replaceAll('-', '_')
  const parts = normalized.split(/(?:__|[.:/])/u)
  return parts.at(-1) || normalized
}

/**
 * Classify whether a delegated instruction needs runtime evidence before a
 * teammate may visibly claim a result.
 * @param text Delegated instruction.
 * @returns Required execution evidence classification.
 */
export function teamExecutionRequirement(text: string): TeamExecutionRequirement {
  const candidate = text.trim()
  if (candidate === '' || !OPERATIONAL_OBJECT.test(candidate)) return 'none'
  if (SEND_NOUN.test(candidate) || EFFECT_ACTION.test(candidate)) return 'effect'
  if (VERIFY_ACTION.test(candidate)) return 'evidence'
  return 'none'
}

/** Distinguish a request for explanation from authorization to perform an operation.
 * @param text - Original directed human request.
 * @returns Whether a bounded answer may precede the existing mission's execution.
 */
export function isConversationalTeamUserRequest(text: string): boolean {
  const request = text.trim().replace(/^(?:@[^\s]+\s+)+/u, '').replace(/^[¿¡]/u, '')
  // Explain how the user can act; polite requests for the agent to act remain operational.
  const explanatory = new RegExp([
    '^(?:how (?:do|can|should|would) (?:i|we)\\b|',
    'how does\\b|what (?:does|do|is|are)\\b|why (?:does|do|did|is|are)\\b|explain (?:how|what|why)\\b|',
    'c[oó]mo (?:puedo|podemos|debo|funciona)\\b|qu[eé] (?:hace|hacen|significa|es|son)\\b|explica(?:me)? (?:c[oó]mo|qu[eé]|por qu[eé])\\b)',
  ].join(''), 'iu')
  const separators = new RegExp([
    '[,;.!?]\\s+|\\s+(?:then|and then|despu[eé]s|luego)\\s+|',
    '\\s+and\\s+(?=(?:can you|could you|please|then)\\b|\\w+\\s+(?:it|them)\\s+now\\b)',
  ].join(''), 'iu')
  const subsequentClauses = request.split(separators).slice(1)
  const imperativeContinuation = new RegExp([
    '^(?:and )?(?:then |luego |despu[eé]s )?(?:(?:can|could|would) you |please )?',
    '(?:send|create|write|update|deploy|publish|install|delete|remove|submit|verify|test|',
    'env[ií]a|crea|escribe|actualiza|publica|instala|elimina|verifica)\\b',
  ].join(''), 'iu')
  const hasOperationalContinuation = subsequentClauses.some(clause =>
    imperativeContinuation.test(clause.trim()) || (!explanatory.test(clause.trim()) && teamExecutionRequirement(clause) !== 'none'))
  return (!hasOperationalContinuation && explanatory.test(request)) || teamExecutionRequirement(request) === 'none'
}

/** Extract the original human request from a durable directed Team message.
 * @param text - Delivered user-role message text.
 * @returns Original human text only for the framed Team-user protocol.
 */
export function directedTeamUserText(text: string): string | undefined {
  if (!/^\[Team user message [a-zA-Z0-9_-]{1,128}\]\n/u.test(text)) return undefined
  const encoded = text.match(/^User request: (.+)$/mu)?.[1]
  if (encoded === undefined) return undefined
  try {
    const value: unknown = JSON.parse(encoded)
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

function latestAssignment(
  events: readonly SessionEvent[],
  upToSeq: number,
): { readonly seq: number; readonly requirement: TeamExecutionRequirement; readonly text: string } | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || event.seq > upToSeq || event.type !== 'user/message') continue
    const source = event.data.source as { readonly kind?: string; readonly purpose?: string }
    if (source.kind !== 'user' && source.kind !== 'team-message') continue
    // Review/status/blocker chatter must not erase an unfinished assignment's
    // proof obligation. Only an explicit Team assignment starts a new scope.
    if (source.kind === 'team-message' && source.purpose !== 'assignment') continue
    const delivered = textOf(event.data.content)
    const directed = source.kind === 'user' ? directedTeamUserText(delivered) : undefined
    const text = directed ?? delivered
    const requirement = teamExecutionRequirement(text)
    // A conversational intervention preserves the unfinished assignment.
    if (directed !== undefined && isConversationalTeamUserRequest(directed)) continue
    return { seq: event.seq, requirement, text }
  }
  return undefined
}

interface ExecutionCall {
  readonly name: string
  readonly arguments: string
}

function toolMatchesAssignment(assignmentText: string, call: ExecutionCall): boolean {
  const assignment = assignmentText.toLowerCase()
  const carrier = `${call.name} ${call.arguments}`.toLowerCase()
  if (/\b(?:email|e-mail|mail|gmail|correo)\b/u.test(assignment)) {
    return /(?:email|e-mail|mail|gmail)/u.test(carrier)
  }
  if (/\b(?:github|repo|repository|repositorio|branch|rama|commit|pull\s+request|pr)\b/u.test(assignment)) {
    return /(?:github|\bgit\b|repo|branch|commit|pull.request|update_file|create_file|update_ref)/u.test(carrier)
  }
  if (/\b(?:calendar|calendario|event|evento)\b/u.test(assignment)) {
    return /(?:calendar|event|schedule)/u.test(carrier)
  }
  if (/\b(?:database|base\s+de\s+datos|sql|table|tabla)\b/u.test(assignment)) {
    return /(?:database|sql|query|table)/u.test(carrier)
  }
  if (/\b(?:drive|document|documento|sheet|spreadsheet)\b/u.test(assignment)) {
    return /(?:drive|document|docs|sheet|spreadsheet)/u.test(carrier)
  }
  if (/\b(?:web|website|sitio|form|formulario)\b/u.test(assignment)) {
    return /(?:browser|web|page|form|click|fill|submit|navigate)/u.test(carrier)
  }
  return true
}

function successfulTools(
  events: readonly SessionEvent[],
  afterSeq: number,
  upToSeq: number,
  requirement: TeamExecutionRequirement,
  assignmentText: string,
): string[] {
  const calls = new Map<string, ExecutionCall>()
  for (const event of events) {
    if (event.seq <= afterSeq || event.seq > upToSeq || event.type !== 'tool/call') continue
    calls.set(String(event.data.callId), {
      name: event.data.name,
      arguments: event.data.arguments,
    })
  }
  const tools: string[] = []
  for (const event of events) {
    if (event.seq <= afterSeq || event.seq > upToSeq || event.type !== 'tool/result'
      || event.data.error !== undefined || event.data.message.content[0].isError) continue
    const callId = String(event.data.message.source.callId)
    const call = calls.get(callId)
    if (call === undefined) continue
    const operation = operationName(call.name)
    // Match the actual model-facing tool id, not only its last namespace
    // segment: mcp__Slack__send_message is a real external effect, while the
    // local Team tool named send_message is coordination only.
    if (COORDINATION_TOOL.test(call.name)) continue
    if (requirement === 'effect' && !EFFECT_TOOL.test(operation)) continue
    if (!toolMatchesAssignment(assignmentText, call)) continue
    tools.push(operation)
  }
  return [...new Set(tools)]
}

/**
 * Resolve actual successful tool receipts for the latest operational
 * assignment. Prose, assistant intent, and Team coordination calls never count.
 * @param events Session events containing assignments and tool receipts.
 * @param options Event range and assignment evidence requirements.
 * @returns Successful tool receipts for the selected assignment.
 */
export function teamExecutionProof(
  events: readonly SessionEvent[],
  options: {
    readonly upToSeq?: number
    readonly afterSeq?: number
    readonly requirement?: TeamExecutionRequirement
    readonly assignmentText?: string
  } = {},
): TeamExecutionProof {
  const upToSeq = options.upToSeq ?? Number.MAX_SAFE_INTEGER
  const assignment = latestAssignment(events, upToSeq)
  const requirement = options.requirement ?? assignment?.requirement ?? 'none'
  const assignmentText = options.assignmentText ?? assignment?.text ?? ''
  const boundary = Math.max(options.afterSeq ?? -1, assignment?.seq ?? -1)
  if (requirement === 'none') return { requirement, tools: [], satisfied: true }
  const tools = successfulTools(events, boundary, upToSeq, requirement, assignmentText)
  return {
    requirement,
    ...assignment === undefined ? {} : { assignmentSeq: assignment.seq },
    tools,
    satisfied: tools.length > 0,
  }
}
