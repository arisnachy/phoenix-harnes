/**
 * Pure session projections for subagent identity (mode/label) and active-turn
 * duration.
 *
 * @module @deepseek-ai/dsh-subagent/projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSubagentDescriptor } from './descriptor.ts'
import type { SubagentDescriptorData } from './descriptor.ts'
import type {
  SubagentActivityPhase,
  SubagentActivityProjection,
  SubagentIdentityProjection,
  SubagentTimingProjection,
} from './projection-types.ts'

/** Fold state for a subagent's latest timing snapshot. */
export interface TimingState {
  /** Milliseconds accumulated across completed post-descriptor turns. */
  settledMs: number
  /** Current open interval kept paired inside the fold. */
  active?: { since: number; through: number } | undefined
  /** Latest pre-descriptor turn start, promoted when the child's own descriptor arrives. */
  pendingTurnStart?: number | undefined
  /** Whether the fold has crossed a descriptor in this logical log. */
  descriptorSeen: boolean
}

const activeIntervalSchema = z.object({
  since: z.number().int().nonnegative(),
  through: z.number().int().nonnegative(),
}).strict()

const projectionSchema: z.ZodType<SubagentTimingProjection> = z.object({
  settledMs: z.number().int().nonnegative(),
  active: activeIntervalSchema.optional(),
}).strict().transform(({ settledMs, active }) => ({
  settledMs,
  ...active === undefined ? {} : { active },
}))

const timingStateSchema: z.ZodType<TimingState> = z.object({
  settledMs: z.number().int().nonnegative(),
  active: activeIntervalSchema.optional(),
  pendingTurnStart: z.number().int().nonnegative().optional(),
  descriptorSeen: z.boolean(),
}).strict()

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    subagentTiming: TimingState
    subagent: IdentityState
    subagentActivity: ActivityState
  }
}

/**
 * Fold turn boundaries around the child's own durable descriptor.
 *
 * A fork seed may contain an ancestor descriptor and completed turns. Every
 * descriptor therefore resets the accumulated state; the healthy catalog
 * admits only a child with exactly one descriptor in its own suffix, making
 * the final reset the child's authoritative timing origin.
 */
export const subagentTimingProjectionDefinition = {
  key: 'subagentTiming',
  stateSchema: timingStateSchema,
  init: () => ({ descriptorSeen: false, settledMs: 0 }),
  apply: (state, event) => {
    if (event.type === 'turn/start') {
      return state.descriptorSeen
        ? { ...state, active: { since: event.time, through: event.time } }
        : { ...state, pendingTurnStart: event.time }
    }
    if (event.type === 'subagent/descriptor') {
      const activeSince = state.active?.since ?? state.pendingTurnStart
      return {
        descriptorSeen: true,
        settledMs: 0,
        ...(activeSince === undefined
          ? {}
          : { active: { since: activeSince, through: event.time } }),
      }
    }
    if (event.type === 'turn/end') {
      if (!state.descriptorSeen) {
        if (state.pendingTurnStart === undefined) return state
        const { pendingTurnStart: _closed, ...next } = state
        return next
      }
      if (state.active === undefined) return state
      const { active, ...rest } = state
      return {
        ...rest,
        settledMs: state.settledMs + Math.max(0, event.time - active.since),
      }
    }
    if (state.active === undefined) return state
    return { ...state, active: { ...state.active, through: event.time } }
  },
  wire: {
    viewSchema: projectionSchema,
    view: state => ({
      settledMs: state.settledMs,
      ...(state.active === undefined ? {} : { active: state.active }),
    }),
  },
  stateVersion: 2,
} satisfies ProjectionDefinition<'subagentTiming', TimingState>

/** Fold state for the model route and current open-turn activity. */
export interface ActivityState {
  descriptorSeen: boolean
  route?: { provider: string; model: string }
  openTurn?: {
    turn: number
    sawTool: boolean
    pendingCalls: string[]
  }
}

const activityRouteSchema = z.object({
  provider: z.string(),
  model: z.string(),
}).strict()

const activityStateSchema: z.ZodType<ActivityState> = z.object({
  descriptorSeen: z.boolean(),
  route: activityRouteSchema.optional(),
  openTurn: z.object({
    turn: z.number().int().nonnegative(),
    sawTool: z.boolean(),
    pendingCalls: z.array(z.string()),
  }).strict().optional(),
}).strict()

const activityProjectionSchema: z.ZodType<SubagentActivityProjection> = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  phase: z.enum(['preparing', 'running-tools', 'verifying', 'idle']),
}).strict() as z.ZodType<SubagentActivityProjection>

function activityPhase(state: ActivityState): SubagentActivityPhase {
  if (state.openTurn === undefined) return 'idle'
  if (state.openTurn.pendingCalls.length > 0) return 'running-tools'
  return state.openTurn.sawTool ? 'verifying' : 'preparing'
}

