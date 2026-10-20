import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { admitPhoenixDiagram, createPhoenixDiagramTool, PHOENIX_DIAGRAM_MIME } from '../src/diagram-tool.ts'

function context(concludeTurn: () => void = () => {}): ToolRunContext {
  const callId = CallId('family-1')
  return {
    callId, rootCallId: callId, name: 'phoenix_diagram', arguments: {},
    token: Symbol('diagram-publish') as never,
    signal: new AbortController().signal, deferContext: () => {}, concludeTurn,
  }
}
const family = () => ({
  kind: 'genogram',
  nodes: [
    { id: 'a', label: 'Familiar A', x: 250, y: 140, shape: 'square' },
    { id: 'b', label: 'Familiar B', x: 750, y: 140, shape: 'circle' },
    { id: 'j', label: 'Unión', x: 500, y: 140, shape: 'point' },
    { id: 'c', label: 'Descendiente', x: 500, y: 450, shape: 'square' },
  ],
  edges: [
    { from: 'a', to: 'j', fromPort: 'right' },
    { from: 'j', to: 'b', toPort: 'left' },
    { from: 'j', to: 'c', toPort: 'top', via: [{ x: 500, y: 340 }] },
  ],
})
describe('governed universal diagram publication', () => {
  it('publishes a replayable diagram artifact and admits only real coordinates', async () => {
    const tool = createPhoenixDiagramTool()
    const end = vi.fn()
    const args = { title: 'Genograma familiar', diagram: family() }
    const result = await tool.execute(args, context(end)) as {
      artifactId: string; title: string; diagram: { component: string; props: { nodes: unknown[]; edges: unknown[] } }; publication: string
    }
    expect(result.artifactId).toBe('phoenix-diagram:family-1')
    expect(result.diagram.component).toBe('diagram')
    expect(result.diagram.props.nodes).toHaveLength(4)
    expect(result.diagram.props.edges).toHaveLength(3)
    expect(result.publication).toBe('artifact_emitted_not_client_render_verified')
    expect(end).toHaveBeenCalledOnce()
    expect(tool.output.presentationMeta?.(args, result as never)).toMatchObject({
      artifact: { id: 'phoenix-diagram:family-1', mime: PHOENIX_DIAGRAM_MIME,
        executable: false, data: { component: 'diagram', version: 1 } },
    })
  })
  it('does not conclude the turn if user explicitly requested further work', async () => {
    const tool = createPhoenixDiagramTool()
    const end = vi.fn()
    await tool.execute({ title: 'Secuencia', diagram: family(), continueAfterDisplay: true }, context(end))
    expect(end).not.toHaveBeenCalled()
  })
  it('rejects unknown references, out-of-frame nodes and hostile fields', async () => {
    const tool = createPhoenixDiagramTool()
    const end = vi.fn()
    for (const bad of [
      { nodes: [] },
      { ...family(), script: 'alert(1)' },
      { ...family(), nodes: [...family().nodes, family().nodes[0]] },
      { ...family(), edges: [{ from: 'a', to: 'unknown' }] },
      { ...family(), nodes: [{ ...family().nodes[0], x: -2 }, ...family().nodes.slice(1)] },
      { ...family(), nodes: [{ ...family().nodes[0], y: 790 }, ...family().nodes.slice(1)] },
      { ...family(), edges: [{ from: 'a', to: 'c', via: [{ x: 500, y: 700 }] }] },
    ]) {
      await expect(tool.execute({ title: 'Inadmisible', diagram: bad }, context(end))).rejects.toThrow()
    }
    expect(end).not.toHaveBeenCalled()
  })
  it('rejects scripts and serializes the native spec without external effects', () => {
    const result = admitPhoenixDiagram(family(), 'Familia ilustrativa')
    expect(result.props.kind).toBe('genogram')
    expect(result.props.nodes.map(node => node.label)).toContain('Descendiente')
    expect(JSON.stringify(result)).not.toMatch(/<script|fetch\(|https?:\/\//i)
  })
})
