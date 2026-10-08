// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_TEAM_DESIGN, DEFAULT_TEAM_DESIGN_JSON } from '@phoenix-ai/dsh-agent-team/design-types'
import { TeamMentionDock } from '../src/client/TeamMentionDock.tsx'

afterEach(cleanup)
const View = TeamMentionDock as unknown as ComponentType<Record<string, unknown>>
const baseSnapshot = { value: { document: DEFAULT_TEAM_DESIGN_JSON } }
const useTeamDesign = (selector: (value: typeof baseSnapshot) => unknown): unknown => selector(baseSnapshot)

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
    useTeamDesign={useTeamDesign}
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
    setDraft={setDraft} useTeamDesign={useTeamDesign} t={(key: string) => key} />)

  expect(screen.getByRole('option', { name: '@Argo' })).toBeTruthy()
  expect(screen.queryByRole('option', { name: '@Kira' })).toBeNull()
  fireEvent.click(screen.getByRole('option', { name: '@Argo' }))
  expect(setDraft).toHaveBeenCalledWith('Revisa @Argo ')

  view.rerender(<View input={{ draft: 'Revisa esto' }} sessionId="root" useProjection={useProjection}
    setDraft={setDraft} t={(key: string) => key} />)
  expect(screen.queryByRole('listbox')).toBeNull()
})

it('uses customized Lead and specialist names for @mentions without changing runtime ids', () => {
  const setDraft = vi.fn()
  const custom = {
    version: 1 as const,
    activeTeamId: DEFAULT_TEAM_DESIGN.id,
    teams: [{
      ...DEFAULT_TEAM_DESIGN,
      lead: { ...DEFAULT_TEAM_DESIGN.lead, displayName: 'Atenea' },
      members: DEFAULT_TEAM_DESIGN.members.map(member => member.id === 'argo'
        ? { ...member, displayName: 'Inspector' }
        : member),
    }],
  }
  const snapshot = { value: { document: JSON.stringify(custom) } }
  const useCustomDesign = (selector: (value: typeof snapshot) => unknown): unknown => selector(snapshot)
  render(<View
    input={{ draft: '@' }}
    sessionId="root"
    useProjection={(key: string) => key === 'teamChatParticipants' ? participants : undefined}
    useTeamDesign={useCustomDesign}
    setDraft={setDraft}
    t={(key: string) => key}
  />)
  expect(screen.getByRole('option', { name: '@Atenea' })).toBeTruthy()
  expect(screen.getByRole('option', { name: '@Inspector' })).toBeTruthy()
  expect(screen.queryByRole('option', { name: '@Kira' })).toBeNull()
  expect(screen.queryByRole('option', { name: '@Argo' })).toBeNull()
  fireEvent.click(screen.getByRole('option', { name: '@Inspector' }))
  expect(setDraft).toHaveBeenCalledWith('@Inspector ')
})