/** Durable model route and safe phase projection for the teams dock. */
export const subagentActivityProjectionDefinition = {
  key: 'subagentActivity',
  stateSchema: activityStateSchema,
  init: () => ({ descriptorSeen: false }),
  apply: (state, event) => {
    if (event.type === 'subagent/descriptor') return { descriptorSeen: true }
    if (!state.descriptorSeen) return state
    if (event.type === 'request/header') {
      const { provider, model } = event.data.header.config
      return typeof provider === 'string' && typeof model === 'string'
        ? { ...state, route: { provider, model } }
        : state
    }
    if (event.type === 'turn/start') {
      return { ...state, openTurn: { turn: event.data.turn, sawTool: false, pendingCalls: [] } }
    }
    if (event.type === 'tool/call' && state.openTurn?.turn === event.data.turn) {
      return {
        ...state,
        openTurn: {
          ...state.openTurn,
          sawTool: true,
          pendingCalls: [...new Set([...state.openTurn.pendingCalls, String(event.data.callId)])],
        },
      }
    }
    if (event.type === 'tool/result' && state.openTurn?.turn === event.data.turn) {
      const source = event.data.message.source
      if (source.kind !== 'tool') return state
      const callId = String(source.callId)
      if (!state.openTurn.pendingCalls.includes(callId)) return state
      return {
        ...state,
        openTurn: {
          ...state.openTurn,
          pendingCalls: state.openTurn.pendingCalls.filter(id => id !== callId),
        },
      }
    }
    if (event.type === 'turn/end' && state.openTurn?.turn === event.data.turn) {
      const { openTurn: _closed, ...rest } = state
      return rest
    }
    return state
  },
  wire: {
    viewSchema: activityProjectionSchema,
    view: state => ({
      ...(state.route === undefined ? {} : state.route),
      phase: activityPhase(state),
    }),
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'subagentActivity', ActivityState>

interface IdentityState {
  /** Identity from the last valid descriptor; absent before one, and after an invalid one. */
  identity?: SubagentIdentityProjection | undefined
}

// The cast bridges only the optional-label arm: Zod's optional output
// includes explicit `undefined`, which exactOptionalPropertyTypes excludes
// from the public interface. The no-value state itself is the serializable
// `null` arm — never `undefined` — so every registry read and push frame
// survives JSON.stringify losslessly.
const identityValueSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('one-shot'),
    label: z.string().optional(),
    seq: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    mode: z.literal('continuable'),
    label: z.string(),
    seq: z.number().int().nonnegative(),
  }).strict(),
]) as unknown as z.ZodType<SubagentIdentityProjection>

const identitySchema = identityValueSchema.nullable()

const identityStateSchema: z.ZodType<IdentityState> = z.object({
  identity: identityValueSchema.optional(),
}).strict()

/** Interpret one `subagent/descriptor` event's identity; no value when the payload cannot be trusted. */
function descriptorIdentity(event: SessionEvent): SubagentIdentityProjection | undefined {
  let descriptor: SubagentDescriptorData | undefined
  try {
    descriptor = foldSubagentDescriptor([event])
  } catch {
    // Only a malformed current-version payload throws in descriptor parsing;
    // a projection fold must never throw, so damage folds to no value.
    descriptor = undefined
  }
  if (descriptor === undefined) return undefined
  return descriptor.mode === 'one-shot'
    ? {
      mode: 'one-shot',
      ...descriptor.label !== undefined ? { label: descriptor.label } : {},
      seq: event.seq,
    }
    : { mode: 'continuable', label: descriptor.label, seq: event.seq }
}

/**
 * Fold the durable mode/label identity from `subagent/descriptor` events,
 * last-wins: a fork seed may replay an ancestor's descriptor, and the child's
 * own descriptor must override it — the same reset discipline as
 * {@link subagentTimingProjectionDefinition}. A malformed or unknown-version
 * payload resets to the `null` sentinel instead of throwing, so a fork of a
 * healthy ancestor never inherits an identity its own descriptor failed to
 * establish — and the reset survives every JSON push frame, so a consumer
 * holding the earlier identity replaces it instead of keeping it stale;
 * `null` ⟺ no valid descriptor, with the causes deliberately undistinguished.
 */
export const subagentIdentityProjectionDefinition = {
  key: 'subagent',
  stateSchema: identityStateSchema,
  init: () => ({}),
  apply: (state, event) => {
    if (event.type !== 'subagent/descriptor') return state
    const identity = descriptorIdentity(event)
    return identity === undefined ? {} : { identity }
  },
  wire: { viewSchema: identitySchema, view: state => state.identity ?? null },
  // Bumped when the identity gained its `seq` field: an older checkpoint row
  // would replay into a value the schema rejects, so it must refold instead.
  stateVersion: 2,
} satisfies ProjectionDefinition<'subagent', IdentityState>
