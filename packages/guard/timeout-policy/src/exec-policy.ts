/**
 * Codex-inspired command policy for PHOENIX's existing `tools/pre-execute`
 * boundary. It is monotonic in production: `allow` delegates to the remaining
 * policy chain, while `prompt` and `forbidden` can only make execution stricter.
 *
 * The evaluator intentionally supports only lexical token-prefix rules. Shell
 * control operators outside quotes mark a command as compound, so a benign
 * allowed prefix can never bless `safe && dangerous` as one operation.
 *
 * @module @deepseek-ai/dsh-tool-call-timeout-policy/exec-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

export type ExecPolicyDecision = 'allow' | 'prompt' | 'forbidden'
export type ExecPolicyPatternPart = string | readonly string[]

export interface ExecPolicyRule {
  /** Ordered token prefix; an array member means any one of those alternatives. */
  readonly pattern: readonly ExecPolicyPatternPart[]
  /** Defaults to allow, matching Codex execpolicy. */
  readonly decision?: ExecPolicyDecision
  /** Human-readable rationale surfaced on prompt/denial. */
  readonly justification?: string
  /** Examples that must match this rule; validated when configuration is compiled. */
  readonly match?: readonly string[]
  /** Examples that must not match this rule; validated when configuration is compiled. */
  readonly notMatch?: readonly string[]
}

export interface ExecPolicyConfig {
  /** Rules are evaluated together and the strictest matching decision wins. */
  readonly rules?: readonly ExecPolicyRule[]
  /** Model-facing shell tools whose `command` string is governed. */
  readonly shellTools?: readonly string[]
  /** What to do with a command containing unquoted shell control operators. */
  readonly complexDecision?: 'inherit' | 'prompt' | 'forbidden'
}

export interface CompiledExecPolicy {
  readonly rules: readonly CompiledRule[]
  readonly shellTools: ReadonlySet<string>
  readonly complexDecision: 'inherit' | 'prompt' | 'forbidden'
}

interface CompiledRule {
  readonly pattern: readonly (string | ReadonlySet<string>)[]
  readonly decision: ExecPolicyDecision
  readonly justification?: string
}

export interface ExecPolicyEvaluation {
  readonly decision: ExecPolicyDecision
  readonly justification?: string
}

interface TokenizedCommand {
  readonly tokens: readonly string[]
  readonly compound: boolean
}

const DEFAULT_SHELL_TOOLS = ['bash', 'pwsh'] as const
const SEVERITY: Readonly<Record<ExecPolicyDecision, number>> = {
  allow: 0,
  prompt: 1,
  forbidden: 2,
}

function tokenize(command: string): TokenizedCommand | undefined {
  const tokens: string[] = []
  let token = ''
  let quote: "'" | '"' | undefined
  let compound = false
  let escaped = false

  const push = (): void => {
    if (token.length === 0) return
    tokens.push(token)
    token = ''
  }

  for (const char of command) {
    if (escaped) {
      token += char
      escaped = false
      continue
    }
    if (quote === "'") {
      if (char === "'") quote = undefined
      else token += char
      continue
    }
    if (quote === '"') {
      if (char === '"') quote = undefined
      else if (char === '\\') escaped = true
      else token += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (/\s/u.test(char)) {
      push()
      if (char === '\n' || char === '\r') compound = true
      continue
    }
    if (';&|><'.includes(char)) {
      push()
      compound = true
      continue
    }
    token += char
  }
  if (quote !== undefined || escaped) return undefined
  push()
  return { tokens, compound }
}

function matches(tokens: readonly string[], pattern: readonly (string | ReadonlySet<string>)[]): boolean {
  if (tokens.length < pattern.length) return false
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index]
    const actual = tokens[index]
    if (typeof expected === 'string') {
      if (actual !== expected) return false
    } else if (actual === undefined || !expected.has(actual)) {
      return false
    }
  }
  return true
}

function compilePart(part: ExecPolicyPatternPart, ruleIndex: number): string | ReadonlySet<string> {
  if (typeof part === 'string') {
    if (part.length === 0) throw new TypeError(`exec policy rule ${ruleIndex} contains an empty token`)
    return part
  }
  if (part.length === 0 || part.some(value => typeof value !== 'string' || value.length === 0)) {
    throw new TypeError(`exec policy rule ${ruleIndex} contains an empty token alternative`)
  }
  return new Set(part)
}

