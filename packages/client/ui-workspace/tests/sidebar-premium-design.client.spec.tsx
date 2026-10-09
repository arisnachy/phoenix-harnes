// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@phoenix-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@phoenix-ai/dsh-client-locale/src/locales/zh.ts'
import type { WorkspaceId } from '@phoenix-ai/dsh-client-runtime/client'
import { ProjectRowItem } from '../src/client/Rows.tsx'
import type { GroupNode } from '../src/client/tree.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(zh, commonZh) as never

describe('approved Phoenix sidebar visual contract', () => {
  it('shows the real session count even when a workspace is folded', () => {
    const group: GroupNode = {
      key: 'project', workspaceId: 'project' as WorkspaceId,
      cwd: '/projects/project', createdAt: 0,
      label: 'Project', sessionCount: 7,
      expanded: false, containsCurrent: true, sessions: [],
    }
    const onToggle = vi.fn()
    const onCreate = vi.fn()
    render(<ProjectRowItem group={group} onToggle={onToggle} onCreate={onCreate} t={t} />)
    expect(screen.getByText('7 个会话')).toBeTruthy()
    expect(screen.getByText('P')).toBeTruthy()
    expect(screen.getByRole('treeitem').getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByText('Project'))
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onCreate).not.toHaveBeenCalled()
  })
})
