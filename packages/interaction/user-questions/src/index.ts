/**
 * Service Definition for the user-questions capability seam (`ctx.userQuestions`): a UI-backed service for
 * pausing an agent tool call until the human answers a question. The model-
 * facing tool lives in `@phoenix-ai/dsh-tool-ask-user`; UI packages provide
 * the single active provider.
 *
 * @module @phoenix-ai/dsh-user-questions
 */

import { Context, Service } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { HarnessError } from '@phoenix-ai/dsh-llm'

declare module '@phoenix-ai/cordis' {
  interface Context {
    userQuestions: UserQuestionService
  }
}

import type {
  AskUserQuestionAnswer, AskUserQuestionAnswerItem, AskUserQuestionItem, AskUserQuestionOption, QuestionDeadline,
} from './types.ts'

export type {
  AskUserQuestionAnswer, AskUserQuestionAnswerItem, AskUserQuestionIntent, AskUserQuestionItem,
  AskUserQuestionOption, QuestionDeadline,
} from './types.ts'

/** Default time before an unanswered question receives its automatic answer. */
const DEFAULT_TIMEOUT_MS = 60_000

/** A recommendation marker accepted from model-authored option labels. */
const RECOMMENDED_SUFFIX = /\s*(?:\((?:recommended|recomendada?|推荐)\)|（(?:recommended|recomendada?|推荐)）)\s*$/i

/** Conservative labels that must win when a confirmation has no explicit recommendation. */
const CONSERVATIVE_OPTION = new RegExp(
  `\\b(?:${[
    'cancel(?:l|ar|ación|ation)?', 'no', 'not now', 'later', 'reject(?:ed|ion)?', 'deny', 'decline', 'refuse',
    'stop', 'skip', 'keep', "don't", 'do not', 'never', 'safe', 'read[ -]?only', 'cancelar', 'ahora no',
    'más tarde', 'rechazar', 'denegar', 'omitir', 'detener', 'mantener', 'nunca', 'solo lectura',
  ].join('|')})\\b`,
  'i',
)

/**
 * Build a finite question deadline for the provider and UI.
 * @param input - Start time and configured timeout in milliseconds.
 * @returns The absolute question deadline shared by host and clients.
 */
export function createQuestionDeadline(input: { now: number; timeoutMs: number }): QuestionDeadline {
  if (!Number.isFinite(input.now) || !Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new RangeError('question deadline requires a finite positive timeout')
  }
  return { requestedAt: input.now, expiresAt: input.now + input.timeoutMs }
}

/** Find the option the model or the safe fallback designated for expiry. */
function recommendedOption(question: AskUserQuestionItem): AskUserQuestionOption | undefined {
  const options = question.options ?? []
  return options.find(option => option.recommended === true)
    ?? options.find(option => RECOMMENDED_SUFFIX.test(option.label))
    ?? (question.multiSelect === true ? undefined : options.find(option => CONSERVATIVE_OPTION.test(option.label)))
    ?? (question.multiSelect === true ? undefined : options[0])
}

/**
 * Return one deterministic answer for a question that reached its deadline.
 * @param question - Question whose options determine the automatic answer.
 * @returns The structured answer for the expired question.
 */
export function automaticAnswerForQuestion(question: AskUserQuestionItem): AskUserQuestionAnswerItem {
  if (question.multiSelect === true) {
    const selected = (question.options ?? [])
      .filter(option => option.recommended === true || RECOMMENDED_SUFFIX.test(option.label))
      .map(option => option.label)
    return { id: question.id, selected }
  }
  const option = recommendedOption(question)
  return option === undefined ? { id: question.id, selected: [] } : { id: question.id, selected: [option.label] }
}

/**
 * Return the complete structured answer applied when a question batch expires.
 * @param questions - Questions in the pending interaction.
 * @returns Structured answers for every expired question.
 */
export function automaticAnswerForQuestions(questions: readonly AskUserQuestionItem[]): AskUserQuestionAnswer {
  return { answers: questions.map(automaticAnswerForQuestion) }
}

