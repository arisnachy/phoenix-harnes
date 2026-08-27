import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { registerCapabilityArtifactPreview } from '@deepseek-ai/dsh-client-ui-workspace/client'

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
})
