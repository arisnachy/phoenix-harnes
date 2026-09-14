import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@phoenix-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import { LivingCreationId } from '@phoenix-ai/dsh-living'
import LocalLivingRegistry from '@phoenix-ai/dsh-living-local'
import * as ToolLiving from '../src/index.ts'

const disposers: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(disposers.splice(0).reverse().map(dispose => dispose())) })

async function bench() {
  const root = new Context()
  const dir = await mkdtemp(join(tmpdir(), 'phoenix-tool-living-'))
  const promptFiber = await root.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' })
  const toolsFiber = await root.plugin(ToolRuntime, {})
  const livingFiber = await root.plugin(LocalLivingRegistry, { path: join(dir, 'living.json') })
  const toolFiber = await root.plugin(ToolLiving)
  disposers.push(
    () => promptFiber.dispose(),
    () => toolsFiber.dispose(),
    () => livingFiber.dispose(),
    () => toolFiber.dispose(),
  )
  return root
}

describe('tool-living', () => {
  it('states one universal rule instead of enumerating creation domains', async () => {
    const root = await bench()
    const assembly = await root.systemPrompt.assemble()
    const section = assembly.sections.find(item => item.name === 'tool:living')
    expect(section?.text).toBe(ToolLiving.LIVING_CREATION_POLICY)
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('regardless of its domain, format')
    expect(ToolLiving.LIVING_CREATION_POLICY).toContain('never special-case it to a fixed list')
    expect(ToolLiving.LIVING_CREATION_POLICY).not.toMatch(/chess|hospital|dashboard/i)
  })

  it('registers an unknown static creation kind through the model-facing tool', async () => {
    const root = await bench()
    const tool = root.tools.get('living_register_creation')
    expect(tool).toBeDefined()
    const value = await tool!.execute({
      id: 'strange-1', title: 'Unforeseen thing', kind: 'future-kind-xyz', target_level: 'static',
      state: [], actions: [], events: [], resources: ['artifact'], actors: [],
    }, {} as never)
    expect(value).toMatchObject({ id: 'strange-1', kind: 'future-kind-xyz', achieved_level: 'static', connected: false })
  })

  it('refuses completion verification until the declared live level is really attached', async () => {
    const root = await bench()
    await root.living.remember({
      id: LivingCreationId('sim-1'), title: 'Simulation', kind: 'novel-system', targetLevel: 'controllable',
      state: ['tick'], events: ['tickChanged'], actions: ['advance'], resources: [], actors: [],
    })
    const verify = root.tools.get('living_verify_creation')!
    await expect(verify.execute({ id: 'sim-1' }, {} as never)).rejects.toThrow(/not ready/i)

    const dispose = root.living.attach(LivingCreationId('sim-1'), {
      readState: () => ({ tick: 0 }), subscribe: () => () => undefined, act: () => ({ ok: true }),
    })
    await expect(verify.execute({ id: 'sim-1' }, {} as never)).resolves.toMatchObject({
      id: 'sim-1', target_level: 'controllable', achieved_level: 'controllable', connected: true,
    })
    dispose()
  })
})
