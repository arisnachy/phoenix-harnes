// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { TeamMessageActions } from '../src/client/TeamMessageActions.tsx'
import type { TeamChatReaction } from '@phoenix-ai/dsh-agent-team/chat-types'
afterEach(cleanup)
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
  const chip = screen.getByRole('button', { name: '👩🏽‍💻 3' })
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
  fireEvent.click(screen.getByRole('button', { name: 'chat.addReaction' }))
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
