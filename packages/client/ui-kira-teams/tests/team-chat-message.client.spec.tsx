// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { TeamChatParticipant } from '@phoenix-ai/dsh-agent-team/chat-types'
import type { ChatNode, KiraTeamMessageChatData } from '@phoenix-ai/dsh-client-ui-conversation/client'
import {
  KiraTeamMessageView,
  teamIdentityOf,
} from '../src/client/TeamChatMessage.tsx'

afterEach(cleanup)

const InjectedView = KiraTeamMessageView as unknown as ComponentType<{
  node: ChatNode<'kira-team-message'>
  useProjection: () => Record<string, TeamChatParticipant>
}>
const View = ({ node, useProjection = () => ({}) }: {
  node: ChatNode<'kira-team-message'>
  useProjection?: () => Record<string, TeamChatParticipant>
}) => <InjectedView node={node} useProjection={useProjection} />

function node(data: Partial<KiraTeamMessageChatData> = {}): ChatNode<'kira-team-message'> {
  return {
    key: 'team:k',
    kind: 'kira-team-message',
    id: 'message-1',
    target: 'chat',
    anchorSeq: 1,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data: {
      messageId: 'message-1',
      senderId: 'worker-a',
      senderName: 'la-forja',
      targetId: 'root',
      content: [{ type: 'text', text: 'Cambio listo.' }],
      time: 1,
      seq: 1,
      reactions: [],
      ...data,
    },
  }
}

describe('KIRA Team chat message', () => {
  it('resolves stable personas without exposing model ids', () => {
    expect(teamIdentityOf('lead', 'root')).toMatchObject({ name: 'Kira', role: 'Coordinación', kind: 'kira' })
    expect(teamIdentityOf('KÍRA', 'root')).toMatchObject({ name: 'Kira' })
    expect(teamIdentityOf('forja', 'worker-a')).toMatchObject({ name: 'La Forja', role: 'Programación' })
    expect(teamIdentityOf('la-forja', 'worker-a')).toMatchObject({ name: 'La Forja' })
    expect(teamIdentityOf('argo', 'worker-b')).toMatchObject({ name: 'Argo', role: 'Verificación' })
    expect(teamIdentityOf('gpt-6-luna', 'worker-c').name).not.toContain('GPT')

    const first = teamIdentityOf('worker-a', 'session-a')
    const resumed = teamIdentityOf('worker-a', 'session-b')
    expect(resumed).toEqual(first)
  })

  it('shows Kira with her avatar when a real teammate delegation enters chat', () => {
    const view = render(<View node={node({
      senderId: 'root',
      senderName: 'lead',
      targetId: 'worker-a',
      targetName: 'la-forja',
      purpose: 'assignment',
      content: [{ type: 'text', text: 'Revisar el flujo de delegación.' }],
    })} />)

    expect(view.getByText('Kira')).toBeTruthy()
    expect(view.getByText('Coordinación')).toBeTruthy()
    expect(view.getByText('Asignación')).toBeTruthy()
    expect(view.getByText('→ La Forja')).toBeTruthy()
    expect(view.container.querySelector('[data-avatar="kira"]')).toBeTruthy()
    expect(view.container.querySelector('[data-agent-portrait-image]')).toBeTruthy()
  })

  it('renders one real team bubble with recipient, purpose and compact reactions', () => {
    const reactions: KiraTeamMessageChatData['reactions'] = [
      { reactorId: 'root', reactorName: 'lead', reaction: 'ack' },
      { reactorId: 'a', reactorName: 'la-forja', reaction: 'agree' },
      { reactorId: 'b', reactorName: 'argo', reaction: 'insight' },
      { reactorId: 'c', reactorName: 'vigia', reaction: 'blocked' },
      { reactorId: 'd', reactorName: 'eclipse', reaction: 'done' },
    ]
    const view = render(<View node={node({
      targetName: 'lead',
      purpose: 'blocker',
      content: [
        null,
        [],
        'ignore-me',
        { type: 'image' },
        { type: 'text', text: 42 },
        { type: 'text', text: 'Necesito dirección.' },
        { type: 'text', text: 'Tengo evidencia.' },
      ],
      reactions,
    })} />)

    expect(view.getByText('La Forja')).toBeTruthy()
    expect(view.getByText('Programación')).toBeTruthy()
    expect(view.getByText('Bloqueo')).toBeTruthy()
    expect(view.getByText('→ Kira')).toBeTruthy()
    expect(view.getByText(/Necesito dirección/)).toBeTruthy()
    expect(view.getByLabelText('Reacciones del equipo').textContent).toContain('👍')
    expect(view.getByLabelText('Reacciones del equipo').textContent).toContain('✓')
    expect(view.getByLabelText('Reacciones del equipo').textContent).toContain('💡')
    expect(view.getByLabelText('Reacciones del equipo').textContent).toContain('⚠')
    expect(view.getByLabelText('Reacciones del equipo').textContent).toContain('✅')
  })

  it('keeps ordinary updates visually quiet and omits empty synthetic rows', () => {
    const update = render(<View node={node({
      purpose: 'update',
      reactions: [],
    })} />)
    expect(update.queryByText('Actualización')).toBeNull()
    expect(update.queryByText(/→/)).toBeNull()
    update.unmount()

    const empty = render(<View node={node({
      content: [null, [], { type: 'image' }, { type: 'text', text: '' }],
    })} />)
    expect(empty.container.firstChild).toBeNull()
  })

  it.each([
    ['assignment', 'Asignación'],
    ['question', 'Pregunta'],
    ['result', 'Resultado'],
    ['review', 'Revisión'],
    ['decision', 'Decisión'],
  ] as const)('labels consequential %s messages', (purpose, label) => {
    const view = render(<View node={node({ purpose })} />)
    expect(view.getByText(label)).toBeTruthy()
  })
  it('uses the persisted participant identity for a real peer coordination message', () => {
    const view = render(<View node={node({ senderName: 'review-worker', targetId: 'worker-b', targetName: 'verify-worker' })}
      useProjection={() => ({
        'worker-a': { id: 'worker-a', name: 'Zenith', avatar: 'zenith', role: 'skill.quality', status: 'working' },
        'worker-b': { id: 'worker-b', name: 'Argo', avatar: 'argo', role: 'skill.verification', status: 'working' },
      })} />)
    expect(view.getByText('Zenith')).toBeTruthy()
    expect(view.getByText('→ Argo')).toBeTruthy()
    expect(view.container.querySelector('[data-avatar="zenith"]')).toBeTruthy()
  })

})
