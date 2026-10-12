/**
 * A per-agent persona as a composable row.
 *
 * `dsh-system-prompt` owns the global persona as its own config, and registers
 * that section unconditionally — so this row is **scope-only**. Mounted inside
 * an agent preset it shadows the deployment persona for that one session,
 * exactly like the per-child persona `dsh-subagent` installs; mounted globally
 * it collides with the registry's own registration and fails loud.
 *
 * That constraint is the reason the row exists. An agent preset cannot mount
 * the prompt registry itself, so without a row of its own a preset could
 * change an agent's tools but never its identity.
 * @module @phoenix-ai/dsh-persona
 */

import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import { settingsNamespace } from '@phoenix-ai/dsh-settings'
import type {} from '@phoenix-ai/dsh-system-prompt'

// Imported rather than restated: the registry declares the slot this row
// replaces, and two hardcoded copies would drift into a preset whose persona
// silently lands beside the deployment's instead of shadowing it.
import { PERSONA_ORDER, PERSONA_SECTION } from '@phoenix-ai/dsh-system-prompt'

export { PERSONA_ORDER, PERSONA_SECTION }

/** Cordis plugin name. */
export const name = 'persona'

/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt']

/** Plugin config: the persona text this composition contributes. */
export interface Config {
  /**
   * Persona prose rendered as the `deployment:persona` section. A template:
   * complete `{{…}}` groups interpolate strictly against registered prompt
   * variables. Empty text drops the section at render, matching the registry.
   */
  text: string
  /** Make this persona the complete system prompt, suppressing every other section. */
  complete?: boolean
  /** Suppress dynamic runtime-context snapshots for this persona's agent scope. */
  includeRuntimeContext?: boolean
}

/** Runtime schema for the persona row. */
export const Config: z<Config> = z.object({
  text: z.string().required(),
  complete: z.boolean().default(false),
  includeRuntimeContext: z.boolean().default(true),
})

/** Language override in the user's selected Web locale for the effective YAML persona. */
export const PHOENIX_LOCALE_VARIABLE = 'phoenix_locale_instruction'

/**
 * Resolve a language directive from the persisted Phoenix interface preference.
 * A tool or judge's output never changes a deliberately chosen UI language.
 * @param preference - Explicit stored locale identifier, when present.
 * @returns A directive in the selected language, or a user-message fallback.
 */
export function localeInstruction(preference: unknown): string {
  switch (preference) {
    case 'es':
      return 'IDIOMA ELEGIDO EN PHOENIX: ESPAÑOL. Escribe todas las respuestas dirigidas al usuario en español natural, incluso después de herramientas, jueces, tareas, memoria, subagentes y reinicios. Traduce las explicaciones y conclusiones; conserva literalmente el código, las rutas, las claves YAML, los identificadores y las citas que deban ser exactas. Un mensaje de una herramienta en inglés no cambia esta preferencia.'
    case 'en':
      return 'PHOENIX SELECTED LANGUAGE: ENGLISH. Write every user-facing answer in natural English, including after tools, judges, memory, tasks, subagents and restarts. Translate explanations and conclusions but preserve exact code, YAML keys, paths, identifiers and quotations. A tool result in another language does not change this preference.'
    case 'zh':
      return 'PHOENIX 已选语言：简体中文。所有面向用户的回答都使用自然的简体中文，包括工具、评审、记忆、任务、子代理和重启之后的回复。翻译解释和结论，但保留代码、YAML 键、路径、标识符和必要的原文引用；工具输出的语言不能覆盖此偏好。'
    default:
      return 'No explicit language selected in PHOENIX settings: reply in the language of the user’s latest message and keep it after tool, judge and subagent output. Do not infer a language switch from technical logs. Preserve exact technical identifiers and source code.'
  }
}

/**
 * Register the persona section for the mounting context's scope.
 * @param ctx - an agent scope context; an unscoped context collides with the
 * prompt registry's own persona registration and rejects.
 * @param config - the persona text and complete-prompt policy.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: PERSONA_SECTION,
    order: PERSONA_ORDER,
    text: config.text,
    ...(config.complete ? { complete: true } : {}),
  }), 'persona.section()')
  // Evaluate the durable Host preference on every assembly, never once per
  // standing preset mount; changes apply to subsequent model turns.
  ctx.effect(() => ctx.systemPrompt.variable(PHOENIX_LOCALE_VARIABLE, () => {
    const settings = ctx.get('settings')
    const selection = settings?.get(settingsNamespace('locale')) as { preference?: unknown } | undefined
    return localeInstruction(selection?.preference)
  }), 'persona.localeInstruction()')
  if (!(config.includeRuntimeContext ?? true)) ctx.systemPrompt.suppressRuntimeContext()
}
