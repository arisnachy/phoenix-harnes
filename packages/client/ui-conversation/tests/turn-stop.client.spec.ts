import { expect, it } from 'vitest'
import { turnStopNotice } from '../src/client/chat/turn-stop.ts'

it('distinguishes user cancellation, process disposal and crash recovery', () => {
  expect(turnStopNotice({ kind: 'aborted', reason: { kind: 'user' } }, true)).toBe('message.stop.user')
  expect(turnStopNotice({ kind: 'aborted', reason: { kind: 'disposed' } }, true)).toBe('message.stop.disposed')
  expect(turnStopNotice({ kind: 'interrupted' }, false)).toBe('message.stop.interrupted')
})
it('never treats an empty completion or error as a delivered final answer', () => {
  expect(turnStopNotice({ kind: 'completed' }, false)).toBe('message.stop.noFinal')
  expect(turnStopNotice({ kind: 'completed' }, true)).toBeUndefined()
  expect(turnStopNotice({ kind: 'error', error: { code: 'UNKNOWN', message: 'failure' } }, true)).toBe('message.stop.error')
})
