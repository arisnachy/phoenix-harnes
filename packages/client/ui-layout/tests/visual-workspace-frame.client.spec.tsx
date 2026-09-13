// @vitest-environment jsdom
/** AppFrame shell geometry while Cordis borrows the in-flow visual rail. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { AppFrame } from '@phoenix-ai/dsh-client-ui-layout/src/client/AppFrame.tsx'
import type { AppFrameProps } from '@phoenix-ai/dsh-client-ui-layout/src/client/AppFrame.tsx'
import { createLayoutStore } from '@phoenix-ai/dsh-client-ui-layout/src/client/stores.ts'
import type { SessionListState } from '@phoenix-ai/dsh-client-runtime/client'

class ResizeObserverStub {
  constructor(_cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(selector: (state: T) => S): S {
    return selector(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

function mountWith(owner: 'subagent' | 'cordis') {
  const instance = createLayoutStore().create()
  instance.actions.setWorkspaceOccupant(owner, true)
  const useSessions = ((selector: (state: SessionListState) => unknown) => selector({
    ids: [],
    byId: {},
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } as SessionListState)) as never
  const renderSlot = ((key: string, _owner: object) => (
    key === 'shell.overlay'
      ? <div data-cordis-workspace={owner === 'cordis' || undefined} data-kira-teams={owner === 'subagent' || undefined} />
      : <div />
  )) as AppFrameProps['renderSlot']
  const props = {
    useStore: hookOf(instance),
    actions: instance.actions,
    useSessions,
    renderSlot,
  } as unknown as AppFrameProps
  const utils = render(<AppFrame {...props} />)
  return { instance, frame: utils.container.firstElementChild as HTMLElement, ...utils }
}

beforeEach(() => {
  window.innerWidth = 1920
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AppFrame visual workspace', () => {
  it('minimizes navigation for Cordis while keeping the ordinary details column closed, then restores the shell exactly', () => {
    const { instance, frame } = mountWith('cordis')

    expect(frame.style.gridTemplateColumns).toBe('56px minmax(0, 1fr) 0px')
    expect(frame.querySelector('[data-cordis-workspace]')).toBeTruthy()

    act(() => { instance.actions.setWorkspaceOccupant('cordis', false) })
    expect(frame.style.gridTemplateColumns).toBe('280px minmax(0, 1fr) 0px')
  })

  it('does not double-shrink the shell for the subagent card, which already reserves in-flow width', () => {
    const { frame } = mountWith('subagent')
    expect(frame.style.gridTemplateColumns).toBe('280px minmax(0, 1fr) 0px')
    expect(frame.querySelector('[data-kira-teams]')).toBeTruthy()
  })
})
