// Settled-node identity prevents stream-delta updates from rerendering this row.
// Mounted on 'conversation.composer.dock' so it sticks with the composer in the
// active conversation scrollport (see ConversationRoot data-conversation-scroll).

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Tooltip } from '@phoenix-ai/dsh-client-ui-primitives'
import type { ConversationSnapshot, UseProjection } from '@phoenix-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@phoenix-ai/dsh-client-ui-slots'
// Type-only: merges the sessionStats key into SessionProjectionMap for useProjection.
import type {} from '@phoenix-ai/dsh-session-stats/client'
import type { ContextPressureProjection, TokenUsageProjection } from '@phoenix-ai/dsh-token-meter/client'
import type { ComposerBarProps } from '../contract/slots.ts'
import { formatTokensPerSecond } from './message-chrome.ts'
import { assistantStepReading } from './turn-metrics.ts'
import css from './StatsLine.module.css'

interface WindowStats {
  turns: number
  steps: number
  /** Summed request wall time (step/start → assistant/message); 0 when no node carries timing. */
  llmMs: number
  /** Summed tool wall time (tool/call → tool/result); 0 when no pair is in-window. */
  toolMs: number
  /** Summed first-token latency over `ttftSteps`; 0 when no step records it. */
  ttftMs: number
  /** Steps carrying a recorded TTFT. */
  ttftSteps: number
  /** Summed decode wall time over steps that also report output tokens. */
  decodeMs: number
  /** Summed output tokens over the same decode-timed steps. */
  decodeTokens: number
}

/**
 * Fold assistant and tool-result nodes into window-scoped display totals —
 * the FALLBACK for assemblies without the `sessionStats` projection.
 *
 * Every displayed figure rides that durable whole-log projection (and token
 * accounting rides `tokenUsage`) because the window is paged and compaction
 * rewrites it; this fold answers "what is on screen" only when no projection
 * value is served. Its field names deliberately mirror the projection's so
 * the two swap wholesale.
 * @param nodes - snapshot nodes.
 * @returns fallback counts and summed wall times.
 */
export function deriveStats(nodes: ConversationSnapshot['nodes']): WindowStats {
  const turns = new Set<number>()
  let steps = 0
  let llmMs = 0
  let toolMs = 0
  let ttftMs = 0
  let ttftSteps = 0
  let decodeMs = 0
  let decodeTokens = 0
  for (const node of nodes) {
    if (node.kind === 'tool-result') {
      if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime)
      continue
    }
    if (node.kind !== 'assistant') continue
    turns.add(node.turn)
    steps += 1
    if (node.timing !== undefined && node.timing.stepStartTime !== null) {
      llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime)
    }
    const reading = assistantStepReading(node)
    if (reading.ttftMs !== null) {
      ttftMs += reading.ttftMs
      ttftSteps += 1
    }
    if (reading.decodeMs !== null && reading.outputTokens !== null) {
      decodeMs += reading.decodeMs
      decodeTokens += reading.outputTokens
    }
  }
  return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
}

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three digits).
 * @param n - token count.
 * @returns display string.
 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/**
 * Compact duration: 45.2s under a minute, 2m42s from there on.
 * @param ms - duration in milliseconds.
 * @returns display string.
 */
