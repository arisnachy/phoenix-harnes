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
import { formatTeamMarkdown } from '../src/client/team-markdown.ts'

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
    expect(teamIdentityOf('aegis', 'reviewer')).toMatchObject({ name: 'Aegis', role: 'Calidad / revisión', kind: 'zenith' })
    expect(teamIdentityOf('gpt-6-luna', 'worker-c').name).not.toContain('GPT')

    const first = teamIdentityOf('worker-a', 'session-a')
    const resumed = teamIdentityOf('worker-a', 'session-b')
    expect(resumed).toEqual(first)
  })

  it('shows the human as a team collaborator without giving them an AI model identity', () => {
    const view = render(<View node={node({
      senderId: 'user', senderName: 'User', senderKind: 'user', targetId: 'worker-a',
      targetName: 'argo', content: [{ type: 'text', text: 'Argo, revisa esa evidencia.' }],
    })} />)
    expect(view.getByText('Team collaborator')).toBeTruthy()
    expect(view.getByText('Argo, revisa esa evidencia.')).toBeTruthy()
    expect(view.getByText('Para Argo')).toBeTruthy()
    expect(view.container.querySelector('[data-team-sender-kind="user"]')).toBeTruthy()
    expect(view.container.querySelector('[data-engine-model]')).toBeNull()
  })

  it('shows the actual teammate Luna badge next to the portrait, not the Lead Sol route', () => {
    const view = render(<View node={node({ senderId: 'worker-a', senderName: 'atlas',
      senderKind: 'agent' })} useProjection={() => ({
      'worker-a': { id: 'worker-a', name: 'Atlas', role: 'skill.engineering',
        avatar: 'atlas', status: 'working', modelProvider: 'openai-codex', model: 'gpt-6-luna' },
    })} />)
    const badge = view.container.querySelector('[data-engine-model="gpt-6-luna"]')
    expect(badge?.textContent).toContain('☾')
    expect(badge?.getAttribute('data-engine-family')).toBe('luna')
    expect(badge?.textContent).toContain('Luna')
    expect(badge?.closest('[data-avatar]')).toBeNull()
    expect(view.getByText('Atlas')).toBeTruthy()
    expect(view.container.querySelector('[data-engine-model="gpt-6.1-sol"]')).toBeNull()
  })

  it('shows Kira with her avatar when a real teammate delegation enters chat', () => {
    const view = render(<View node={node({
      senderId: 'root',
      senderName: 'lead',
      targetId: 'worker-a',
      targetName: 'la-forja',
      purpose: 'assignment',
      content: [{ type: 'text', text: 'Revisar el flujo de delegación.' }],
    })} useProjection={() => ({
      'worker-a': { id: 'worker-a', name: 'La Forja', avatar: 'atlas', role: 'skill.engineering', status: 'working' },
    })} />)

    expect(view.getByText('Kira')).toBeTruthy()
    expect(view.getByText('Coordinación')).toBeTruthy()
    expect(view.queryByText('Asignación')).toBeNull()
    expect(view.getByText('Para La Forja')).toBeTruthy()
    expect(view.container.querySelector('[data-avatar="kira"]')).toBeTruthy()
    expect(view.container.querySelector('[data-agent-portrait-image]')).toBeTruthy()
    expect(view.getByRole('status').textContent).toContain('trabajando')
    expect(view.container.querySelector('[data-team-target-status="working"]')).toBeTruthy()
  })

  it('keeps historical assignments honest when the real teammate is done or failed', () => {
    const assignment = node({
      senderId: 'root',
      senderName: 'lead',
      targetId: 'worker-a',
      targetName: 'argo',
      purpose: 'assignment',
      content: [{ type: 'text', text: 'Verificar el resultado.' }],
    })
    const done = render(<View node={assignment} useProjection={() => ({
      'worker-a': { id: 'worker-a', name: 'Argo', avatar: 'argo', role: 'skill.verification', status: 'done' },
    })} />)
    expect(done.queryByRole('status')).toBeNull()
    expect(done.container.querySelector('[data-team-target-status="done"]')).toBeNull()
    done.unmount()

    const failed = render(<View node={assignment} useProjection={() => ({
      'worker-a': { id: 'worker-a', name: 'Argo', avatar: 'argo', role: 'skill.verification', status: 'failed' },
    })} />)
    expect(failed.queryByRole('status')).toBeNull()
    expect(failed.container.querySelector('[data-team-target-status="failed"]')).toBeNull()
  })

  it('leaves all emoji reactions to the canonical animated message-actions tray', () => {
    const reactions: KiraTeamMessageChatData['reactions'] = [
      { reactorId: 'root', reactorName: 'lead', reaction: 'ack' },
      { reactorId: 'a', reactorName: 'la-forja', reaction: 'agree' },
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
    expect(view.getByText('Para Kira')).toBeTruthy()
    expect(view.getByText(/Necesito dirección/)).toBeTruthy()
    expect(view.queryByLabelText('Reacciones del equipo')).toBeNull()
  })

  it('never renders legacy Aegis activity counters as human team speech', () => {
    const stale = render(<View node={node({
      messageId: 'worker-a:activity:12', senderId: 'worker-a', senderKind: 'agent',
      senderName: 'aegis',
      content: [{ type: 'text',
        text: '**Actividad real** · 3 respuesta(s) sin error, 0 error(es). Última herramienta: mcp__phoenix_browser__navigate.' }],
    })} />)
    expect(stale.container.firstChild).toBeNull()
    stale.unmount()
    const real = render(<View node={node({
      messageId: 'worker-a:review:13', senderId: 'worker-a', senderKind: 'agent',
      senderName: 'aegis',
      content: [{ type: 'text', text: 'Revisé la página y está funcionando bien.' }],
    })} />)
    expect(real.getByText('Revisé la página y está funcionando bien.')).toBeTruthy()
  })

  it('keeps ordinary updates visually quiet and omits empty synthetic rows', () => {
    const update = render(<View node={node({
      purpose: 'update',
      reactions: [],
    })} />)
    expect(update.queryByText('Actualización')).toBeNull()
    expect(update.queryByText(/^Para /)).toBeNull()
    update.unmount()

    const empty = render(<View node={node({
      content: [null, [], { type: 'image' }, { type: 'text', text: '' }],
    })} />)
    expect(empty.container.firstChild).toBeNull()
  })

  it.each([
    ['question', 'Pregunta'],
    ['review', 'Revisión'],
    ['decision', 'Decisión'],
  ] as const)('labels consequential %s messages', (purpose, label) => {
    const view = render(<View node={node({ purpose })} />)
    expect(view.getByText(label)).toBeTruthy()
  })
  it('shows ordinary Kira-to-Astra and Astra-to-Kira turns without administrative labels', () => {
    const assignment = render(<View node={node({
      senderId: 'root', senderName: 'lead', senderKind: 'kira',
      targetId: 'astra', targetName: 'astra', purpose: 'assignment',
      content: [{ type: 'text', text: 'Astra, busca el titular y confirma el enlace.' }],
    })} />)
    expect(assignment.getByText('Kira')).toBeTruthy()
    expect(assignment.getByText('Para Astra')).toBeTruthy()
    expect(assignment.queryByText('Asignación')).toBeNull()
    assignment.unmount()
    const answer = render(<View node={node({
      senderId: 'astra', senderName: 'astra', senderKind: 'agent',
      targetId: 'root', targetName: 'Kira', purpose: 'result',
      content: [{ type: 'text', text: 'Kira, aquí tienes el titular y su enlace verificado.' }],
    })} />)
    expect(answer.getByText('Astra')).toBeTruthy()
    expect(answer.getByText('Para Kira')).toBeTruthy()
    expect(answer.queryByText('Resultado')).toBeNull()
  })

  it('uses the persisted participant identity for a real peer coordination message', () => {
    const view = render(<View node={node({ senderName: 'review-worker', targetId: 'worker-b', targetName: 'verify-worker' })}
      useProjection={() => ({
        'worker-a': { id: 'worker-a', name: 'Zenith', avatar: 'zenith', role: 'skill.quality', status: 'working' },
        'worker-b': { id: 'worker-b', name: 'Argo', avatar: 'argo', role: 'skill.verification', status: 'working' },
      })} />)
    expect(view.getByText('Zenith')).toBeTruthy()
    expect(view.getByText('Para Argo')).toBeTruthy()
    expect(view.container.querySelector('[data-avatar="zenith"]')).toBeTruthy()
  })

  it('recovers an inline review matrix as a semantic GFM table for Kira', () => {
    const flattened = 'Argo: Matriz final de la revisión: | Criterio | Resultado | Evidencia / límite | |---|---|---| | Seguridad | OK | Tests unitarios | | Cobertura | Pendiente | Prueba real |'
    const source = formatTeamMarkdown(flattened)
    expect(source).toBe('Argo: Matriz final de la revisión:\\n\\n| Criterio | Resultado | Evidencia / límite |\\n|---|---|---|\\n| Seguridad | OK | Tests unitarios |\\n| Cobertura | Pendiente | Prueba real |'.replaceAll('\\n', '\n'))
    const view = render(<View node={node({
      senderId: 'root', senderName: 'Kira', senderKind: 'kira',
      targetName: 'argo', purpose: 'review', content: [{ type: 'text', text: flattened }],
    })} />)
    const table = view.container.querySelector('table')
    expect(table).not.toBeNull()
    expect([...table!.querySelectorAll('th')].map(cell => cell.textContent))
      .toEqual(['Criterio', 'Resultado', 'Evidencia / límite'])
    expect(table!.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(view.getByText('Argo: Matriz final de la revisión:')).toBeTruthy()
    expect(view.getByText('Kira')).toBeTruthy()
    expect(view.getByText('Para Argo')).toBeTruthy()
  })

  it('recovers the recipient of actual peer-to-lead speech from mission metadata', () => {
    const view = render(<View node={node({
      senderId: 'worker-a', senderName: 'lyra', senderKind: 'agent',
      missionId: 'root', targetId: 'root',
      content: [{ type: 'text', text: 'Kira, encontré las diferencias en origin/main.' }],
    })} />)
    expect(view.getByText('Para Kira')).toBeTruthy()
    expect(view.container.querySelector('[data-team-audience="team"]')).toBeTruthy()
    expect(view.getByText('Kira, encontré las diferencias en origin/main.')).toBeTruthy()
  })

  it('does not invent a destination when durable metadata is missing', () => {
    const view = render(<View node={node({
      senderId: 'worker-a', senderName: 'lyra', senderKind: 'agent',
      missionId: undefined, targetId: 'root',
      content: [{ type: 'text', text: 'Ya lo revisé.' }],
    })} />)
    expect(view.container.querySelector('[data-team-audience="unknown"]')).toBeTruthy()
    expect(view.queryByText('Para Kira')).toBeNull()
  })

  it('renders Markdown for teammate answers and quoted messages with safe links', () => {
    const md = [
      '## Resultado de Argo',
      '',
      '- **Seguridad:** aprobada',
      '- [Evidencia](https://example.org/evidence)',
      '',
      '> Revisar antes de publicar.',
      '',
      '```ts',
      'const value = 1',
      '```',
    ].join('\n')
    const view = render(<View node={node({
      senderName: 'argo', senderKind: 'agent', purpose: 'result',
      replyQuote: '**Texto original**',
      content: [{ type: 'text', text: md }],
    })} />)
    expect(view.getByRole('heading', { name: 'Resultado de Argo' })).toBeTruthy()
    expect(view.getByText('Seguridad:').tagName).toBe('STRONG')
    expect(view.getByRole('link', { name: 'Evidencia' }).getAttribute('href')).toBe('https://example.org/evidence')
    expect(view.container.querySelector('blockquote strong')?.textContent).toBe('Texto original')
    expect(view.container.querySelector('pre code')?.textContent).toContain('const value = 1')
    expect(view.container.querySelector('script')).toBeNull()
  })

  it('does not manufacture tables from prose, escaped pipes, or fenced examples', () => {
    const ordinary = 'Plan A | Plan B | Plan C — sin tabla.'
    const fence = ['```md', '| A | B | |---|---| | X | Y |', '```'].join('\n')
    expect(formatTeamMarkdown(ordinary)).toBe(ordinary)
    expect(formatTeamMarkdown(fence)).toBe(fence)
    const correct = ['| A | B |', '| --- | --- |', '| X | Y |'].join('\n')
    expect(formatTeamMarkdown(correct)).toBe(correct)
    const view = render(<View node={node({
      content: [{ type: 'text', text: ordinary + '\n\n' + fence }],
    })} />)
    expect(view.container.querySelector('table')).toBeNull()
    expect(view.container.querySelector('pre code')?.textContent).toContain('|---|---|')
  })

})