/** Request for a human answer. */
export interface AskUserQuestionRequest {
  /** Questions to display. */
  questions: AskUserQuestionItem[]
  /** Exact live calling agent, when the request came from an agent tool call. */
  agent?: Agent
  /** Abort signal for the owning tool/step. */
  signal?: AbortSignal
  /** Host-issued deadline; callers should let the service populate it. */
  deadline?: QuestionDeadline
}

/** UI-side provider for user questions. */
export interface UserQuestionProvider {
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}

/** Plugin configuration for the bounded human-interaction window. */
export interface Config {
  /** Milliseconds before the safe recommendation is applied. */
  readonly timeoutMs?: number
}

/** Stable error taxonomy for user-questions failures. */
export class UserQuestionError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'UserQuestionError'
  }
}

/** `ctx.userQuestions`: one active UI provider plus an `ask()` API. */
export class UserQuestionService extends Service {
  private provider: UserQuestionProvider | undefined

  static Config: z<Config> = z.object({
    timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS),
  })

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'userQuestions')
  }

  /**
   * Register the UI provider. Only one provider may be active in a context.
   *
   * @param provider UI-side implementation that collects answers.
   * @returns Disposer that unregisters this provider.
   */
  registerProvider(provider: UserQuestionProvider): () => void {
    const dispose = this.ctx.effect(function* (this: UserQuestionService) {
      if (this.provider !== undefined) {
        throw new UserQuestionError('a user-questions provider is already registered', 'DUPLICATE_PROVIDER')
      }
      this.provider = provider
      yield () => {
        this.provider = undefined
      }
    }.bind(this), 'userInteraction.registerProvider()')
    return () => void dispose()
  }

  /**
   * Ask the active UI provider and wait for the user's answer.
   *
   * When a caller supplies an agent, human interaction is valid only for the
   * exact live runtime root. Runtime ownership, not durable session lineage,
   * decides this boundary: an owned child has no human answerer and would
   * block forever, while a lineage-bearing session resumed as a new runtime
   * root may ask normally.
   *
   * @param request Questions, owner agent, and abort signal.
   * @returns The answer chosen or typed by the human.
   * @throws {UserQuestionError} code `CALLER_NOT_LIVE` when a supplied
   *   agent is not the registry's exact live instance, or `DELEGATED_CALLER`
   *   when that live agent is owned by another agent.
   */
  async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    if (request.signal?.aborted) {
      throw new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED')
    }
    if (request.questions.length === 0) {
      throw new UserQuestionError('ask_user_question requires at least one question', 'EMPTY_QUESTIONS')
    }
    const agent = request.agent
    if (agent !== undefined) {
      const agents = this.ctx.get('agents')
      if (agents === undefined || agents.get(agent.id) !== agent) {
        throw new UserQuestionError(
          'human interaction requires the exact live calling agent when an agent is supplied',
          'CALLER_NOT_LIVE')
      }
      if (!agents.roots().includes(agent)) {
        throw new UserQuestionError(
          'human interaction is unavailable while the calling agent is owned by another live agent; '
          + "include the unresolved question or decision in the child agent's final result",
          'DELEGATED_CALLER')
      }
    }
    // A presentation intent asserts two things the types cannot: that the
    // named approve label is one of this question's own options, and that a
    // plan-review carries the plan it is a review of. A UI honouring the
    // intent answers with that label, and shows that detail as the plan, so
    // either gap would put a choice the asker never offered — or an approval of
    // something invisible — in front of the user. Caught at the asker, where
    // the mistake is, rather than in each UI.
    for (const question of request.questions) {
      const intent = question.intent
      if (intent === undefined) continue
      if (!(question.options ?? []).some(option => option.label === intent.approve)) {
        throw new UserQuestionError(
          `question ${question.id} declares intent ${intent.kind} whose approve label `
          + `${JSON.stringify(intent.approve)} names none of its options`,
          'BAD_INTENT')
      }
      if (question.detail === undefined) {
        throw new UserQuestionError(
          `question ${question.id} declares intent ${intent.kind} without the detail it reviews`,
          'BAD_INTENT')
      }
    }
    if (this.provider === undefined) {
      throw new UserQuestionError('no user-questions provider is registered', 'NO_PROVIDER')
    }
    const deadline = createQuestionDeadline({
      now: Date.now(),
      timeoutMs: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
    return this.provider.ask({ ...request, deadline })
  }
}

export default UserQuestionService
