// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AssistantMarkdown } from '../src/client/chat/AssistantMarkdown.tsx'
import type { ChatViewSlotProps } from '../src/client/contract/slots.ts'
import { GenerativeCanvas, parseCanvasSpec } from '../src/client/chat/GenerativeCanvas.tsx'
import { GenerativeUi, parseGenerativeUiBlock, splitGenerativeUiText } from '../src/client/chat/GenerativeUi.tsx'

afterEach(cleanup)

function sample() {
  return {
    component: 'ui_canvas', version: 1,
    props: {
      title: 'Diagnóstico de conectores',
      subtitle: 'Tarjeta integrada dentro de la conversación',
      children: [
        { type: 'group', layout: 'grid', children: [
          { type: 'metric', label: 'Conectados', value: '12' },
          { type: 'metric', label: 'Requieren OAuth', value: '3', status: 'warning' },
          { type: 'metric', label: 'Con errores', value: '2', status: 'negative' },
        ] },
        { type: 'tabs', tabs: [
          { label: 'Resumen', children: [{ type: 'text', text: 'Kira puede mostrar información.' }] },
          { label: 'Datos', children: [{ type: 'table', columns: ['MCP','Estado'], rows: [['Notion','OAuth pendiente']] }] },
        ] },
        { type: 'input', id: 'connector', label: 'Conector', value: 'Notion' },
        { type: 'select', id: 'mode', label: 'Acción', options: [
          { label: 'Diagnosticar', value: 'diagnosticar' },
          { label: 'Reintentar', value: 'reintentar' },
        ] },
        { type: 'toggle', id: 'confirm', label: 'Incluir diagnóstico', value: true },
        { type: 'slider', id: 'attempts', label: 'Intentos', min: 1, max: 5, value: 2 },
        { type: 'button', label: 'Preparar tarea', prompt: '{mode} {connector} con {attempts} intentos. Diagnóstico: {confirm}', action: 'draft' },
        { type: 'button', label: 'Enviar a Kira', prompt: '{mode} {connector}', action: 'submit' },
      ],
    },
  }
}

describe('Phoenix intelligent UI canvas', () => {
  it('validates a fully composable and interactive canvas', () => {
    const value = sample()
    expect(parseCanvasSpec(value)).toEqual(value)
    expect(parseGenerativeUiBlock(value)).toEqual(value)
  })

  it('rejects code, arbitrary URLs, extra keys, duplicate ids and unbounded trees', () => {
    const value = sample()
    expect(parseCanvasSpec({ ...value, props: { ...value.props, onClick: 'evil' } })).toBeNull()
    expect(parseCanvasSpec({ ...value, props: { ...value.props, children: [{ type: 'text', text: '<b>x</b>', dangerouslySetInnerHTML: {} }] } })).toBeNull()
    expect(parseCanvasSpec({ ...value, props: { ...value.props, children: [{ type: 'button', label: 'Run', prompt: 'run', href: 'javascript:alert(1)' }] } })).toBeNull()
    expect(parseCanvasSpec({ ...value, props: { ...value.props, children: [
      { type: 'input', id: 'same', label: 'One' }, { type: 'input', id: 'same', label: 'Two' },
    ] } })).toBeNull()
    expect(parseCanvasSpec({ ...value, props: { ...value.props, children: Array.from({ length: 65 }, () => ({ type: 'text', text: 'many' })) } })).toBeNull()
  })

  it('renders a card without a separate sidebar and updates local controls without asking the model', () => {
    const spec = parseCanvasSpec(sample())
    if (spec === null) throw new Error('fixture is invalid')
    const onAction = vi.fn()
    const { container } = render(<GenerativeCanvas spec={spec} onAction={onAction} />)

    expect(container.querySelector('[data-generative-ui="ui_canvas"]')).not.toBeNull()
    expect(screen.getByText('Conectados')).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Datos' }))
    expect(screen.getByText('OAuth pendiente')).not.toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Conector' }), { target: { value: 'Supabase' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Acción' }), { target: { value: 'reintentar' } })
    fireEvent.change(screen.getByRole('slider', { name: /Intentos/ }), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preparar tarea' }))
    expect(onAction).toHaveBeenCalledWith('reintentar Supabase con 4 intentos. Diagnóstico: true', 'draft')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar a Kira' }))
    expect(onAction).toHaveBeenCalledWith('reintentar Supabase', 'submit')
  })

  it('disables actions when the composer is not available', () => {
    const spec = parseCanvasSpec(sample())
    if (spec === null) throw new Error('fixture is invalid')
    render(<GenerativeCanvas spec={spec} />)
    expect((screen.getByRole('button', { name: 'Enviar a Kira' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps surrounding assistant prose and hides unfinished fences while streaming', () => {
    const value = sample()
    const content = 'Estoy revisando los conectores.\n\n' +
      '```generative-ui\n' + JSON.stringify(value) + '\n```\n\n¿Qué revisamos después?'
    expect(splitGenerativeUiText(content).map(x => x.kind)).toEqual(['markdown','ui','markdown'])
    expect(splitGenerativeUiText(content.slice(0,content.indexOf('\n```',content.indexOf('generative-ui'))), { streaming:true })
      .some(x => x.kind === 'ui')).toBe(false)
  })

  it('mounts a complete canvas in the real assistant Markdown flow alongside ordinary prose', () => {
    const blockText = 'He revisado el estado.\\n\\n' + '```generative-ui\\n'
      + JSON.stringify(sample()) + '\\n```\\n\\nAquí tienes las opciones.'
    const handle = vi.fn()
    const { container } = render(<AssistantMarkdown
      blocks={[{ kind: 'text', text: blockText }]}
      streaming={false}
      renderMessageImages={() => null}
      t={((key: string) => key) as ChatViewSlotProps['t']}
      onUiAction={handle}
    />)
    expect(screen.getByText('He revisado el estado.')).not.toBeNull()
    expect(container.querySelector('[data-generative-ui="ui_canvas"]')).not.toBeNull()
    expect(screen.getByText('Aquí tienes las opciones.')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar a Kira' }))
    expect(handle).toHaveBeenCalledWith('diagnosticar Notion', 'submit')
  })

  it('renders the validated canvas through the existing assistant UI bridge', () => {
    const block = parseGenerativeUiBlock(sample())
    if (block === null) throw new Error('fixture is invalid')
    const { container } = render(<GenerativeUi block={block} />)
    expect(container.querySelector('[data-generative-ui="ui_canvas"]')).not.toBeNull()
  })
})
