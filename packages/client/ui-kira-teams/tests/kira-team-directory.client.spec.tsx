// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@phoenix-ai/dsh-client-runtime/client'
import { KiraTeamsDock, type KiraTeamsDockProps } from '../src/client/KiraTeamsDock.tsx'

afterEach(cleanup)

describe('Kira team directory', () => {
  it('opens from sidebar and shows 21 biographies without fake active work', () => {
    const state = { byId: {} } as SessionListState
    const props = {
      useList: (select: (value: SessionListState) => unknown) => select(state),
      layout: { setWorkspaceOccupant: vi.fn() },
      openChild: vi.fn(),
      refresh: vi.fn(),
      t: (key: string) => key,
    } as unknown as KiraTeamsDockProps
    const { container, getByRole } = render(<KiraTeamsDock {...props} />)
    expect(container.querySelector('[data-kira-team-directory]')).toBeNull()
    act(() => { window.dispatchEvent(new Event('phoenix:toggle-team-directory')) })
    expect(container.querySelectorAll('[data-kira-team-directory] [data-selected]')).toHaveLength(21)
    expect(container.textContent).toContain('Equipo de Kira')
    fireEvent.click(getByRole('button', { name: /Vega:/u }))
    expect(container.querySelector('[data-team-profile="vega"]')?.textContent).toContain('interfaces')
    fireEvent.click(getByRole('button', { name: 'Cerrar equipo' }))
    expect(container.querySelector('[data-kira-team-directory]')).toBeNull()
  })
})
