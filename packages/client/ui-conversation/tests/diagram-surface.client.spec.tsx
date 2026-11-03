// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DiagramSurface, parseDiagramSpec } from '../src/client/chat/DiagramSurface.tsx'
import { GenerativeUi, parseGenerativeUiBlock, splitGenerativeUiText } from '../src/client/chat/GenerativeUi.tsx'
import { HardnessArtifactBody } from '../src/client/chat/HardnessArtifactBody.tsx'
import { normalizeHardnessArtifact } from '../src/client/artifact.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const genogram = () => ({
  component: 'diagram',
  version: 1,
  props: {
    id: 'familia-demo',
    title: 'Genograma familiar',
    kind: 'genogram',
    note: 'Familia ficticia sin datos clínicos.',
    nodes: [
      { id: 'p1', label: 'Progenitor A', shape: 'square', x: 260, y: 145, detail: 'Primera generación' },
      { id: 'p2', label: 'Progenitora B', shape: 'circle', x: 740, y: 145 },
      { id: 'couple', label: 'Unión', shape: 'point', x: 500, y: 145 },
      { id: 'child1', label: 'Hijo', shape: 'square', x: 300, y: 460 },
      { id: 'child2', label: 'Hija', shape: 'circle', x: 700, y: 460, detail: 'Segunda generación' },
    ],
    edges: [
      { from: 'p1', to: 'couple', fromPort: 'right' },
      { from: 'couple', to: 'p2', toPort: 'left' },
      { from: 'couple', to: 'child1', toPort: 'top', via: [{ x: 500, y: 340 }, { x: 300, y: 340 }] },
      { from: 'couple', to: 'child2', toPort: 'top', via: [{ x: 500, y: 340 }, { x: 700, y: 340 }] },
    ],
  },
})

describe('universal native diagrams / genograms', () => {
  it('accepts a complete typed genogram and enforces relationship integrity', () => {
    const spec = genogram()
    expect(parseDiagramSpec(spec)).not.toBeNull()
    expect(parseGenerativeUiBlock(spec)).not.toBeNull()
    expect(parseDiagramSpec({ ...spec, props: { ...spec.props, script: 'alert(1)' } })).toBeNull()
    expect(parseDiagramSpec({ ...spec, props: { ...spec.props, nodes: [...spec.props.nodes, spec.props.nodes[0]] } })).toBeNull()
    expect(parseDiagramSpec({ ...spec, props: { ...spec.props, edges: [{ from: 'p1', to: 'unknown' }] } })).toBeNull()
    expect(parseDiagramSpec({ ...spec, props: { ...spec.props, nodes: [{ ...spec.props.nodes[0], x: Infinity }, ...spec.props.nodes.slice(1)] } })).toBeNull()
    expect(parseDiagramSpec({ ...spec, props: { ...spec.props, edges: [{ from: 'p1', to: 'p2', via: [{ x: -1, y: 20 }] }] } })).toBeNull()
  })

  it('renders raw/fenced JSON as genuine UI rather than echoing machine code', () => {
    const source = JSON.stringify(genogram())
    expect(splitGenerativeUiText(source).map(s => s.kind)).toEqual(['ui'])
    const prose = 'Aquí está tu genograma:\n\n' + ['```generative-ui', source, '```'].join('\n')
    expect(splitGenerativeUiText(prose).map(s => s.kind)).toEqual(['markdown', 'ui'])
    expect(splitGenerativeUiText('Aqui va\n```generative-ui\n' + source.slice(0, 26), { streaming: true })
      .some(segment => segment.kind === 'ui')).toBe(false)
  })

  it('shows the genogram visibly inside chat with selectable family members', () => {
    const spec = parseDiagramSpec(genogram())!
    const action = vi.fn()
    render(<DiagramSurface spec={spec} onAction={action} />)
    expect(screen.getByRole('heading', { name: 'Genograma familiar' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Diagrama: Genograma familiar' })).toBeTruthy()
    expect(document.querySelectorAll('svg polyline')).toHaveLength(4)
    expect(document.querySelectorAll('svg rect')).toHaveLength(3) // paper + two squares
    fireEvent.click(screen.getByRole('button', { name: 'Hija' }))
    expect(screen.getByText('Segunda generación')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Preguntar a Kira sobre este elemento' }))
    expect(action).toHaveBeenCalledWith(expect.stringContaining('Hija'), 'draft')
    expect(screen.getByRole('button', { name: 'Exportar SVG' })).toBeTruthy()
  })

  it('renders diagram through both output channels: assistant UI and artifact envelope', () => {
    const spec = parseGenerativeUiBlock(genogram())
    expect(spec).not.toBeNull()
    if (spec) render(<GenerativeUi block={spec} />)
    expect(document.querySelector('[data-phoenix-diagram="familia-demo"]')).toBeTruthy()
    cleanup()
    const artifact = normalizeHardnessArtifact({
      id: 'family-1', title: 'Genograma familiar',
      mime: 'application/vnd.phoenix.diagram+json', data: genogram(),
    })
    expect(artifact.kind).toBe('visual')
    render(<HardnessArtifactBody mime={artifact.mime} data={artifact.data} expanded={false} title={artifact.title} />)
    expect(document.querySelector('[data-phoenix-diagram="familia-demo"]')).toBeTruthy()
    expect(screen.queryByText(/"component"/)).toBeNull()
  })

  it('fails visibly instead of falsely claiming a diagram publication', () => {
    render(<HardnessArtifactBody mime="application/vnd.phoenix.diagram+json"
      data={{ component: 'diagram', version: 1, props: { title: 'Roto' } }}
      expanded={false} title="Genograma roto" />)
    expect(screen.getByRole('alert').textContent).toMatch(/estructura inválida/)
    expect(document.querySelector('[data-phoenix-diagram]')).toBeNull()
  })
})
