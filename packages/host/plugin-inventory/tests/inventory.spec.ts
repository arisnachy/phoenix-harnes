import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Plugin } from '@phoenix-ai/cordis'
import Loader from '@phoenix-ai/cordis-plugin-loader'
import { remoteMethods } from '@phoenix-ai/dsh-typert-protocol'
import PluginInventoryGateway from '../src/index.ts'

const contexts: Context[] = []
const tempRoots: string[] = []
const previousRuntimeRoot = process.env.PHOENIX_RUNTIME_ROOT

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (previousRuntimeRoot === undefined) delete process.env.PHOENIX_RUNTIME_ROOT
  else process.env.PHOENIX_RUNTIME_ROOT = previousRuntimeRoot
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const activePlugin: Plugin.Function = () => {}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}

async function harness(): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  await ctx.plugin(PluginInventoryGateway)
  const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
  return { ctx, inventory }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function updateRepository(): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-update-remote-'))
  tempRoots.push(root)
  git(root, 'init')
  git(root, 'config', 'user.email', 'phoenix-test@example.invalid')
  git(root, 'config', 'user.name', 'PHOENIX Test')
  writeFileSync(join(root, 'seed.txt'), 'stable\n')
  git(root, 'add', 'seed.txt')
  git(root, 'commit', '-m', 'stable')
  return { root, head: git(root, 'rev-parse', 'HEAD') }
}

describe('PluginInventoryGateway', () => {
  it('publishes diagnostics and updater methods under the pluginInventory namespace', async () => {
    const { inventory } = await harness()
    expect(inventory.typertRemote).toMatchObject({
      serviceKey: 'pluginInventory',
      namespace: 'pluginInventory',
    })
    expect(remoteMethods(inventory)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'updateState', invocation: { kind: 'direct' } },
      { method: 'restartForUpdate', invocation: { kind: 'direct' } },
      { method: 'refreshForUpdate', invocation: { kind: 'direct' } },
    ])
  })

  it('projects current non-group Loader entries without a second cache', async () => {
    const { ctx, inventory } = await harness()
    const activeId = await ctx.loader.create({ name: 'cordis:active' })
    const pendingId = await ctx.loader.create({ name: 'cordis:pending' })
    const disabledId = await ctx.loader.create({
      name: 'cordis:not-installed',
      disabled: true,
    })
    await ctx.loader.create({ name: 'cordis:active', group: true })

    const snapshot = inventory.list()
    expect(snapshot.entries).toHaveLength(3)
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      {
        entryId: activeId,
        moduleName: 'cordis:active',
        enabled: true,
        fiberPhase: 'active',
      },
      {
        entryId: pendingId,
        moduleName: 'cordis:pending',
        enabled: true,
        fiberPhase: 'pending',
      },
      {
        entryId: disabledId,
        moduleName: 'cordis:not-installed',
        enabled: false,
        fiberPhase: null,
      },
    ]))

    await ctx.loader.update(activeId, { disabled: true })
    expect(inventory.list().entries.find(entry => entry.entryId === activeId)).toEqual({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: false,
      fiberPhase: null,
    })

    await ctx.loader.remove(pendingId)
    expect(inventory.list().entries.some(entry => entry.entryId === pendingId)).toBe(false)
  })

  it('reads idle updater state and refuses an unprepared restart without scheduling exit', async () => {
    const { root } = updateRepository()
    process.env.PHOENIX_RUNTIME_ROOT = root
    const { inventory } = await harness()
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    expect(inventory.updateState()).toEqual({ status: 'idle' })
    expect(inventory.restartForUpdate()).toEqual({ accepted: false, status: 'idle' })
    expect(inventory.refreshForUpdate()).toEqual({ accepted: true })
    expect(exit).not.toHaveBeenCalled()
  })

  it('accepts only a prepared target and schedules Host exit after returning the receipt', async () => {
    vi.useFakeTimers()
    const { root, head } = updateRepository()
    process.env.PHOENIX_RUNTIME_ROOT = root
    writeFileSync(join(root, '.git', 'phoenix-update-state.json'), JSON.stringify({
      schema: 1,
      status: 'ready',
      phase: 'ready',
      current: head,
      target: head,
    }))
    const { inventory } = await harness()
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    expect(inventory.updateState()).toMatchObject({ status: 'ready', target: head })
    expect(inventory.restartForUpdate()).toEqual({ accepted: true, status: 'restarting' })
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(250)
    expect(exit).toHaveBeenCalledWith(0)
  })
})
