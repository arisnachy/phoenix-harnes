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
    const blockText = 'He revisado el estado.\n\n' + '```generative-ui\n'
      + JSON.stringify(sample()) + '\n```\n\nAquí tienes las opciones.'
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

  it('accepts real-world text-only select options and preserves safe validation', () => {
    const data = sample()
    const select = { type: 'select', id: 'mcp-status', label: 'Estado', value: 'Todos',
      options: ['Todos', 'Listo', 'Requiere autorización', 'Fallido'] }
    const block = parseCanvasSpec({ ...data, props: { ...data.props, children: [select] } })
    if (block === null) throw new Error('select shorthand rejected')
    expect(block.props.children[0]).toMatchObject({ options: [
      { label: 'Todos', value: 'Todos' }, { label: 'Listo', value: 'Listo' },
      { label: 'Requiere autorización', value: 'Requiere autorización' },
      { label: 'Fallido', value: 'Fallido' },
    ] })
    expect(parseCanvasSpec({ ...data, props: { ...data.props, children: [{
      ...select, options: ['Todos', { label: 'X', value: 'X', onClick: 'bad' }],
    }] } })).toBeNull()
  })

  it('renders raw JSON and a normal json fence without showing machine markup', () => {
    const data = sample()
    const json = JSON.stringify(data, null, 2)
    expect(splitGenerativeUiText(json).map(item => item.kind)).toEqual(['ui'])
    expect(splitGenerativeUiText('Resultado:\n' + json + '\nSiguiente paso.').map(item => item.kind))
      .toEqual(['markdown','ui','markdown'])
    expect(splitGenerativeUiText('```json\n' + json + '\n```').map(item => item.kind)).toEqual(['ui'])
  })

  it('hides unfinished raw JSON during streaming, rather than dumping it into chat', () => {
    const json = JSON.stringify(sample(), null, 2)
    expect(splitGenerativeUiText(json.slice(0, json.length - 5), { streaming: true })).toEqual([])
    expect(splitGenerativeUiText(json, { streaming: true }).map(item => item.kind)).toEqual(['ui'])
  })

  it('shows a clean notice instead of exposing malformed canvas JSON', () => {
    const malformed = JSON.stringify({ component: 'ui_canvas', version: 1, props: {
      title: 'Unsafe', children: [{ type: 'button', label: 'Run', prompt: 'x', onclick: 'evil' }],
    } }, null, 2)
    const segments = splitGenerativeUiText(malformed)
    expect(segments.map(item => item.kind)).toEqual(['notice'])
    expect(JSON.stringify(segments)).not.toContain('onclick')
  })

  it('filters an MCP inventory locally with text, status, and Apply filters without a model call', () => {
    const data = sample()
    const spec = parseCanvasSpec({ ...data, props: {
      ...data.props,
      children: [
        { type: 'group', layout: 'row', children: [
          { type: 'input', id: 'mcp-search', label: 'Buscar servidor', value: '' },
          { type: 'select', id: 'mcp-status', label: 'Estado', value: 'Todos',
            options: ['Todos', 'Listo', 'Requiere autorización', 'Fallido'] },
          { type: 'button', label: 'Aplicar filtros', prompt: 'Filtra la tabla usando los controles', action: 'submit' },
        ] },
        { type: 'table', columns: ['Servidor','Estado','Transporte','Herramientas','Siguiente paso'], rows: [
          ['notion','Requiere autorización','streamable-http','0','Autorizar'],
          ['figma','Fallido · connection-failed','streamable-http','0','Revisar'],
          ['devpost','Listo','streamable-http','24','Usar'],
        ] },
      ],
    } })
    if (spec === null) throw new Error('inventory rejected')
    const onAction = vi.fn()
    const { container } = render(<GenerativeCanvas spec={spec} onAction={onAction} />)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3)
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar servidor' }), { target: { value: 'fig' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(screen.getByText('figma')).not.toBeNull()
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar servidor' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Estado' }), { target: { value: 'Requiere autorización' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(screen.getByText('notion')).not.toBeNull()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('uses real upstream predesigned components for metrics, data tables, progress, alerts and timeline', () => {
    const input = sample()
    const spec = parseCanvasSpec({ ...input, props: { ...input.props, children: [
      { type: 'group', layout: 'grid', children: [
        { type: 'metric', label: 'Listos', value: '5', detail: 'Con herramientas' },
        { type: 'metric', label: 'Fallidos', value: '4' },
      ] },
      { type: 'progress', label: 'Conectados', value: 5, max: 18 },
      { type: 'alert', title: 'OAuth', message: 'Pendiente de autorización', status: 'warning' },
      { type: 'timeline', title: 'Actividad', items: [
        { date: '08/10', title: 'Conector revisado', description: 'Validación' },
      ] },
      { type: 'table', columns: ['Servidor', 'Estado'], rows: [['notion', 'Requiere autorización']] },
    ] } })
    if (spec === null) throw new Error('prebuilt spec invalid')
    const { container } = render(<GenerativeCanvas spec={spec} />)
    expect(screen.getByText('Listos')).not.toBeNull()
    expect(screen.getByText('Fallidos')).not.toBeNull()
    expect(screen.getByText('Pendiente de autorización')).not.toBeNull()
    expect(screen.getByText('Conector revisado')).not.toBeNull()
    expect(screen.getByText('notion')).not.toBeNull()
    expect(container.querySelector('table')).not.toBeNull()
  })

  it('keeps KPI descriptions inside compact proportional cards', () => {
    const template = sample()
    const spec = parseCanvasSpec({ ...template, props: { ...template.props, children: [
      { type: 'group', layout: 'grid', children: [
        { type: 'metric', label: 'Conectores MCP', value: '18', detail: 'Inventario ficticio' },
        { type: 'metric', label: 'Listos', value: '5', detail: '28% del total' },
        { type: 'metric', label: 'Pendientes', value: '9', detail: 'Requieren autorización' },
        { type: 'metric', label: 'Fallidos', value: '4', detail: 'Incidencias simuladas' },
      ] },
    ] } })
    if (spec === null) throw new Error('KPI layout fixture invalid')
    const { container } = render(<GenerativeCanvas spec={spec} />)
    const stat = screen.getByText('Conectores MCP').closest('div[style*="padding"]')
    expect(stat).not.toBeNull()
    expect(stat?.textContent).toContain('Inventario ficticio')
    expect(container.querySelectorAll('[data-generative-ui="ui_canvas"]')).toHaveLength(1)
    expect(screen.getByText('28% del total').closest('div[style*="padding"]')?.textContent).toContain('Listos')
  })

  it('routes upstream quick reply buttons through Phoenix user-clicked actions, not arbitrary model code', () => {
    const input = sample()
    const spec = parseCanvasSpec({ ...input, props: { ...input.props, children: [
      { type: 'group', layout: 'row', children: [
        { type: 'button', label: 'Actualizar estado', prompt: 'Actualiza el estado real de MCP', action: 'submit' },
        { type: 'button', label: 'Ver fallidos', prompt: 'Muestra solamente los MCP fallidos', action: 'draft' },
      ] },
    ] } })
    if (spec === null) throw new Error('quick replies rejected')
    const send = vi.fn()
    render(<GenerativeCanvas spec={spec} onAction={send} />)
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar estado' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ver fallidos' }))
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenNthCalledWith(1, 'Actualiza el estado real de MCP', 'submit')
    expect(send).toHaveBeenNthCalledWith(2, 'Muestra solamente los MCP fallidos', 'draft')
  })

  it('renders the validated canvas through the existing assistant UI bridge', () => {
    const block = parseGenerativeUiBlock(sample())
    if (block === null) throw new Error('fixture is invalid')
    const { container } = render(<GenerativeUi block={block} />)
    expect(container.querySelector('[data-generative-ui="ui_canvas"]')).not.toBeNull()
  })
})
