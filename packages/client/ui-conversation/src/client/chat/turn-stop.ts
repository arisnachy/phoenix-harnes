import type { TurnEndReason } from '@phoenix-ai/dsh-session'
import type { zh } from '../locales.ts'

type StopNoticeKey = Extract<keyof typeof zh, `message.stop.${string}`>

/** Resolve a factual stop notice without asking a failed model to generate prose. */
export function turnStopNotice(reason: TurnEndReason, hasClosingText: boolean): StopNoticeKey | undefined {
  if (reason.kind === 'completed') return hasClosingText ? undefined : 'message.stop.noFinal'
  if (reason.kind === 'aborted') {
    if (reason.reason.kind === 'user') return 'message.stop.user'
    if (reason.reason.kind === 'parent') return 'message.stop.parent'
    if (reason.reason.kind === 'disposed') return 'message.stop.disposed'
    return 'message.stop.cancelled'
  }
  if (reason.kind === 'interrupted') return 'message.stop.interrupted'
  if (reason.kind === 'blocked') return 'message.stop.blocked'
  if (reason.kind === 'error') return 'message.stop.error'
  if (reason.kind === 'max-tokens') return 'message.stop.limit'
  return 'message.stop.cancelled'
}
