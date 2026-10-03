// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { TeamMessageActions } from '../src/client/TeamMessageActions.tsx'
import type { TeamChatReaction } from '@phoenix-ai/dsh-agent-team/chat-types'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const View = TeamMessageActions as unknown as ComponentType<Record<string, unknown>>
it('groups actual participants and removes only the user reaction from the selected message', async () => {
  const reactions: TeamChatReaction[] = ['user', 'kira', 'agent'].map((kind, index) => ({
    id: String(index), messageId: 'finding', reactorId: kind, reactorName: kind === 'agent' ? 'Zenith' : kind === 'kira' ? 'Kira' : 'User',
    reactorKind: kind as TeamChatReaction['reactorKind'], emoji: '👩🏽‍💻', createdAt: index,
  }))
  const react = vi.fn(async () => {})
  render(<View messageId="finding" authorId="agent" authorKind="agent" authorName="Zenith" replyPreview="Finding"
    useProjection={(key: string) => key === 'teamChatReactions' ? { finding: reactions } : { agent: { id: 'agent', name: 'Zenith', avatar: 'zenith' } }}
    react={react} reply={vi.fn()} t={(key: string) => key} />)
  const chip = screen.getByRole('button', { name: '👩🏽‍💻 · User, Kira, Zenith' })
  expect(chip.getAttribute('title')).toBe('User, Kira, Zenith')
  expect(chip.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(chip)
  await vi.waitFor(() => { expect(react).toHaveBeenCalledWith('finding', '👩🏽‍💻', false) })
})
it('uses the same message identity for a quoted reply and Unicode quick reactions', async () => {
  const reply = vi.fn()
  const react = vi.fn(async () => {})
  render(<View messageId="finding" authorId="worker" authorKind="agent" authorName="Zenith" replyPreview="Verified evidence"
    useProjection={() => undefined} react={react} reply={reply} t={(key: string) => key} />)
  fireEvent.click(screen.getByRole('button', { name: 'chat.reply' }))
  expect(reply).toHaveBeenCalledWith('finding', 'worker', 'Zenith', 'Verified evidence')
  const addReaction = screen.getByRole('button', { name: 'chat.addReaction' })
  expect(addReaction.textContent).toBe('')
  expect(addReaction.querySelector('svg')).not.toBeNull()
  fireEvent.click(addReaction)
  fireEvent.click(screen.getByRole('button', { name: '❤️' }))
  await vi.waitFor(() => { expect(react).toHaveBeenCalledWith('finding', '❤️', true) })
})

it('keeps inherited team messages readable without exposing actions for another mission', () => {
  const react = vi.fn()
  const reply = vi.fn()
  render(<View sessionId="fork-root" originMissionId="original-root" messageId="team-member:original-child"
    authorId="original-root" authorKind="kira" useProjection={() => undefined} react={react} reply={reply} t={(key: string) => key} />)
  const action = screen.getByRole('button', { name: 'chat.addReaction' })
  expect(action.hasAttribute('disabled')).toBe(true)
  fireEvent.click(action)
  expect(react).not.toHaveBeenCalled()
})

it('pulses only a newly received real reaction and respects reduced motion', () => {
  const first: TeamChatReaction = { id: 'kira-like', messageId: 'human-message', reactorId: 'kira', reactorName: 'Kira',
    reactorKind: 'kira', emoji: '👍', createdAt: 1 }
  const incoming: TeamChatReaction = { ...first, id: 'argo-like', reactorId: 'argo', reactorName: 'Argo', reactorKind: 'agent' }
  const projection = (reactions: TeamChatReaction[]) => (key: string) => key === 'teamChatReactions' ? { 'human-message': reactions } : {}
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const props = { messageId: 'human-message', authorId: 'user', authorKind: 'user', react: vi.fn(), reply: vi.fn(), t: (key: string) => key }
  const view = render(<View {...props} useProjection={projection([first])} />)
  const button = screen.getByRole('button', { name: '👍 · Kira' })
  const animate = vi.fn()
  button.animate = animate
  view.rerender(<View {...props} useProjection={projection([first])} />)
  expect(animate).not.toHaveBeenCalled()
  view.rerender(<View {...props} useProjection={projection([first, incoming])} />)
  expect(animate).toHaveBeenCalledTimes(1)
  view.rerender(<View {...props} useProjection={projection([first, incoming])} />)
  expect(animate).toHaveBeenCalledTimes(1)
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  view.rerender(<View {...props} useProjection={projection([first, incoming, { ...incoming, id: 'another-real-reaction' }])} />)
  expect(animate).toHaveBeenCalledTimes(1)
  vi.unstubAllGlobals()
})
