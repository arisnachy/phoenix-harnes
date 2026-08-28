import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { CapabilityArtifactPreview, registerCapabilityArtifactPreview } from '@deepseek-ai/dsh-client-ui-workspace/client'

describe('CapabilityArtifact workspace preview', () => {
  it('registers rendered artifact data into a reversible workspace slot', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    const disposeDeclaration = slots.register({ name: 'root', children: { 'shell.overlay': { kind: 'list', scope: 'root' } } } as never, () => null)
    const artifact = { id: 'a1', mime: 'text/plain', data: 'hello' }
    const rendered = { kind: 'text-preview', artifactId: 'a1' }
    const dispose = registerCapabilityArtifactPreview(slots, artifact, rendered)
    const entry = slots.entries('shell.overlay')[0]!
    expect(entry.options.id).toBe('a1')
    expect((entry.inject as () => { artifact: typeof artifact; rendered: typeof rendered })()).toEqual({ artifact, rendered })
    dispose()
    expect(slots.entries('shell.overlay')).toHaveLength(0)
    disposeDeclaration()
  })

  it('renders a mixed universal artifact as one dynamic result card', () => {
    const view = CapabilityArtifactPreview({
      artifact: { id: 'mixed1', mime: 'application/vnd.hardness.artifact+json', data: { id: 'mixed1', title: 'MLB + análisis', status: 'verified', evidence: [], blocks: [{ type: 'markdown', text: 'Resumen' }, { type: 'code', language: 'python', text: 'print(42)' }, { type: 'table', columns: ['team'], rows: [['Yankees']] }] } },
      rendered: { kind: 'universal', artifactId: 'mixed1' },
    })
    expect(JSON.stringify(view)).toContain('MLB + análisis')
    expect(JSON.stringify(view)).toContain('Yankees')
    expect(JSON.stringify(view)).toContain('python')
  })

  it('renders a declarative UI artifact without executable props', () => {
    const view = CapabilityArtifactPreview({
      artifact: { id: 'ui1', mime: 'application/vnd.hardness.ui+json', data: { version: 1, root: { type: 'stack', children: [{ type: 'input', id: 'x', label: 'X' }, { type: 'button', label: 'Run' }] } } },
      rendered: { kind: 'generative-ui', artifactId: 'ui1' },
    }) as { props: { children: unknown[]; style: Record<string, unknown> } }
    expect(view.props.style).toMatchObject({ alignSelf: 'stretch', maxWidth: 720, margin: '20px auto' })
    expect(JSON.stringify(view).includes('"type":"section"')).toBe(true)
  })
})
