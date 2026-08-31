/**
 * Wire-safe question and answer types, free of cordis/service imports so browser
 * type chains (apiproxy api → client) can consume them without loading this
 * package's Context augmentation.
 * @module @phoenix-ai/dsh-user-questions/types
 */

/** One selectable answer offered to the user. */
export interface AskUserQuestionOption {
  /** User-facing label. */
  label: string
  /** Optional extra context rendered by capable UIs. */
  description?: string
  /** Explicit system recommendation used when the user does not answer in time. */
  recommended?: boolean
}

/** Durable wall-clock window shared by the host and every question surface. */
export interface QuestionDeadline {
  /** Wall-clock time when the question became answerable. */
  readonly requestedAt: number
  /** Wall-clock time when the automatic answer is applied. */
  readonly expiresAt: number
}

/**
 * A caller-declared presentation intent: the question IS this kind of
 * decision, so a UI that recognises the tag may present it as such instead of as a
 * generic option list. Tagged so further intents can be added; a UI that does
 * not know a tag renders the generic flow, and the answer encoding is identical
 * either way — an intent changes presentation only, never the protocol.
 */
export type AskUserQuestionIntent = {
  /** A plan submitted for review: `detail` is the plan markdown `ask()` requires, and the decision approves or declines it. */
  kind: 'plan-review'
  /**
   * The option label that approves the plan; every other option declines it.
   * Named rather than positional so no UI infers the verdict from option order.
   * An `approve` naming no option of its own question is rejected at `ask()`.
   */
  approve: string
}

/** One question in a user-questions request. */
export interface AskUserQuestionItem {
  /** Stable caller-provided question id, echoed in the answer. */
  id: string
  /** The question to display. */
  question: string
  /** Optional supporting detail rendered with the question but kept out of option labels. */
  detail?: string
  /** Optional short heading/group label. */
  header?: string
  /** Optional choices the UI can render as a menu. */
  options?: AskUserQuestionOption[]
  /** Whether more than one option may be selected. Defaults to single-select. */
  multiSelect?: boolean
  /** Optional presentation intent for capable UIs; absent asks for the generic option list. */
  intent?: AskUserQuestionIntent
}

/** Answer to one question. */
export interface AskUserQuestionAnswerItem {
  /** The answered question id. */
  id: string
  /** Selected option labels. May accompany custom text for a multi-select question. */
  selected: string[]
  /** Optional free-text "Other" answer. */
  custom?: string
}

/** The human's answer. */
export interface AskUserQuestionAnswer {
  /** Structured answers keyed by question id. */
  answers: AskUserQuestionAnswerItem[]
  /** True only when Phoenix chose the recommendation after the deadline. */
  automatic?: boolean
}

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
 *
 * This module contains only wire-safe types and deterministic policy so browser
 * bundles can inline it without requiring a dynamic module-table row.
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
