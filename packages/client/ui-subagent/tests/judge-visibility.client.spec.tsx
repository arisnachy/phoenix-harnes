// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@phoenix-ai/dsh-client-test-runtime'
import type {
  SessionId, SessionListState, SessionSummary, SubagentCatalogSnapshot,
} from '@phoenix-ai/dsh-client-runtime/client'
import {
  SubagentHeaderLineage, type SubagentHeaderLineageProps,
} from '../src/client/SubagentHeaderLineage.tsx'
import { zh } from '../src/client/locales.ts'

const PARENT = 'judge-parent' as SessionId
const OLD_JUDGE = 'judge-old' as SessionId
const ACTIVE_JUDGE = 'judge-active' as SessionId
const t: SubagentHeaderLineageProps['t'] = makeTranslate(zh)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function summary(id: SessionId, title: string, running: boolean): SessionSummary {
  return {
    id,
    title,
    displayTitle: title,
    parentId: PARENT,
    origin: 'subagent',
    running,
    blank: false,
    updatedAt: Date.now(),
  }
}

function props(entries: SubagentCatalogSnapshot['entries']): SubagentHeaderLineageProps {
  const catalog: SubagentCatalogSnapshot = {
    entries,
    parentAvailable: true,
    state: 'ready',
    error: null,
  }
  const state: SessionListState = {
    ids: [OLD_JUDGE, ACTIVE_JUDGE],
    byId: {
      [OLD_JUDGE]: summary(OLD_JUDGE, 'finished judge', false),
      [ACTIVE_JUDGE]: summary(ACTIVE_JUDGE, 'current judge', true),
    },
    current: PARENT,
    phase: 'ready',
    subagentsByParent: { [PARENT]: catalog },
    jobsBySession: {},
    currentAddress: undefined,
  }
  return {
    sessionId: PARENT,
    lineageSessionId: PARENT,
    displayTitle: 'Parent',
    useSessions: select => select(state),
    openChild: vi.fn(),
    refresh: vi.fn(),
    setCatalogOpen: vi.fn(),
    t,
  } as unknown as SubagentHeaderLineageProps
}

function openCatalog(trigger: HTMLElement): void {
  const root = trigger.parentElement
  if (root === null) throw new Error('missing lineage root')
  vi.useFakeTimers()
  fireEvent.mouseEnter(root)
  act(() => { vi.advanceTimersByTime(150) })
}

describe('goal judge lineage visibility', () => {
  it('keeps only the currently running goal judge in the visual row and count', () => {
    render(<SubagentHeaderLineage {...props([
      {
        kind: 'child', id: OLD_JUDGE, mode: 'one-shot', label: 'goal-completion-judge',
        activity: 'inactive', hasChildren: false,
      },
      {
        kind: 'child', id: ACTIVE_JUDGE, mode: 'one-shot', label: 'goal-completion-judge',
        activity: 'running', hasChildren: false,
      },
    ])} />)

    const trigger = screen.getByRole('button', { name: '1 个子代理，正在运行' })
    expect(trigger.textContent).toContain('1 个子代理')
    expect(trigger.textContent).not.toContain('2 个子代理')

    openCatalog(trigger)
    expect(screen.getByText(/current judge/)).toBeTruthy()
    expect(screen.queryByText(/finished judge/)).toBeNull()
  })

  it('removes the judge visual entirely after the only judge settles', () => {
    render(<SubagentHeaderLineage {...props([
      {
        kind: 'child', id: OLD_JUDGE, mode: 'one-shot', label: 'goal-completion-judge',
        activity: 'inactive', hasChildren: false,
      },
    ])} />)

    expect(screen.queryByRole('button', { name: /子代理/ })).toBeNull()
  })
})
