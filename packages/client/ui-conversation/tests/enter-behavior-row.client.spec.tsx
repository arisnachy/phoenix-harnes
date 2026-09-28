// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@phoenix-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@phoenix-ai/dsh-client-runtime/client'
import { makeTranslate } from '@phoenix-ai/dsh-client-test-runtime'
import { EnterBehaviorRow } from '../src/client/settings/EnterBehaviorRow.tsx'
import type { EnterBehaviorRowProps } from '../src/client/settings/EnterBehaviorRow.tsx'
import { ComposerSubmissionPolicy } from '../src/client/input/submission-policy.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  }))
}

function mount() {
  const policy = new ComposerSubmissionPolicy()
  const setBusyEnter = vi.fn((behavior: 'queue' | 'steer') => { policy.setBusyEnter(behavior) })
  const props: EnterBehaviorRowProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useBusyEnter: bindSnapshotSelector(policy.busyEnter),
    setBusyEnter,
    t: makeTranslate(en),
  }
  render(<EnterBehaviorRow {...props} />)
  return { policy, setBusyEnter }
}

describe('EnterBehaviorRow', () => {
  it('explains the busy-only scope and shows Steer by default', () => {
    mount()
    expect(screen.getByText('Enter behavior while busy')).toBeDefined()
    expect(screen.getByText('Busy only; Cmd/Ctrl+Enter uses the other behavior')).toBeDefined()
    expect(screen.getByRole('button', { name: /Steer/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('selects Queue, follows later preference changes, and closes outside', () => {
    const b = mount()
    const trigger = screen.getByRole('button', { name: /Steer/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Queue' }))
    expect(b.setBusyEnter).toHaveBeenCalledWith('queue')
    expect(screen.getByRole('button', { name: /Queue/ })).toBeDefined()

    act(() => { b.policy.setBusyEnter('steer') })
    const steerTrigger = screen.getByRole('button', { name: /Steer/ })
    fireEvent.click(steerTrigger)
    expect(screen.getByRole('menuitem', { name: 'Queue' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Queue' })).toBeNull()
  })
})
