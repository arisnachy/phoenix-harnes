// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { TeamMentionDock } from '../src/client/TeamMentionDock.tsx'

afterEach(cleanup)
const View = TeamMentionDock as unknown as ComponentType<Record<string, unknown>>

const participants = {
  argo: { id: 'argo', name: 'Argo', role: 'Verificación', status: 'running', avatar: 'argo' },
  zenith: { id: 'zenith', name: 'Zenith', role: 'Código', status: 'idle', avatar: 'zenith' },
}

it('shows Kira plus only active teammates for a trailing @ token and inserts the real mention', () => {
  const setDraft = vi.fn()
  render(<View
    input={{ draft: '@' }}
    sessionId="root"
    useProjection={(key: string) => key === 'teamChatParticipants' ? participants : undefined}
    setDraft={setDraft}
    t={(key: string) => key}
  />)

  expect(screen.getByRole('option', { name: '@Kira' })).toBeTruthy()
  expect(screen.getByRole('option', { name: '@Argo' })).toBeTruthy()
  expect(screen.queryByRole('option', { name: '@Zenith' })).toBeNull()

  fireEvent.click(screen.getByRole('option', { name: '@Argo' }))
  expect(setDraft).toHaveBeenCalledWith('@Argo ')
})

it('filters by the typed mention prefix and stays hidden without a trailing mention', () => {
  const setDraft = vi.fn()
  const useProjection = (key: string) => key === 'teamChatParticipants' ? participants : undefined
  const view = render(<View input={{ draft: 'Revisa @ar' }} sessionId="root" useProjection={useProjection}
    setDraft={setDraft} t={(key: string) => key} />)

  expect(screen.getByRole('option', { name: '@Argo' })).toBeTruthy()
  expect(screen.queryByRole('option', { name: '@Kira' })).toBeNull()
  fireEvent.click(screen.getByRole('option', { name: '@Argo' }))
  expect(setDraft).toHaveBeenCalledWith('Revisa @Argo ')

  view.rerender(<View input={{ draft: 'Revisa esto' }} sessionId="root" useProjection={useProjection}
    setDraft={setDraft} t={(key: string) => key} />)
  expect(screen.queryByRole('listbox')).toBeNull()
})
