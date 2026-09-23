/** Intent-aware memory routing and calendar-window resolution for Phoenix. */

import type { CognitiveMemoryLayer } from '@phoenix-ai/dsh-session-learning'

const DAY_MS = 24 * 60 * 60 * 1_000

/** High-level memory purpose inferred from one user request. */
export type MemoryIntentKind =
  | 'ordinary'
  | 'work-history'
  | 'learning-history'
  | 'backward-task'
  | 'diagnostic-history'
  | 'profile-memory'

/** Runtime clock evidence used to resolve relative temporal expressions. */
export interface MemoryIntentClock {
  readonly now: number
  readonly timezoneOffsetMinutes: number
}

/** Bounded retrieval policy derived from one user request. */
export interface ResolvedMemoryIntent {
  readonly kind: MemoryIntentKind
  readonly crossProject: boolean
  readonly layers: readonly CognitiveMemoryLayer[]
  readonly excludeProfileSubjects: boolean
  readonly from?: number
  readonly to?: number
}

/**
 * Classify one user message into a bounded memory-retrieval policy.
 * @param text - Current user request.
 * @param clock - Current instant and local UTC offset used for relative dates.
 * @returns Retrieval intent with absolute temporal bounds when requested.
 */
export function resolveMemoryIntent(text: string, clock: MemoryIntentClock): ResolvedMemoryIntent {
  validateClock(clock)
  const normalized = normalize(text)
  const bounds = temporalBounds(normalized, clock)

  const kind = classifyIntent(normalized)
  const base = intentPolicy(kind)
  return {
    ...base,
    ...bounds === undefined ? {} : bounds,
  }
}

function classifyIntent(text: string): MemoryIntentKind {
  if (/(?:\bque\s+(?:has\s+)?aprendid[oa]|\bque\s+aprendiste|\bwhat\s+(?:have\s+you\s+)?learned|\bwhat\s+did\s+you\s+learn)/u.test(text)) {
    return 'learning-history'
  }
  if (/(?:\bque\s+(?:recuerdas|sabes)\s+de\s+mi\b|\bmis\s+preferencias\b|\bwhat\s+do\s+you\s+(?:remember|know)\s+about\s+me\b|\bmy\s+preferences\b)/u.test(text)) {
    return 'profile-memory'
  }
  if (/(?:\bcomo\s+(?:arreglaste|resolviste|diagnosticaste)\b|\bhow\s+did\s+you\s+(?:fix|solve|diagnose)\b|\b(?:error|fallo|falla|bug|epipe)\s+(?:anterior|previo|previous)\b)/u.test(text)) {
    return 'diagnostic-history'
  }
  if (/(?:\b(?:como|igual\s+que)\s+(?:antes|la\s+otra\s+vez|el\s+anterior|la\s+anterior)\b|\b(?:same\s+as|like)\s+(?:before|last\s+time|the\s+previous)\b|\b(?:tarea|problema|task|problem)\s+(?:anterior|previo|previous|last)\b)/u.test(text)) {
    return 'backward-task'
  }
  if (/(?:\bque\s+(?:hicimos|trabajamos|proyectos?\s+hicimos)\b|\b(?:ultimo|ultima|ultimos|ultimas)\s+(?:proyecto|trabajo|tarea)s?\b|\bwhat\s+did\s+we\s+(?:do|work\s+on)\b|\b(?:last|previous)\s+(?:project|work|task)s?\b)/u.test(text)
    || hasExplicitHistoryTime(text)) {
    return 'work-history'
  }
  return 'ordinary'
}

function intentPolicy(kind: MemoryIntentKind): Omit<ResolvedMemoryIntent, 'from' | 'to'> {
  switch (kind) {
    case 'work-history':
      return {
        kind,
        crossProject: true,
        layers: ['autobiographical', 'episodic', 'temporal'],
        excludeProfileSubjects: true,
      }
    case 'learning-history':
      return {
        kind,
        crossProject: true,
        layers: ['semantic', 'procedural', 'episodic', 'temporal'],
        excludeProfileSubjects: true,
      }
    case 'backward-task':
      return {
        kind,
        crossProject: true,
        layers: ['autobiographical', 'episodic', 'procedural', 'temporal'],
        excludeProfileSubjects: true,
      }
    case 'diagnostic-history':
      return {
        kind,
        crossProject: true,
        layers: ['episodic', 'procedural', 'semantic', 'temporal'],
        excludeProfileSubjects: true,
      }
    case 'profile-memory':
      return {
        kind,
        crossProject: true,
        layers: ['semantic', 'autobiographical', 'temporal'],
        excludeProfileSubjects: false,
      }
    case 'ordinary':
      return {
        kind,
        crossProject: false,
        layers: [],
        excludeProfileSubjects: true,
      }
  }
}

function temporalBounds(text: string, clock: MemoryIntentClock): { readonly from: number; readonly to: number } | undefined {
  const startToday = startOfLocalDay(clock.now, clock.timezoneOffsetMinutes)
  if (/\b(?:anteayer|day\s+before\s+yesterday)\b/u.test(text)) {
    return { from: startToday - 2 * DAY_MS, to: startToday - DAY_MS - 1 }
  }
  if (/\b(?:ayer|yesterday)\b/u.test(text)) {
    return { from: startToday - DAY_MS, to: startToday - 1 }
  }
  if (/\b(?:hoy|today)\b/u.test(text)) {
    return { from: startToday, to: startToday + DAY_MS - 1 }
  }
  if (/\b(?:semana\s+pasada|last\s+week)\b/u.test(text)) {
    const localNow = new Date(clock.now + clock.timezoneOffsetMinutes * 60_000)
    const daysSinceMonday = (localNow.getUTCDay() + 6) % 7
    const startThisWeek = startToday - daysSinceMonday * DAY_MS
    return { from: startThisWeek - 7 * DAY_MS, to: startThisWeek - 1 }
  }
  return undefined
}

function startOfLocalDay(now: number, offsetMinutes: number): number {
  const offsetMs = offsetMinutes * 60_000
  const local = new Date(now + offsetMs)
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMs
}

function hasExplicitHistoryTime(text: string): boolean {
  return /\b(?:ayer|anteayer|yesterday|day\s+before\s+yesterday|semana\s+pasada|last\s+week)\b/u.test(text)
}

function validateClock(clock: MemoryIntentClock): void {
  if (!Number.isFinite(clock.now) || clock.now < 0) throw new TypeError('memory intent now must be a non-negative timestamp')
  if (!Number.isFinite(clock.timezoneOffsetMinutes) || Math.abs(clock.timezoneOffsetMinutes) > 14 * 60) {
    throw new TypeError('memory intent timezone offset must be between -840 and 840 minutes')
  }
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
}
