// @vitest-environment jsdom
/** AppFrame shell geometry while Cordis/KIRA occupy the in-flow visual rail. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { AppFrame } from '@phoenix-ai/dsh-client-ui-layout/src/client/AppFrame.tsx'
import type { AppFrameProps } from '@phoenix-ai/dsh-client-ui-layout/src/client/AppFrame.tsx'
import { createLayoutStore } from '@phoenix-ai/dsh-client-ui-layout/src/client/stores.ts'
import type { SessionListState } from '@phoenix-ai/dsh-client-runtime/client'

class ResizeObserverStub {
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
  } as unknown as SessionListState)) as never
  const renderSlot = ((key: string, _owner: object) => {
    if (key === 'shell.workspace') {
      return <div data-cordis-workspace={owner === 'cordis' || undefined} data-kira-teams={owner === 'subagent' || undefined} />
    }
    if (key === 'shell.overlay') return <div data-test-overlay />
    return <div data-test-slot={key} />
  }) as AppFrameProps['renderSlot']
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
  it('mounts Cordis in the in-flow workspace rail, never in shell.overlay, and restores shell geometry', () => {
    const { instance, frame } = mountWith('cordis')

    expect(frame.style.gridTemplateColumns).toBe('56px minmax(0, 1fr) 0px')
    const workspace = frame.querySelector('[data-shell-workspace]')
    const cordis = frame.querySelector('[data-cordis-workspace]')
    const center = frame.querySelector('[data-workspace-cordis="true"]')
    expect(workspace).toBeTruthy()
    expect(cordis).toBeTruthy()
    expect(center).toBeTruthy()
    expect(workspace?.contains(cordis)).toBe(true)
    expect(frame.querySelector('[data-shell-overlay]')?.contains(cordis)).toBe(false)

    act(() => { instance.actions.setWorkspaceOccupant('cordis', false) })
    expect(frame.style.gridTemplateColumns).toBe('280px minmax(0, 1fr) 0px')
  })

  it('mounts the KIRA/subagent card in the same rail so Cordis can stack underneath it', () => {
    const { frame } = mountWith('subagent')
    const workspace = frame.querySelector('[data-shell-workspace]')
    const kira = frame.querySelector('[data-kira-teams]')
    const center = frame.querySelector('[data-workspace-subagent="true"]')
    expect(frame.style.gridTemplateColumns).toBe('280px minmax(0, 1fr) 0px')
    expect(center).toBeTruthy()
    expect(workspace?.contains(kira)).toBe(true)
  })
})
