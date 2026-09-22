import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import { SessionInputShell } from '../src/client/input/facade.ts'

afterEach(() => {
  vi.useRealTimers()
})

function shell() {
  return new SessionInputShell({
    actx: new Context(),
    defaultSink: async () => ({ kind: 'success' as const }),
    commandImages: {
      serialize: async () => [],
      release: () => {},
      unsupportedNotice: token => token,
    },
  })
}

describe('draft persistence hot path', () => {
  it('debounces draft mirror writes instead of touching persistence per key', () => {
    vi.useFakeTimers()
    const input = shell()
    const mirror = vi.fn()
    input.bindMirror(mirror)

    input.setDraft('a')
    input.setDraft('ab')
    input.setDraft('abc')

    expect(mirror).not.toHaveBeenCalled()
    vi.advanceTimersByTime(179)
    expect(mirror).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(mirror).toHaveBeenCalledTimes(1)
    expect(mirror).toHaveBeenLastCalledWith('abc')
  })

  it('flushes the latest draft at submit and unmount boundaries', () => {
    vi.useFakeTimers()
    const input = shell()
    const mirror = vi.fn()
    const unbind = input.bindMirror(mirror)

    input.setDraft('send me')
    input.submit()
    expect(mirror).toHaveBeenLastCalledWith('send me')

    input.setDraft('keep me')
    unbind()
    expect(mirror).toHaveBeenLastCalledWith('keep me')
    input.dispose()
  })
})
