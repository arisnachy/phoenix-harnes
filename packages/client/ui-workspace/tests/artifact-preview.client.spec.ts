import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@phoenix-ai/dsh-client-runtime/client'
import { CapabilityArtifactPreview, registerCapabilityArtifactPreview } from '@phoenix-ai/dsh-client-ui-workspace/client'

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

  it('renders a declarative UI artifact without executable props', () => {
    const view = CapabilityArtifactPreview({
      artifact: { id: 'ui1', mime: 'application/vnd.hardness.ui+json', data: { version: 1, root: { type: 'stack', children: [{ type: 'input', id: 'x', label: 'X' }, { type: 'button', label: 'Run' }] } } },
      rendered: { kind: 'generative-ui', artifactId: 'ui1' },
    }) as { props: { children: unknown[]; style: Record<string, unknown> } }
    expect(view.props.style).toMatchObject({ alignSelf: 'stretch', maxWidth: 720, margin: '20px auto' })
    expect(JSON.stringify(view).includes('"type":"section"')).toBe(true)
  })

  it('renders HTML documents in a script-free sandboxed frame', () => {
    const view = CapabilityArtifactPreview({
      artifact: { id: 'html1', mime: 'text/html', data: '<!doctype html><h1>Informe PHOENIX</h1>' },
      rendered: { kind: 'html-document', artifactId: 'html1' },
    }) as { props: { children: unknown[] } }
    const body = view.props.children[1] as { props: { children: unknown[] } }
    const iframe = body.props.children[1] as { type: string; props: Record<string, unknown> }
    expect(iframe.type).toBe('iframe')
    expect(iframe.props).toMatchObject({
      title: 'Documento html1',
      sandbox: '',
      referrerPolicy: 'no-referrer',
      srcDoc: '<!doctype html><h1>Informe PHOENIX</h1>',
    })
    expect(iframe.props.sandbox).not.toContain('allow-scripts')
    expect(iframe.props.sandbox).not.toContain('allow-forms')
    expect(iframe.props.sandbox).not.toContain('allow-same-origin')
  })
})
