/** Model-visible wrap-up instruction for a terminal autonomous goal update. */

import type { ContentBlock } from '@phoenix-ai/dsh-llm'

const GROUNDING =
  'Report only what earlier rounds and tool results in this session actually establish; '
  + 'when a detail is not in the session, say so instead of inventing it. '

/**
 * Public completion wrapup digest shape.
 */
export interface CompletionWrapupDigest {
  readonly judgeSummary?: string
  readonly findings?: readonly string[]
  readonly knownLimitations?: readonly string[]
  readonly unverifiedItems?: readonly string[]
  readonly verificationIncidents?: readonly string[]
}

function unique(items: readonly string[] | undefined): string[] {
  if (items === undefined) return []
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.replace(/\s+/gu, ' ').trim().toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function canonicalDigest(value: CompletionWrapupDigest | undefined): object | undefined {
  if (value === undefined) return undefined
  return {
    judgeSummary: value.judgeSummary,
    findings: unique(value.findings),
    knownLimitations: unique(value.knownLimitations),
    unverifiedItems: unique(value.unverifiedItems),
    verificationIncidents: unique(value.verificationIncidents),
  }
}

/**
 * Render the closing-message instruction injected after an autonomous goal
 * round reports `complete` or `blocked`, replacing the former hard turn stop
 * so the model still addresses the user once before the turn ends.
 * @param objective - the terminal goal's objective, echoed for grounding.
 * @param blockedReason - the validated report for `blocked`; omitted for `complete`.
 * @returns a fresh one-block context for `ToolRunContext.deferContext()`.
 * @param digest - The digest value.
 */
export function renderWrapupContext(
  objective: string,
  blockedReason?: string,
  digest?: CompletionWrapupDigest,
): ContentBlock[] {
  const heading = `Objective: ${JSON.stringify(objective)}\n`
  const canonical = canonicalDigest(digest)
  const digestText = canonical === undefined ? '' : `Canonical completion digest: ${JSON.stringify(canonical)}\n`
  const text = blockedReason === undefined
    ? '<goal_complete>\n'
      + heading
      + digestText
      + 'The goal is marked complete and this autonomous run is ending. Write the closing '
      + 'message to the user now using the canonical completion digest as the single source of truth when it is present. '
      + 'State the outcome, summarize what was done and how it was verified, and point to concrete results (files, commits, or other artifacts). '
      + GROUNDING
      + 'Mention each known limitation at most once. Do not duplicate sections, counts, benchmarks, review narratives, or tool-status explanations. '
      + 'Never claim a verifier or tool ran successfully when the canonical digest records a verification incident. '
      + 'Note anything the user should review or do next. Address the user directly. Do not '
      + "call any more tools in this run; further work waits for the user's next instruction.\n"
      + '</goal_complete>'
    : '<goal_blocked>\n'
      + heading
      + `Blocked: ${JSON.stringify(blockedReason)}\n`
      + 'The goal is marked blocked and this autonomous run is ending. Write the closing '
      + 'message to the user now: state what has been completed so far, describe the concrete '
      + 'blocking condition and what you tried, and say exactly what you need from the user to '
      + 'continue. '
      + GROUNDING
      + 'Address the user directly. Do not call any more tools in this run; further work '
      + "waits for the user's next instruction.\n"
      + '</goal_blocked>'
  return [{ type: 'text', text }]
}
