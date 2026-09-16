import { describe, expect, it } from 'vitest'
import {
  GenerativeUi,
  parseGenerativeUiBlock,
  splitGenerativeUiText,
  type GenerativeUiBlock,
} from '../src/client/chat/GenerativeUi.tsx'

describe('conversation generative UI', () => {
  it('accepts a typed event card and rejects executable or unknown props', () => {
    const event = {
      component: 'event_card',
      version: 1,
      props: {
        title: 'Copa Campeones · Final',
        subtitle: 'Nu Stadium · Miami',
        badge: 'Hoy',
        left: { label: 'Inter Miami', symbol: 'MIA' },
        center: { eyebrow: 'Inicio', value: '8:00 p. m.' },
        right: { label: 'Cruz Azul', symbol: 'CAZ' },
      },
    }

    expect(parseGenerativeUiBlock(event)).toEqual(event)
    expect(parseGenerativeUiBlock({
      ...event,
      props: { ...event.props, href: 'javascript:alert(1)' },
    })).toBeNull()
  })

  it('turns a completed generative-ui fence into an inline UI segment', () => {
    const text = [
      'Este es el evento principal.\n\n',
      '```generative-ui',
      JSON.stringify({
        component: 'smart_card',
        version: 1,
        props: {
          title: 'Phoenix',
          badge: 'Activo',
          description: 'Vista compacta y contextual.',
          fields: [{ label: 'Modo', value: 'Chat' }],
        },
      }),
      '```',
      '\n\nPuedes pedirme más detalles.',
    ].join('\n')

    const segments = splitGenerativeUiText(text)
    expect(segments.map(segment => segment.kind)).toEqual(['markdown', 'ui', 'markdown'])
    expect(segments[1]).toMatchObject({ kind: 'ui', block: { component: 'smart_card' } })
  })

  it('hides an unfinished generative-ui fence while the answer is streaming', () => {
    const partial = 'Respuesta visible.\n\n```generative-ui\n{"component":"smart_card"'
    expect(splitGenerativeUiText(partial, { streaming: true })).toEqual([
      { kind: 'markdown', text: 'Respuesta visible.\n\n' },
    ])
  })

  it('keeps malformed completed fences as ordinary markdown instead of executing them', () => {
    const malformed = '```generative-ui\n{"component":"smart_card","version":1,"props":{"title":"X","onclick":"evil"}}\n```'
    expect(splitGenerativeUiText(malformed)).toEqual([{ kind: 'markdown', text: malformed }])
  })

  it('renders validated cards with a stable component marker', () => {
    const block: GenerativeUiBlock = {
      component: 'metric_card',
      version: 1,
      props: {
        title: 'Estado',
        items: [
          { label: 'Pruebas', value: '24/24', status: 'positive' },
          { label: 'Build', value: 'OK', status: 'positive' },
        ],
      },
    }
    const view = GenerativeUi({ block }) as { props: Record<string, unknown> }
    expect(view.props['data-generative-ui']).toBe('metric_card')
  })
})