function exampleMatches(example: string, pattern: readonly (string | ReadonlySet<string>)[]): boolean {
  const parsed = tokenize(example)
  return parsed !== undefined && matches(parsed.tokens, pattern)
}

/** Compile and self-test an exec policy before it can affect live tools. */
export function compileExecPolicy(config: ExecPolicyConfig = {}): CompiledExecPolicy {
  const rules: CompiledRule[] = []
  for (const [index, source] of (config.rules ?? []).entries()) {
    if (source.pattern.length === 0) throw new TypeError(`exec policy rule ${index} has an empty pattern`)
    const pattern = source.pattern.map(part => compilePart(part, index))
    const decision = source.decision ?? 'allow'
    for (const example of source.match ?? []) {
      if (!exampleMatches(example, pattern)) {
        throw new TypeError(`exec policy rule ${index} declared match example that does not match: ${JSON.stringify(example)}`)
      }
    }
    for (const example of source.notMatch ?? []) {
      if (exampleMatches(example, pattern)) {
        throw new TypeError(`exec policy rule ${index} declared notMatch example that matches: ${JSON.stringify(example)}`)
      }
    }
    rules.push({
      pattern,
      decision,
      ...(source.justification === undefined ? {} : { justification: source.justification }),
    })
  }
  return {
    rules,
    shellTools: new Set(config.shellTools ?? DEFAULT_SHELL_TOOLS),
    complexDecision: config.complexDecision ?? 'inherit',
  }
}

/** Evaluate one shell command without changing the surrounding policy chain. */
export function evaluateExecPolicy(
  command: string,
  policy: CompiledExecPolicy,
): ExecPolicyEvaluation | undefined {
  const parsed = tokenize(command)
  if (parsed === undefined) {
    return policy.complexDecision === 'inherit'
      ? undefined
      : {
        decision: policy.complexDecision,
        justification: 'Shell syntax could not be classified safely; explicit approval is required.',
      }
  }

  let selected: CompiledRule | undefined
  for (const rule of policy.rules) {
    if (!matches(parsed.tokens, rule.pattern)) continue
    if (selected === undefined || SEVERITY[rule.decision] > SEVERITY[selected.decision]) selected = rule
  }

  if (parsed.compound) {
    if (selected?.decision === 'forbidden') {
      return {
        decision: 'forbidden',
        ...(selected.justification === undefined ? {} : { justification: selected.justification }),
      }
    }
    if (selected?.decision === 'prompt') {
      return {
        decision: 'prompt',
        ...(selected.justification === undefined ? {} : { justification: selected.justification }),
      }
    }
    if (policy.complexDecision === 'inherit') return undefined
    return {
      decision: policy.complexDecision,
      justification: 'Compound shell commands require explicit approval.',
    }
  }

  return selected === undefined
    ? undefined
    : {
      decision: selected.decision,
      ...(selected.justification === undefined ? {} : { justification: selected.justification }),
    }
}

function commandArgument(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const command = (value as Record<string, unknown>).command
  return typeof command === 'string' ? command : undefined
}

function decisionOf(evaluation: ExecPolicyEvaluation): PreToolDecision {
  const reason = evaluation.justification ?? 'Command policy requires explicit approval.'
  if (evaluation.decision === 'forbidden') return { kind: 'deny', reason }
  return { kind: 'ask', reason }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'exec-policy'
/** The gate attaches to PHOENIX's existing tool policy pipeline. */
export const inject = ['tools']

/**
 * Register the Codex-style command policy as a monotonic pre-execute gate.
 * `allow` deliberately delegates to `next()` so this plugin can never bypass a
 * later approval, sandbox, HARDNESS, or deployment policy listener.
 */
export function apply(ctx: Context, config: ExecPolicyConfig = {}): void {
  const policy = compileExecPolicy(config)
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!policy.shellTools.has(exec.name)) return next()
    const command = commandArgument(exec.arguments)
    if (command === undefined) return next()
    const evaluation = evaluateExecPolicy(command, policy)
    if (evaluation === undefined || evaluation.decision === 'allow') return next()
    return decisionOf(evaluation)
  })
}
