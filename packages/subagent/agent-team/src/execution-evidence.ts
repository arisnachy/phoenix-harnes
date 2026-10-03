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
const EFFECT_ACTION = /\b(?:send|create|update|edit|modify|write|save|upload|deploy|publish|commit|push|install|uninstall|delete|remove|move|rename|copy|submit|schedule|book|fill|reply|forward|archive|label|merge|apply|execute|run|env[ií]a\p{L}*|mand\p{L}*|crea\p{L}*|actualiz\p{L}*|edit\p{L}*|modific\p{L}*|escrib\p{L}*|guard\p{L}*|sub\p{L}*|despleg\p{L}*|public\p{L}*|fusion\p{L}*|instal\p{L}*|desinstal\p{L}*|elimin\p{L}*|borr\p{L}*|muev\p{L}*|mov\p{L}*|renombr\p{L}*|copi\p{L}*|rellen\p{L}*|complet\p{L}*|respond\p{L}*|reenv[ií]\p{L}*|archiv\p{L}*|etiquet\p{L}*|ejecut\p{L}*)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Bilingual verification vocabulary stays auditable as one regex.
const VERIFY_ACTION = /\b(?:verify|check|test|inspect|review|audit|search|research|investigate|validate|confirm|compare|verific\p{L}*|comprob\p{L}*|prueb\p{L}*|inspeccion\p{L}*|revis\p{L}*|audit\p{L}*|busc\p{L}*|investig\p{L}*|valid\p{L}*|confirm\p{L}*|compar\p{L}*)\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Paired send-noun matcher is clearer as one expression.
const SEND_NOUN = /(?:\b(?:env[ií]o|delivery|sending)\b.{0,80}\b(?:correo|email|e-mail|mail|mensaje|message)\b|\b(?:correo|email|e-mail|mail|mensaje|message)\b.{0,80}\b(?:env[ií]o|delivery|sending)\b)/iu

// oxlint-disable-next-line @stylistic/max-len -- Keep the non-evidence Team tool set in one visible gate.
const COORDINATION_TOOL = /^(?:spawn_teammate|send_message|followup_task|team_react|team_chat_react|team_chat_read|list_agents|wait_agent|interrupt_agent|team_task_.+|subagent(?:_fork)?|todo_write|ask_user_question|report)$/u
// oxlint-disable-next-line @stylistic/max-len -- Effectful tool verbs are intentionally one auditable allowlist.
const EFFECT_TOOL = /^(?:send|create|update|edit|modify|write|save|upload|deploy|publish|commit|push|install|uninstall|delete|remove|move|rename|copy|submit|schedule|book|fill|reply|forward|archive|label|merge|apply|set|add|insert|execute|run|bash|pwsh|run_code)(?:_|$)/u

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
 */
export function teamExecutionRequirement(text: string): TeamExecutionRequirement {
  const candidate = text.trim()
  if (candidate === '' || !OPERATIONAL_OBJECT.test(candidate)) return 'none'
  if (SEND_NOUN.test(candidate) || EFFECT_ACTION.test(candidate)) return 'effect'
  if (VERIFY_ACTION.test(candidate)) return 'evidence'
  return 'none'
}

function latestAssignment(
  events: readonly SessionEvent[],
  upToSeq: number,
): { readonly seq: number; readonly requirement: TeamExecutionRequirement } | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || event.seq > upToSeq || event.type !== 'user/message') continue
    const source = event.data.source as { readonly kind?: string; readonly purpose?: string }
    if (source.kind !== 'user' && source.kind !== 'team-message') continue
    // Review/status/blocker chatter must not erase an unfinished assignment's
    // proof obligation. Only an explicit Team assignment starts a new scope.
    if (source.kind === 'team-message' && source.purpose !== 'assignment') continue
    const requirement = teamExecutionRequirement(textOf(event.data.content))
    return { seq: event.seq, requirement }
  }
  return undefined
}

function successfulTools(
  events: readonly SessionEvent[],
  afterSeq: number,
  upToSeq: number,
  requirement: TeamExecutionRequirement,
): string[] {
  const calls = new Map<string, string>()
  for (const event of events) {
    if (event.seq <= afterSeq || event.seq > upToSeq || event.type !== 'tool/call') continue
    calls.set(String(event.data.callId), event.data.name)
  }
  const tools: string[] = []
  for (const event of events) {
    if (event.seq <= afterSeq || event.seq > upToSeq || event.type !== 'tool/result'
      || event.data.error !== undefined || event.data.message.content[0].isError) continue
    const callId = String(event.data.message.source.callId)
    const raw = calls.get(callId)
    if (raw === undefined) continue
    const operation = operationName(raw)
    if (COORDINATION_TOOL.test(operation)) continue
    if (requirement === 'effect' && !EFFECT_TOOL.test(operation)) continue
    tools.push(operation)
  }
  return [...new Set(tools)]
}

/**
 * Resolve actual successful tool receipts for the latest operational
 * assignment. Prose, assistant intent, and Team coordination calls never count.
 */
export function teamExecutionProof(
  events: readonly SessionEvent[],
  options: {
    readonly upToSeq?: number
    readonly afterSeq?: number
    readonly requirement?: TeamExecutionRequirement
  } = {},
): TeamExecutionProof {
  const upToSeq = options.upToSeq ?? Number.MAX_SAFE_INTEGER
  const assignment = latestAssignment(events, upToSeq)
  const requirement = options.requirement ?? assignment?.requirement ?? 'none'
  const boundary = Math.max(options.afterSeq ?? -1, assignment?.seq ?? -1)
  if (requirement === 'none') return { requirement, tools: [], satisfied: true }
  const tools = successfulTools(events, boundary, upToSeq, requirement)
  return {
    requirement,
    ...assignment === undefined ? {} : { assignmentSeq: assignment.seq },
    tools,
    satisfied: tools.length > 0,
  }
}