export function formatDuration(ms: number): string {
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** Round a cache-read ratio to an integer percentage, with positive ties rounded up. */
function roundedIntegerPercent(cacheReadTokens: number, denominator: number): number {
  const denominatorQuotient = Math.floor(denominator / 200)
  const denominatorRemainder = denominator % 200
  let lower = 0
  let upper = 100
  while (lower < upper) {
    const candidate = Math.floor((lower + upper + 1) / 2)
    const factor = candidate * 2 - 1
    const threshold = factor * denominatorQuotient
      + Math.ceil(factor * denominatorRemainder / 200)
    if (cacheReadTokens >= threshold) {
      lower = candidate
    } else {
      upper = candidate - 1
    }
  }
  return lower
}

/**
 * Display-ready cache-hit share of prompt-side input over the whole durable log.
 * @param usage - the session's token-usage projection value.
 * @returns integer text when integer rounding stays below 100, otherwise the
 * minimum decimal precision that still rounds below 100; a full hit returns
 * 100, and no billed input returns null.
 */
export function cacheHitPercent(usage: TokenUsageProjection): string | null {
  const denominator = billedInputTokens(usage)
  if (denominator === 0) return null
  const missedInputTokens = usage.uncachedInputTokens + usage.cacheWriteTokens
  if (missedInputTokens === 0) return '100'

  const integerPercent = roundedIntegerPercent(usage.cacheReadTokens, denominator)
  if (integerPercent < 100) return String(integerPercent)

  // At the first distinguishing precision, the rounded result is 100 minus
  // one to five units in the final decimal place. Scale only while the next
  // multiplication remains at or below the denominator, then derive that
  // final digit through exact small-factor comparisons.
  let decimalPlaces = 1
  let scaledDoubleGap = missedInputTokens * 200
  const denominatorTens = Math.floor(denominator / 10)
  while (scaledDoubleGap <= denominatorTens) {
    scaledDoubleGap *= 10
    decimalPlaces += 1
  }
  const denominatorOnes = denominator % 10
  let roundedLoss = 5
  for (let loss = 1; loss < 5; loss += 1) {
    const factor = loss * 2 + 1
    const threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10)
    if (scaledDoubleGap <= threshold) {
      roundedLoss = loss
      break
    }
  }
  return `99.${'9'.repeat(decimalPlaces - 1)}${10 - roundedLoss}`
}

/**
 * Sum the three disjoint prompt-side billing buckets.
 * @param usage - the session's token-usage projection value.
 * @returns billed input tokens.
 */
export function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

interface ContextOccupancy {
  percent: number
  usedTokens: number
  contextWindow: number
}

/**
 * Approximate context occupancy, using the TUI's integer rounding and upper
 * clamp. The numerator is `projectedTokens` — the provider sample carried
 * forward over the surface's movement since — so compaction shows immediately
 * instead of waiting for the next request to report usage; it falls back to the
 * bare sample only for a log whose projection predates that field. Numerator
 * and capacity remain independent last-wins projection fields, so this is a
 * reference figure rather than an exact measurement of one request (see the
 * token-meter README).
 * @param pressure - the session's context-pressure projection value.
 * @returns occupancy with its numerator and denominator, or null until both values are known.
 */
export function contextOccupancy(
  pressure: ContextPressureProjection | undefined,
): ContextOccupancy | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  return {
    percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}

/** Props: the conversation-snapshot selector plus the projection read seat. */
export interface StatsLineProps {
  useSession: SnapshotSelectorHook<ConversationSnapshot>
  useProjection: UseProjection
  /** The owning dock's locale seat. */
  t: ComposerBarProps['t']
}


type StatIconKind = 'counts' | 'llm' | 'tools' | 'ttft' | 'speed' | 'cache' | 'input' | 'output'

/** Simple monochrome icons, inheriting the native chat color in every theme. */
const STAT_ICON_PATHS: Record<StatIconKind, string> = {
  counts: 'M3 4h14v11H7l-4 2V4ZM6 8h8M6 11h5',
  llm: 'M6 6h8v8H6zM8 2v4M12 2v4M8 14v4M12 14v4M2 8h4M14 8h4M2 12h4M14 12h4',
  tools: 'M13 3a4 4 0 0 0-5 5l-5 5a2.3 2.3 0 0 0 3 3l5-5a4 4 0 0 0 5-5l-3 3-3-3 3-3Z',
  ttft: 'M11 2 4 11h6l-1 7 7-10h-6l1-6Z',
  speed: 'M3 15a7 7 0 1 1 14 0M10 12l4-5M7 15h6',
  cache: 'M3 5c0-3 14-3 14 0s-14 3-14 0ZM3 5v10c0 3 14 3 14 0V5M3 10c0 3 14 3 14 0',
  input: 'M10 2v10m-4-4 4 4 4-4M3 14v3h14v-3',
  output: 'M10 12V2M6 6l4-4 4 4M3 14v3h14v-3',
}
const VISIBILITY_KEY = 'phoenix.composer.stats.visible.v1'

