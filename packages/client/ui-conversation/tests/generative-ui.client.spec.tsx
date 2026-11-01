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

  it('renders an interactive final explanation after prose without leaking JSON', () => {
    const ui = {
      component: 'ui_canvas',
      version: 1,
      props: {
        title: 'Resultado de Phoenix',
        subtitle: 'Evidencia verificada',
        children: [
          { type: 'group', layout: 'grid', children: [
            { type: 'metric', label: 'Pruebas', value: '12/12', status: 'positive' },
            { type: 'metric', label: 'Errores', value: '0', status: 'positive' },
          ] },
          { type: 'tabs', tabs: [
            { label: 'Evidencia', children: [
              { type: 'chart', title: 'Tareas verificadas', points: [
                { label: 'Build', value: 1 }, { label: 'Smoke', value: 1 },
              ] },
            ] },
            { label: 'Acciones', children: [
              { type: 'input', id: 'consulta', label: 'Consulta' },
              { type: 'button', label: 'Consultar', prompt: 'Verifica {consulta}', action: 'draft' },
            ] },
          ] },
        ],
      },
    }
    expect(parseGenerativeUiBlock(ui)).not.toBeNull()
    const answer = ['La compilación terminó. Las pruebas anteriores son una muestra.',
      '```generative-ui', JSON.stringify(ui), '```', 'Puedes consultar más detalles.'].join('\n')
    const segments = splitGenerativeUiText(answer)
    expect(segments.map(segment => segment.kind)).toEqual(['markdown', 'ui', 'markdown'])
    expect(segments[0]).toMatchObject({ kind: 'markdown', text: expect.stringContaining('compilación') })
    expect(segments[2]).toMatchObject({ kind: 'markdown', text: expect.stringContaining('consultar') })
  })

  it('rejects a final interactive canvas with script or unauthorized event handlers', () => {
    expect(parseGenerativeUiBlock({
      component: 'ui_canvas',
      version: 1,
      props: { title: 'Estado', children: [
        { type: 'button', label: 'Ejecutar', prompt: 'Continúa', onclick: 'runExternalCode()' },
      ] },
    })).toBeNull()
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
  it('renders validated in-chat sports cards and rejects unsafe remote images', () => {
    const sportsGame = {
      component: 'sports_game_card', version: 1,
      props: { title: 'MLB hoy', when: '24 oct 2026 · 4:00 p. m.', venue: 'Chase Field',
        status:'Scheduled',source:'MLB Stats · 2026-10-24',
        home:{ label:'Local',logo:'https://a.espncdn.com/i/teamlogos/mlb/500/nyy.png' },
        away:{ label:'Visitante' },highlights:[{ label:'Lanzador',value:'No confirmado' }],
        askPrompt:'Kira, amplía este partido.' },
    }
    expect(parseGenerativeUiBlock(sportsGame)).toEqual(sportsGame)
    expect(parseGenerativeUiBlock({
      ...sportsGame,props:{ ...sportsGame.props,home:{ label:'Local',logo:'https://evil.example/pixel.png' } },
    })).toBeNull()
    const ticket = { component:'sports_ticket_card',version:1,props:{
      title:'Ticket de análisis',source:'The Odds API',note:'Sin apuesta real.',
      legs:[{ event:'A vs B',selection:'A',price:'1.90',bookmaker:'Casa' }],
      combinedOdds:'1.90',grossReturn:'190.00',
    } }
    expect(parseGenerativeUiBlock(ticket)).toEqual(ticket)
    const answer = ['Partidos verificados.', '\`\`\`generative-ui', JSON.stringify(sportsGame), '\`\`\`'].join('\n')
    expect(splitGenerativeUiText(answer).some(s => s.kind === 'ui' && s.block.component === 'sports_game_card')).toBe(true)
    const view = GenerativeUi({ block: ticket as GenerativeUiBlock }) as { props:Record<string,unknown> }
    expect(view.props['data-generative-ui']).toBe('sports_ticket_card')
  })

})
