// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_TEAM_DESIGN_JSON } from '@phoenix-ai/dsh-agent-team/design-types'
import { TeamAuthor } from '../src/client/TeamAuthor.tsx'
import { portraitSrcForKind } from '../src/client/ModelActivityAvatar.tsx'

afterEach(cleanup)
const t = () => 'Coordination / orchestration'
const designSnapshot = {
  status: 'ready',
  value: { document: DEFAULT_TEAM_DESIGN_JSON },
  base: { document: DEFAULT_TEAM_DESIGN_JSON },
  user: {},
  revision: 1,
  writable: true,
  mode: 'host',
} as const
const useTeamDesign: Parameters<typeof TeamAuthor>[0]['useTeamDesign'] = selector => selector(designSnapshot)

describe('Kira actual model badge', () => {
  it.each([
    ['gpt-6-sol', '☀'], ['gpt-6-luna', '☾'], ['gpt-6-astra', '★'], ['deepseek-v4-flash', 'ϟ'],
  ])('shows %s beside the unchanged Kira portrait', (model, icon) => {
    const { container } = render(<TeamAuthor t={t} useTeamDesign={useTeamDesign} provenance={{ provider: 'openai-codex', model }} />)
    const badge = screen.getByLabelText(`openai-codex · ${model}`)
    expect(badge.textContent).toBe(icon)
    expect(container.querySelector('[data-agent-portrait-image]')?.getAttribute('src')).toBe(portraitSrcForKind('kira'))
  })
  it.each(['gpt-6-sol', 'gpt-6-luna', 'gpt-6-astra'])('keeps a non-Codex %s in the other-provider family', (model) => {
    render(<TeamAuthor t={t} useTeamDesign={useTeamDesign} provenance={{ provider: 'custom-provider', model }} />)
    expect(screen.getByLabelText(`custom-provider · ${model}`).textContent).toBe('ϟ')
  })
  it('does not invent a model for output without provenance', () => {
    const { container, rerender } = render(<TeamAuthor t={t} useTeamDesign={useTeamDesign} />)
    expect(container.querySelector('[data-kira-model]')).toBeNull()
    rerender(<TeamAuthor t={t} useTeamDesign={useTeamDesign} provenance={{ provider: 'openai', model: 'gpt-6-luna' }} />)
    expect(screen.getByLabelText('openai · gpt-6-luna')).toBeTruthy()
  })
})
