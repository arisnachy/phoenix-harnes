/** Root-owned chat publication. The existing Session stream carries every durable record. */
import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { isAppendSurfaceEvent } from '@phoenix-ai/dsh-session/surface'
import { foldSubagentDescriptor } from '@phoenix-ai/dsh-subagent'
import { teamWorkerSelection } from './model-route.ts'
import { messageAccepted } from './session-message.ts'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent, type SessionHeader } from '@phoenix-ai/dsh-session'
import emojiRegex from 'emoji-regex'
import { inferTeamSkill, TEAM_PERSONAS, TEAM_SKILL_POOLS } from './personas.ts'
import { chatMessageSchema, chatParticipantSchema, chatReactionSchema } from './chat-projection.ts'
import { foldTeam } from './fold.ts'
import { teamExecutionProof, isConversationalTeamUserRequest } from './execution-evidence.ts'
import { TeamId } from './types.ts'
import { boundedTranscriptText } from './validation.ts'
import type { TeamJournal } from './journal.ts'
import type { TeamChatMessage, TeamChatParticipant, TeamChatReadResult, TeamChatReaction, TeamChatReactRequest, TeamChatReplyRequest } from './chat-types.ts'

/** Durable versions are validated even when the compile-time map is narrower. */
function chatVersion(value: unknown): boolean { return value === 1 }

const EMOJI = new RegExp(`^(?:${emojiRegex().source})$`)
function textOf(content: readonly { readonly type: string; readonly text?: unknown }[]): string {
  return content.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
}

/** Conservative claim vocabulary; explicit negated status does not assert an effect. */
function answerNeedsEvidence(text: string): boolean {
  const completion = [
    'sent|emailed|delivered|verified|checked|tested|updated|created|written|saved|uploaded|deployed|published|installed',
    'deleted|removed|submitted|done|completed|finished|enviado|entregado|verificado|comprobado|actualizado|creado',
    'guardado|publicado|instalado|eliminado|terminado|completado|hecho',
  ].join('|')
  const negativeStatus = new RegExp([
    "\\b(?:haven['’]t|hasn['’]t|hadn['’]t|didn['’]t|not|never|no)\\s+",
    `(?:(?:yet|lo|la|los|las|he|ha|hemos)\\s+)*(?:${completion})\\b`,
  ].join(''), 'giu')
  const assertions = text.replace(negativeStatus, '')
  const actorAction = new RegExp([
    '\\b(?:i|we|yo|nosotros|nosotras)\\s+(?:(?:have|had|am|are|he|hemos)\\s+)?',
    '(?:(?:already|successfully|ya)\\s+)?',
    `(?:${completion}|send|create|write|update|deploy|publish|install|delete|remove|submit|verify|test)\\b`,
  ].join(''), 'iu')
  // Definitions and conditional instructions never suppress an actual actor claim.
  if (actorAction.test(assertions)) return true
  const conditional = /\b(?:when|if|once|after|before|cuando|si|despu[eé]s|antes|una vez)\b/iu
  const passive = new RegExp(`\\b(?:was|were|is|are|has been|have been|fue|fueron|est[aá]|ha sido)\\s+(?:${completion})\\b`, 'iu')
  const status = new RegExp([
    '^(?:(?:the |your |el |la |tu )?(?:email|mail|correo|file|archivo|task|tarea|test|prueba)\\s+)?',
    `(?:${completion})(?:[.!]|$|\\s+(?:to|and|y|a)\\b)`,
  ].join(''), 'iu')
  return assertions.split(/(?<=[.!?])\s+|\n/u)
    .some(clause => !conditional.test(clause) && (passive.test(clause) || status.test(clause.trim())))
}

/**
 * Keep one genuine opening action, then only a new tool-backed milestone or
 * actionable question/blocker. Redundant status narration is still in child
 * Session history but does not clutter the human Team conversation.
 * @param message - Actual teammate assistant text.
 * @param alreadySpoke - Whether that teammate spoke visibly in this turn.
 * @param newReceipt - Whether a non-Team tool succeeded since visible speech.
 * @returns True for consequential dialogue, false for redundant chatter.
 */