function initialStatsVisibility(): boolean {
  try {
    return typeof window === 'undefined' || window.localStorage.getItem(VISIBILITY_KEY) !== 'false'
  } catch {
    return true
  }
}

function StatIcon({ kind }: { kind: StatIconKind }) {
  return <svg className={css.icon} viewBox="0 0 20 20" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    focusable="false" data-stat-icon={kind}>
    <path d={STAT_ICON_PATHS[kind]} />
  </svg>
}

export const StatsLine = memo(function StatsLine({ useSession, useProjection, t }: StatsLineProps) {
  const settledNodes = useSession(s => s.chat.legacy.nodes)
  const usage = useProjection('tokenUsage')
  // Every figure rides the durable sessionStats projection, so paging and
  // compaction cannot change any of them; an assembly without the unit falls
  // back to the window-scoped fold wholesale (same field names), paid only
  // while no projection value is served.
  const projected = useProjection('sessionStats')
  const stats = useMemo(() => projected ?? deriveStats(settledNodes), [projected, settledNodes])
  const [visible, setVisible] = useState(initialStatsVisibility)
  useEffect(() => {
    try {
      window.localStorage.setItem(VISIBILITY_KEY, String(visible))
    } catch {
      // Storage may be blocked: the UI remains functional in this session.
    }
  }, [visible])

  // Presentation only: whole-session calculations and projection fallbacks
  // stay untouched. Every metric now has a distinct quiet pictogram.
  const metrics: Array<{ icon: StatIconKind; label: string }> = []
  const add = (icon: StatIconKind, label: string): void => { metrics.push({ icon, label }) }
  if (stats.steps > 0) {
    add('counts', t('stats.counts', { turns: stats.turns, steps: stats.steps }))
    if (stats.llmMs > 0) add('llm', t('stats.llm', { duration: formatDuration(stats.llmMs) }))
    if (stats.toolMs > 0) add('tools', t('stats.toolCall', { duration: formatDuration(stats.toolMs) }))
    if (stats.ttftSteps > 0) {
      add('ttft', t('stats.ttftAverage', { duration: formatDuration(stats.ttftMs / stats.ttftSteps) }))
    }
    if (stats.decodeMs > 0) {
      add('speed', t('stats.tokensPerSecond', {
        throughput: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)),
      }))
    }
  }
  // Context occupancy stays on its own ring; no duplicate value.
  if (usage !== undefined
    && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
    const cacheHit = cacheHitPercent(usage)
    if (cacheHit !== null) add('cache', t('stats.cacheHit', { percent: cacheHit }))
    add('input', t('stats.input', { input: formatTokens(billedInputTokens(usage)) }))
    add('output', t('stats.output', { output: formatTokens(usage.outputTokens) }))
  }
  const line = metrics.map(metric => metric.label).join(' | ')
  // The row elides with ellipsis when overlong; a delayed hover tooltip carries
  // the full line, enabled only while content is actually clipped.
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (el === null) return
    const measure = () => { setTruncated(el.scrollWidth > el.clientWidth) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [line, visible])
  if (metrics.length === 0) return null
  const visibilityLabel = t(visible ? 'stats.hide' : 'stats.show')
  return (
    <div className={css.shell} data-composer-stats="" data-visible={visible ? 'true' : 'false'}>
      {visible && (
        <Tooltip label={line} side="top" delayMs={500} disabled={!truncated}>
          <div ref={rootRef} className={css.root} data-stats-track="">
            {metrics.map((metric, i) => (
              <span className={css.metric} key={metric.icon}>
                {i > 0 && <><span className={css.sep} aria-hidden="true">|</span>{' '}</>}
                <StatIcon kind={metric.icon} />
                <span>{metric.label}</span>
              </span>
            ))}
          </div>
        </Tooltip>
      )}
      <Tooltip label={visibilityLabel} side="top" delayMs={350}>
        <button type="button" className={css.visibility} aria-label={visibilityLabel}
          aria-expanded={visible} onClick={() => { setVisible(value => !value) }}>
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true">
            <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" />
            <circle cx="10" cy="10" r="2.5" />
            {!visible && <path d="M3 3 17 17" />}
          </svg>
        </button>
      </Tooltip>
    </div>
  )
})
