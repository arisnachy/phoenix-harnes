/** Evidence-backed resolution for phrases such as “the previous problem”. */

const MAX_TASKS = 24
const MAX_TEXT_CHARS = 4_096

/** One substantive user task retained in the bounded in-memory recent-task ledger. */
export interface RecentTask {
  readonly id: string
  readonly sessionId: string
  readonly text: string
  readonly projectId?: string
  readonly observedAt: number
  readonly verified: boolean
}

/** Confident referent supplied to Phoenix instead of letting the model guess. */
export interface ResolvedTaskReference {
  readonly task: RecentTask
  readonly confidence: number
  readonly reason: 'previous-substantive-task'
}

/** Metadata attached when observing a user task. */
export interface ObserveTaskOptions {
  readonly projectId?: string
  readonly occurredAt: number
}

/**
 * Resolve an explicit backward task reference from bounded evidence.
 * @param message - Current user message.
 * @param tasks - Recent substantive user tasks, oldest or newest first.
 * @param projectId - Optional current project constraint.
 * @returns A confident prior task or undefined when evidence is insufficient.
 */
export function resolveTaskReference(
  message: string,
  tasks: readonly RecentTask[],
  projectId?: string,
): ResolvedTaskReference | undefined {
  if (!containsBackwardReference(message)) return undefined
  const eligible = tasks
    .filter(task => projectId === undefined || task.projectId === undefined || task.projectId === projectId)
    .sort((left, right) => right.observedAt - left.observedAt)
  const task = eligible[0]
  if (task === undefined) return undefined
  return {
    task,
    confidence: task.verified ? 0.96 : 0.84,
    reason: 'previous-substantive-task',
  }
}

/**
 * Render a resolved reference as compact evidence for the model prompt.
 * @param resolved - Confident resolution, if any.
 * @returns Prompt block or empty string when unresolved.
 */
export function formatResolvedTaskReference(resolved: ResolvedTaskReference | undefined): string {
  if (resolved === undefined) return ''
  return [
    '<resolved_task_reference>',
    `The user's backward reference resolves to this recent substantive task with confidence ${resolved.confidence.toFixed(2)}:`,
    resolved.task.text,
    'Treat this as evidence for what “previous/last/anterior” refers to. Do not replace it with repository recency or unrelated tool activity.',
    '</resolved_task_reference>',
  ].join('\n')
}

/** Bounded tracker of substantive user tasks and their verified completion state. */
export class RecentTaskLedger {
  private readonly recent: RecentTask[] = []
  private readonly effectiveTaskBySession = new Map<string, string>()
  private readonly resolvedBySession = new Map<string, ResolvedTaskReference>()
  private lastSessionId: string | undefined

  /**
   * Observe a user message, storing only substantive tasks and resolving reference-only follow-ups.
   * @param sessionId - Session emitting the message.
   * @param text - User message text.
   * @param options - Project and timestamp evidence.
   */
  observeUserMessage(sessionId: string, text: string, options: ObserveTaskOptions): void {
    const bounded = boundText(text)
    this.lastSessionId = sessionId
    const resolved = resolveTaskReference(bounded, this.recent, options.projectId)
    if (resolved !== undefined) {
      this.effectiveTaskBySession.set(sessionId, resolved.task.text)
      this.resolvedBySession.set(sessionId, resolved)
      return
    }
    this.resolvedBySession.delete(sessionId)
    if (!isSubstantiveTask(bounded)) return
    const task: RecentTask = {
      id: taskId(sessionId, options.occurredAt, bounded),
      sessionId,
      text: bounded,
      observedAt: options.occurredAt,
      verified: false,
      ...options.projectId === undefined ? {} : { projectId: options.projectId },
    }
    this.recent.push(task)
    if (this.recent.length > MAX_TASKS) this.recent.splice(0, this.recent.length - MAX_TASKS)
    this.effectiveTaskBySession.set(sessionId, bounded)
  }

  /**
   * Mark the current substantive task for a session as verified.
   * @param sessionId - Completing session.
   * @param occurredAt - Completion timestamp retained for deterministic ordering.
   */
  complete(sessionId: string, occurredAt: number): void {
    const current = this.effectiveTaskBySession.get(sessionId)
    if (current === undefined) return
    for (let index = this.recent.length - 1; index >= 0; index -= 1) {
      const row = this.recent[index]
      if (row?.text !== current) continue
      this.recent[index] = { ...row, verified: true, observedAt: Math.max(row.observedAt, occurredAt) }
      return
    }
  }

  /**
   * Return the effective current task for a session, including a resolved reference.
   * @param sessionId - Optional session; defaults to the most recently observed session.
   * @returns Current substantive task text when known.
   */
  currentTask(sessionId?: string): string | undefined {
    const key = sessionId ?? this.lastSessionId
    return key === undefined ? undefined : this.effectiveTaskBySession.get(key)
  }

  /**
   * Return the latest confident backward-reference resolution for a session.
   * @param sessionId - Optional session; defaults to the most recently observed session.
   * @returns Resolution evidence or undefined.
   */
  resolvedReference(sessionId?: string): ResolvedTaskReference | undefined {
    const key = sessionId ?? this.lastSessionId
    return key === undefined ? undefined : this.resolvedBySession.get(key)
  }

  /**
   * Read bounded recent tasks for tests and prompt support.
   * @param sessionId - Optional session filter.
   * @returns A defensive copy ordered from oldest to newest.
   */
  tasks(sessionId?: string): RecentTask[] {
    return this.recent.filter(task => sessionId === undefined || task.sessionId === sessionId).map(task => ({ ...task }))
  }
}

function containsBackwardReference(text: string): boolean {
  return /(?:\b(?:anterior|anteriores|previo|previa|previos|previas)\b|\b(?:ultimo|ultima|last|previous)\s+(?:problema|problem|tarea|task)\b|\b(?:como|igual que)\s+(?:antes|el anterior|la anterior)\b|\b(?:same as|similar to)\s+(?:before|the previous|previous)\b|\botro\s+(?:problema|caso|issue)\s+parecido\b)/iu.test(normalize(text))
}

function isSubstantiveTask(text: string): boolean {
  const normalized = normalize(text)
  if (normalized.length < 8) return false
  if (containsBackwardReference(normalized)) return false
  return /[\p{L}\p{N}]/u.test(normalized)
}

function boundText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, MAX_TEXT_CHARS)
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
}

function taskId(sessionId: string, occurredAt: number, text: string): string {
  const source = `${sessionId}\n${String(occurredAt)}\n${text}`
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