export function shouldPublishTeammateSpeech(message: string, alreadySpoke: boolean, newReceipt: boolean): boolean {
  const text = message.trim()
  if (!text) return false
  if (!alreadySpoke) return true
  if (/\?|\b(?:bloqueo|bloqueado|obst[aá]culo|necesito que|no puedo|error|failed|blocked|need your|requires approval)\b/iu.test(text)) return true
  if (!newReceipt) return false
  const stillPlanning = /^(?:(?:@?Kira)[,:!]?\s*)?(?:ahora |luego |despu[eé]s |next |now )*(?:voy a |proceder[eé] a |har[eé] |buscar[eé] |comprobar[eé] |verificar[eé] |revisar[eé] |abrir[eé] |i(?:'ll| will) |i am going to |i'm going to )/iu
  return !stillPlanning.test(text)
}

/** Owns actual output publication and authorized reaction mutations. */
export class TeamChat {
  private readonly backfilled = new WeakSet<Session>()
  private readonly coldParticipants = new WeakMap<Session, TeamChatParticipant[]>()
  constructor(
    private readonly ctx: Context, private readonly journal: TeamJournal,
    private readonly maxBytes: number, private readonly maxTargets: number, private readonly signal: AbortSignal,
  ) {}

  /** Resolve the exact live root without accepting a child as a root.
   * @param id - owning root Session identity.
   * @returns exact live root Session.
   */
  root(id: string): Session {
    this.signal.throwIfAborted()
    const root = this.ctx.sessions.get(SessionId(id))
    if (root === undefined || root.header.origin === 'subagent') throw new Error('team root session not found')
    return root
  }

  /** Reject mutations after disposal or replacement of the owning root. */
  private assertLive(root: Session): void {
    this.signal.throwIfAborted()
    if (this.ctx.sessions.get(root.id) !== root) throw new Error('team root session changed')
  }

  /** Replay messages and reaction sets into detached client values.
   * @param root - authoritative root journal.
   * @returns detached public messages with reaction sets.
   */
  messages(root: Session): TeamChatMessage[] {
    const rows = new Map<string, TeamChatMessage>()
    const reactions = new Map<string, TeamChatReaction>()
    for (const event of root.events) {
      if (event.type === 'team/member' && chatVersion(event.data.version)
        && event.data.teamId === TeamId(root.id)
        && (event.data.member.phase === 'provisioning' || event.data.member.phase === 'active')) {
        const member = event.data.member
        if (rows.has(`team-member:${member.id}`)) continue
        rows.set(`team-member:${member.id}`, {
          id: `team-member:${member.id}`, senderId: root.id, senderName: 'Kira', senderKind: 'kira',
          avatar: 'kira', role: 'skill.orchestration', missionId: root.id, text: member.description,
          time: event.time, sourceSeq: event.seq, targetId: member.id, mentions: [member.id], reactions: [],
        })
      }
      if (event.type === 'team/chat-message' && chatVersion(event.data.version)) {
        const parsed = chatMessageSchema.safeParse(event.data.message)
        // Old Phoenix builds projected tool counters as artificial chat bubbles.
        // Hide only those generated IDs on replay; preserve genuine teammate replies.
        if (parsed.success && !parsed.data.id.startsWith(parsed.data.senderId + ':activity:')) {
          rows.set(parsed.data.id, parsed.data)
        }
      }
      if (event.type === 'team/message/queued') {
        const message = event.data.message
        rows.set(message.id, { id: message.id, senderId: message.senderId, senderName: message.senderName,
          senderKind: message.senderId === root.id ? 'kira' : 'agent', text: textOf(message.content), time: event.time,
          sourceSeq: event.seq, missionId: event.data.teamId, targetId: message.targetId, mentions: [message.targetId], reactions: [] })
      }
      if (event.type === 'user/message' && event.data.source.kind !== 'user') continue
      if ((event.type === 'user/message' || event.type === 'assistant/message') && isAppendSurfaceEvent(event)) {
        const message = event.type === 'user/message' ? event.data : event.data.message
        const text = textOf(message.content)
        if (text.trim() !== '') rows.set(message.id, { id: message.id, senderId: event.type === 'user/message' ? 'user' : root.id,
          senderName: event.type === 'user/message' ? 'User' : 'Kira', senderKind: event.type === 'user/message' ? 'user' : 'kira',
          text, time: event.time, sourceSeq: event.seq, mentions: [], reactions: [] })
      }
      if (event.type === 'team/chat-reaction' && chatVersion(event.data.version)) {
        const parsed = chatReactionSchema.safeParse(event.data.reaction)
        if (!parsed.success || typeof event.data.active !== 'boolean') continue
        const r = parsed.data
        const key = JSON.stringify([r.messageId, r.reactorId, r.emoji])
        if (event.data.active) reactions.set(key, r)
        else reactions.delete(key)
      }
    }
    return [...rows.values()].map(row => ({ ...row, mentions: [...row.mentions],
      reactions: [...reactions.values()].filter(item => item.messageId === row.id).map(item => ({ ...item })) }))
  }

  /** Fold validated mission identities, excluding inherited identities from another root. */
  private participants(root: Session): Map<string, TeamChatParticipant> {
    const values = new Map<string, TeamChatParticipant>()
    for (const event of root.events) {
      if (event.type !== 'team/chat-participant' || !chatVersion(event.data.version)) continue
      const parsed = chatParticipantSchema.safeParse(event.data.participant)
      if (parsed.success && parsed.data.missionId === root.id) values.set(parsed.data.id, parsed.data)
    }
    return values
  }

  /** Register a stable persona once, then retain it for all later operational states. */
  private participant(root: Session, header: SessionHeader, events: readonly SessionEvent[], status: string): TeamChatParticipant {
    const existing = this.participants(root).get(header.id)
    if (existing !== undefined) {
      const value = existing
      if (value.status === status) return value
      const next = { ...value, status }
      root.append('team/chat-participant', { version: 1, participant: next })
      return next
    }
    const member = foldTeam(root.id, root.events).members.get(header.id)
    const named = member === undefined ? undefined : ['la-forja', 'forja', 'forge'].includes(member.name) ? TEAM_PERSONAS.find(persona => persona.kind === 'atlas') : TEAM_PERSONAS.find(persona => persona.name.toLowerCase() === member.name || persona.kind === member.name)
    const occupied = new Set([...this.participants(root).values()].flatMap(person => person.avatar === undefined ? [] : [person.avatar]))
    let offset = 0
    // String iteration always yields a nonempty string.
    for (const character of header.id) offset += character.codePointAt(0) as number
    const descriptor = foldSubagentDescriptor(events.slice(header.seedLength ?? 0))
    const task = member?.description ?? descriptor?.label
    const skill = inferTeamSkill(task ?? '')
    // Modulo indexes the static nonempty persona tuple.
    let selected: typeof TEAM_PERSONAS[number] = named ?? (TEAM_PERSONAS[offset % TEAM_PERSONAS.length] as typeof TEAM_PERSONAS[number])
    if (named === undefined) {
      const preferred = skill === 'general' ? undefined : TEAM_SKILL_POOLS[skill].find(kind => !occupied.has(kind))
      // Skill pools contain only kinds from the persona tuple.
      if (preferred !== undefined) selected = TEAM_PERSONAS.find(persona => persona.kind === preferred) as typeof TEAM_PERSONAS[number]
      else for (let step = 0; step < TEAM_PERSONAS.length; step++) {
        const candidate = TEAM_PERSONAS[(offset + step) % TEAM_PERSONAS.length] as typeof TEAM_PERSONAS[number]
        if (!occupied.has(candidate.kind)) { selected = candidate; break }
      }
    }
    const collisions = [...this.participants(root).values()].some(person => person.name === selected.name)
    const value: TeamChatParticipant = { id: header.id, name: member === undefined ? (collisions ? `${selected.name} ${occupied.size + 1}` : selected.name) : named === undefined ? member.name : ['la-forja', 'forja', 'forge'].includes(member.name) ? 'La Forja' : named.name,
      role: skill === 'general' ? selected.specialty : `skill.${skill}`, avatar: selected.kind, status, missionId: root.id,
      ...(task === undefined ? {} : { task }) }
    root.append('team/chat-participant', { version: 1, participant: value })
    return value
  }

  /** Publish real descriptor/lifecycle presence without inventing conversational text.
   * @param root - owning root journal.
   * @param child - real child Session.
   * @param event - actual lifecycle event.
   */
  async presence(root: Session, child: Session, event: SessionEvent): Promise<void> {
    const status = event.type === 'turn/end' ? event.data.reason.kind === 'error' ? 'failed' : 'done' : 'working'
    await this.journal.transact(root.id, async () => {
      this.assertLive(root)
      this.participant(root, child.header, child.events, status)
      await this.ctx.sessions.flush(root)
    })
  }

  // Tool calls and receipts remain in each child Session's durable event history.
  // They are operational telemetry, not messages spoken by a teammate.

  /** Publish one actual child response; inherited fork messages and private reasoning are excluded.
   * @param root - owning root journal.
   * @param header - actual child identity and seed boundary.
   * @param events - durable child events to inspect.
   */
  async capture(root: Session, header: SessionHeader, events: readonly SessionEvent[]): Promise<void> {
    if (header.parentSession !== root.id || (header.origin !== 'subagent' && foldSubagentDescriptor(events.slice(header.seedLength ?? 0)) === undefined)) return
    await this.journal.transact(root.id, async () => {
      this.assertLive(root)
      const existing = this.messages(root)
      const known = new Set(existing.map(row => row.id))
      const end = events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
      const prior = this.participants(root).get(header.id)
      const status = end?.type === 'turn/end' ? end.data.reason.kind === 'error' ? 'failed' : 'done'
        : end?.type === 'turn/start' ? 'working' : prior !== undefined ? prior.status : 'working'
      const person = this.participant(root, header, events, status)
      const resultCallIds = new Set<string>()
      const workCallIds = new Set<string>()
      let handedOffResult = false
      let alreadySpoke = false
      let newReceipt = false
      for (const event of events) {
        if (event.seq < (header.seedLength ?? 0)) continue
        if (event.type === 'turn/start') {
          handedOffResult = false
          alreadySpoke = false
          newReceipt = false
        }
        if (event.type === 'tool/call'
          && event.data.name !== 'send_message' && event.data.name !== 'followup_task'
          && event.data.name !== 'team_chat_react' && event.data.name !== 'team_task_update'
          && event.data.name !== 'wait_agent' && event.data.name !== 'list_agents') {
          workCallIds.add(event.data.callId)
        }
        if (event.type === 'tool/call'
          && (event.data.name === 'send_message' || event.data.name === 'followup_task')) {
          try {
            const args: unknown = JSON.parse(event.data.arguments)
            if (typeof args === 'object' && args !== null && 'purpose' in args
              && 'target' in args && args.purpose === 'result' && args.target === 'lead') {
              resultCallIds.add(event.data.callId)
            }
          } catch { /* Invalid tool arguments cannot establish a successful handoff. */ }
        }
        if (event.type === 'tool/result' && event.data.message.source.kind === 'tool') {
          const callId = event.data.message.source.callId
          const succeeded = event.data.message.content.some(
            block => block.type === 'tool-result' && block.toolCallId === callId && !block.isError,
          )
          if (resultCallIds.has(callId) && succeeded) handedOffResult = true
          else if (succeeded && workCallIds.has(callId)) newReceipt = true
        }
        if (event.type !== 'assistant/message' || !isAppendSurfaceEvent(event)) continue
        // The peer result is already a real visible Astra -> Kira message.
        // Do not show the child's subsequent end-of-turn paraphrase a second time.
        if (handedOffResult) continue
        const rootBoundary = root.events.findLast(record =>
          record.time <= event.time && (record.type === 'turn/start' || record.type === 'turn/end'))
        if (rootBoundary?.type === 'turn/end' && rootBoundary.data.reason.kind === 'aborted'
          && rootBoundary.data.reason.reason.kind === 'user') continue
        const id = `${header.id}:${event.data.message.id}`
        const text = textOf(event.data.message.content)
        if (known.has(id)) {
          alreadySpoke = true
          newReceipt = false
          continue
        }
        if (!shouldPublishTeammateSpeech(text, alreadySpoke, newReceipt)) continue
        const proof = teamExecutionProof(events, { upToSeq: event.seq })
        // Genuine work-in-progress and blockers belong in the shared chat even
        // before a tool succeeds. Completion claims remain receipt-gated:
        // a teammate cannot report an effect as finished based on prose alone.
        if (proof.requirement !== 'none' && !proof.satisfied && answerNeedsEvidence(text)) continue
        // Evidence is verified using child Session tool receipts, but raw internal
        // tool names are not appended to a teammate's human-facing conversation.
        const bounded = boundedTranscriptText(text, this.maxBytes)
        root.append('team/chat-message', { version: 1, message: { id, senderId: header.id,
          senderName: person.name, senderKind: 'agent', avatar: person.avatar, role: person.role, missionId: root.id, text: bounded,
          // Every direct child speech event belongs to the real root mission.
          // Show Kira as recipient even if the specialist doesn't say her name.
          targetId: root.id, mentions: [root.id],
          time: event.time, sourceSeq: event.seq, reactions: [] } })
        known.add(id)
        alreadySpoke = true
        newReceipt = false
      }
      await this.ctx.sessions.flush(root)
    })
  }

  /** Backfill existing direct children without starting or resuming any model.
   * @param sessionId - owning root identity.
   * @param limit - bounded message count.
   * @returns detached transcript and participant identities.
   */
  async read(sessionId: string, limit = 100): Promise<TeamChatReadResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('chat limit must be between 1 and 200')
    const root = this.root(sessionId)
    if (!this.backfilled.has(root)) {
      for (const child of this.ctx.sessions.list()) {
        if (child.header.parentSession === root.id) await this.capture(root, child.header, child.events)
      }
      const catalog = await this.ctx.subagents.listChildren(root.id, this.signal)
      const cold: TeamChatParticipant[] = []
      for (const child of catalog) {
        if (child.kind !== 'child') continue
        cold.push({ id: child.id, name: child.id, role: child.label ?? 'Team', status: child.activity })
        if (this.ctx.sessions.get(child.id) !== undefined) continue
        const saved = await this.ctx.sessionPersistence.inspect(child.id)
        await this.capture(root, saved.meta, saved.events)
      }
      this.coldParticipants.set(root, cold)
      this.backfilled.add(root)
    }
    return await this.journal.transact(root.id, () => {
      this.assertLive(root)
      const members = foldTeam(root.id, root.events).members
      const participants: TeamChatParticipant[] = [...members.values()].map(member => ({
        id: member.id, name: member.name, role: member.description, status: member.phase,
      }))
      for (const value of this.participants(root).values()) {
        const prior = participants.findIndex(person => person.id === value.id)
        if (prior < 0) participants.push(value)
        else participants[prior] = value
      }
      for (const child of this.ctx.sessions.list()) {
        if (child.header.parentSession === root.id && !participants.some(person => person.id === child.id)) participants.push({ id: child.id, name: child.id, role: 'Team', status: this.ctx.agents.get(child.id)?.status ?? 'inactive' })
      }
      // The cache is set before this root is marked backfilled.
      for (const child of this.coldParticipants.get(root) as TeamChatParticipant[]) {
        if (!participants.some(person => person.id === child.id)) participants.push(child)
      }
      const messages = this.messages(root)
      for (const message of messages) {
        if (message.senderKind === 'agent' && !participants.some(person => person.id === message.senderId)) participants.push({ id: message.senderId, name: message.senderName, role: 'Team', status: 'done' })
      }
      return Promise.resolve({ messages: messages.slice(-limit), participants })
    })
  }

  /** Bounded model-facing read; a whole read consumes at most one configured message budget.
   * @param actor - exact live calling Agent.
   * @param limit - bounded message count.
   * @returns the actor’s authorized transcript.
   */
  async readFor(actor: Agent, limit: number): Promise<TeamChatReadResult> {
    if (this.ctx.agents.get(actor.id) !== actor) throw new Error('stale team actor')
    const rootId = actor.session.header.origin === 'subagent' ? actor.session.header.parentSession : actor.id
    if (rootId === undefined) throw new Error('team root not found')
    const result = await this.read(rootId, limit)
    let remaining = this.maxBytes
    const messages: TeamChatMessage[] = []
    for (const row of result.messages.toReversed()) {
      let text = ''
      for (const char of row.text) {
        const bytes = Buffer.byteLength(char)
        if (bytes > remaining) break
        text += char
        remaining -= bytes
      }
      messages.unshift({ ...row, text })
      if (remaining === 0) break
    }
    return { ...result, messages }
  }

  /** Publish one answer to an accepted conversational user request without completing the mission.
   * @param actor - Exact live addressed child.
   * @param request - Durable human request identity and answer text.
   * @returns Stable answer identity, reused for exact retries.
   */
  async answer(actor: Agent, request: { readonly messageId: string; readonly text: string }): Promise<{ messageId: string }> {
    if (this.ctx.agents.get(actor.id) !== actor || actor.session.header.origin !== 'subagent') throw new Error('stale or non-child team actor')
    const rootId = actor.session.header.parentSession
    if (rootId === undefined) throw new Error('team root not found')
    const root = this.root(rootId)
    if (typeof request.text !== 'string' || request.text.trim() === '' || Buffer.byteLength(request.text) > this.maxBytes) throw new Error('invalid or oversized team answer')
    const id = `${actor.id}:answer:${request.messageId}`
    await this.journal.transact(root.id, async () => {
      this.assertLive(root)
      if (this.ctx.agents.get(actor.id) !== actor || this.ctx.sessions.get(actor.id) !== actor.session) throw new Error('stale team actor')
      const rows = this.messages(root)
      const addressed = rows.find(row => row.id === request.messageId)
      if (addressed === undefined || addressed.senderKind !== 'user' || addressed.missionId !== root.id
        || !addressed.deliveries?.some(item => item.targetId === actor.id && item.accepted)) throw new Error('user request was not accepted by this actor')
      if (!isConversationalTeamUserRequest(addressed.text)) throw new Error('operational requests require execution evidence, not a conversational answer')
      if (answerNeedsEvidence(request.text)) {
        const original = teamExecutionProof(actor.session.events)
        const proof = original.requirement === 'none'
          ? teamExecutionProof(actor.session.events, { requirement: 'effect', assignmentText: request.text }) : original
        const answerProof = teamExecutionProof(actor.session.events, {
          requirement: proof.requirement, assignmentText: request.text,
        })
        if (!proof.satisfied || !answerProof.satisfied) throw new Error('operational answer requires matching execution evidence')
      }
      const marker = `[Team user message ${addressed.id}]`
      const delivered = actor.session.events.slice(actor.session.header.seedLength ?? 0).find(event => event.type === 'user/message'
        && event.data.source.kind === 'user' && textOf(event.data.content).startsWith(marker))
      if (delivered === undefined) throw new Error('user request has not reached this actor')
      const prior = rows.find(row => row.id === id)
      if (prior !== undefined) {
        if (prior.text !== request.text) throw new Error('answer identity conflicts')
        return
      }
      const person = this.participant(root, actor.session.header, actor.session.events, 'working')
      root.append('team/chat-message', { version: 1, message: { id, senderId: actor.id,
        senderName: person.name, senderKind: 'agent', avatar: person.avatar, role: person.role,
        missionId: root.id, text: request.text, time: Date.now(), sourceSeq: delivered.seq,
        replyTo: addressed.id, replyQuote: `User: ${addressed.text}`, mentions: [], reactions: [] } })
      await this.ctx.sessions.flush(root)
    })
    return { messageId: id }
  }

  /** Persist an idempotent reaction set/remove after validating the actual message and actor.
   * @param request - message and Unicode reaction mutation.
   * @param actor - exact live agent, or the human when absent.
   */
  async react(request: TeamChatReactRequest, actor?: Agent): Promise<void> {
    if (typeof request.emoji !== 'string' || request.emoji.length > 128 || !EMOJI.test(request.emoji)) throw new Error('invalid emoji')
    if (typeof request.active !== 'boolean') throw new Error('reaction active must be boolean')
    const root = this.root(request.sessionId)
    if (actor !== undefined && (this.ctx.agents.get(actor.id) !== actor
      || (actor.id !== root.id && (actor.session.header.parentSession !== root.id || actor.session.header.origin !== 'subagent')))) throw new Error('actor does not belong to this team')
    await this.journal.transact(root.id, async () => {
      this.assertLive(root)
      const message = this.messages(root).find(row => row.id === request.messageId)
      if (message === undefined) throw new Error('team chat message not found')
      if (message.missionId !== undefined && message.missionId !== root.id) throw new Error('message belongs to another mission')
      const actorId = actor?.id ?? 'user'
      const existing = message.reactions.find(row => row.reactorId === actorId && row.emoji === request.emoji)
      if ((existing !== undefined) === request.active) return
      const reaction: TeamChatReaction = existing ?? { id: randomUUID(), messageId: message.id, reactorId: actorId,
        reactorName: actor === undefined ? 'User' : actor.id === root.id ? 'Kira' : this.participant(root, actor.session.header, actor.session.events, 'working').name,
        reactorKind: actor === undefined ? 'user' : actor.id === root.id ? 'kira' : 'agent', emoji: request.emoji, createdAt: Date.now() }
      root.append('team/chat-reaction', { version: 1, reaction, active: request.active })
      await this.ctx.sessions.flush(root)
    })
  }

  /** Retry only previously admitted human requests when their root is resumed.
   * @param agent - exact resumed root Agent.
   */
  async recover(agent: Agent): Promise<void> {
    if (agent.session.header.origin === 'subagent') return
    for (const row of this.messages(agent.session)) {
      if (row.missionId !== agent.id || row.senderKind !== 'user' || (row.deliveries?.some(item => !item.accepted) !== true && row.supervised === true) || row.targetId === undefined) continue
      await this.reply({ sessionId: agent.id, requestId: row.id, targetId: row.targetId,
        targetIds: row.mentions, text: row.text, ...(row.replyTo === undefined ? {} : { replyTo: row.replyTo }) })
    }
  }

  /** Deliver a human reply only to an existing direct child, preserving root supervision.
   * @param request - retry-stable human intervention.
   * @returns message identity and pending-delivery state.
   */
  async reply(request: TeamChatReplyRequest): Promise<{ messageId: string; queued: boolean }> {
    const root = this.root(request.sessionId)
    const lead = this.ctx.agents.get(root.id)
    if (lead === undefined) throw new Error('team lead is not active')
    const targets = [...new Set([request.targetId, ...(request.targetIds ?? [])])].map(SessionId)
    if (targets.length > this.maxTargets) throw new Error('too many addressed agents')
    for (const target of targets) {
      const live = this.ctx.sessions.get(target)
      const header = live?.header ?? (await this.ctx.sessionPersistence.inspect(target)).meta
      if (header.origin !== 'subagent' || header.parentSession !== root.id) throw new Error('target does not belong to this team as a direct child')
    }
    if (typeof request.text !== 'string' || request.text.trim() === '' || Buffer.byteLength(request.text) > this.maxBytes) throw new Error('invalid or oversized team reply')
    const previous = request.replyTo === undefined ? undefined : this.messages(root).find(row => row.id === request.replyTo)
    if (request.replyTo !== undefined && previous === undefined) throw new Error('reply message not found')
    const text = previous === undefined ? request.text : `Reply to ${previous.senderName} (${previous.id}):\n${previous.text}\n\n${request.text}`
    if (typeof request.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(request.requestId)) throw new Error('invalid reply request identity')
    const messageId = request.requestId
    await this.journal.transact(root.id, async () => {
      this.assertLive(root)
      if (this.ctx.sessions.get(root.id) !== root || this.ctx.agents.get(root.id) !== lead) throw new Error('team lead session changed')
      let row = this.messages(root).find(item => item.id === messageId)
      if (row !== undefined && (row.senderKind !== 'user' || row.text !== request.text
        || row.replyTo !== request.replyTo || JSON.stringify(row.mentions) !== JSON.stringify(targets))) throw new Error('reply request identity conflicts')
      if (row === undefined) {
        // Validate all targets before committing a visible request.
        for (const target of targets) {
          const child = this.ctx.sessions.get(target)
          const saved = child === undefined
            ? await this.ctx.sessionPersistence.inspect(target) : { meta: child.header, events: child.events }
          const descriptor = foldSubagentDescriptor(saved.events.slice(saved.meta.seedLength ?? 0))
          if (descriptor?.mode !== 'continuable') throw new Error('target child is not continuable')
        }
        row = { id: messageId, senderId: 'user', senderName: 'User', senderKind: 'user', missionId: root.id, text: request.text,
          time: Date.now(), sourceSeq: root.events.length, targetId: request.targetId,
          ...(previous === undefined ? {} : { replyTo: previous.id, replyQuote: `${previous.senderName}: ${previous.text}` }),
          mentions: targets, reactions: [], deliveries: targets.map(targetId => ({ targetId, accepted: false })) }
        root.append('team/chat-message', { version: 1, message: row })
        await this.ctx.sessions.flush(root)
      }
      // Entering the delivery loop establishes a list; each update retains it.
      let current: TeamChatMessage = row
      for (const delivery of current.deliveries ?? []) {
        if (delivery.accepted) continue
        const target = SessionId(delivery.targetId)
        const marker = `[Team user message ${messageId}]`
        try {
          const child = this.ctx.sessions.get(target)
          const saved = child === undefined
            ? await this.ctx.sessionPersistence.inspect(target) : { meta: child.header, events: child.events }
          const already = messageAccepted(saved.events.slice(saved.meta.seedLength ?? 0), message =>
            message.source.kind === 'user' && textOf(message.content).startsWith(marker))
          const modelSelection = teamWorkerSelection(lead)
          if (!already) await this.ctx.subagents.followup(lead, target, [{ type: 'text', text: `${marker}\nUser priority: answer this person at the next safe boundary; do not interrupt an in-flight action.\nThen continue your existing mission unless the user explicitly changes or cancels it. Use team_chat_answer for a conversational question; operational corrections still require execution evidence.\nUser request: ${JSON.stringify(request.text)}\nReply context:\n${text}` }],
            { source: { kind: 'user' }, delivery: 'next-safe-step', signal: this.signal,
              ...modelSelection === undefined ? {} : { modelSelection } })
          const active = this.ctx.sessions.get(target)
          if (active !== undefined) await this.ctx.sessions.flush(active)
          current = { ...current,
            deliveries: (current.deliveries as NonNullable<TeamChatMessage['deliveries']>).map(item => item.targetId === target ? { targetId: target, accepted: true } : item) }
        } catch (error) {
          current = { ...current, deliveries: (current.deliveries as NonNullable<TeamChatMessage['deliveries']>).map(item => item.targetId === target
            ? { targetId: target, accepted: false, error: error instanceof Error ? error.message : 'Delivery failed' } : item) }
        }
        this.assertLive(root)
        root.append('team/chat-message', { version: 1, update: true, message: current })
        await this.ctx.sessions.flush(root)
      }
      this.assertLive(root)
      if (current.supervised !== true) {
        const marker = `[Team supervision ${messageId}]`
        if (!messageAccepted(root.events, message => message.source.kind === 'plugin' && message.source.plugin === 'agent-teams'
          && textOf(message.content).startsWith(marker))) {
          lead.inject(createUserMessage({ content: [{ type: 'text', text: `${marker}\nUser addressed ${targets.join(', ')}: ${text}` }],
            source: { kind: 'plugin', plugin: 'agent-teams', form: 'notice', summary: 'User intervention in the team conversation' } }))
        }
        await this.ctx.sessions.flush(root)
        current = { ...current, supervised: true }
        this.assertLive(root)
        root.append('team/chat-message', { version: 1, update: true, message: current })
        await this.ctx.sessions.flush(root)
      }
    })
    return { messageId, queued: this.messages(root).find(row => row.id === messageId)?.deliveries?.some(item => !item.accepted) === true }
  }
}
