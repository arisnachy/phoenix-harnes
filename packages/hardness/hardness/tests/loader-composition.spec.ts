import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import Include from '@phoenix-ai/cordis-plugin-include'
import Loader from '@phoenix-ai/cordis-plugin-loader'
import HardnessRegistry from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('HARDNESS real Loader composition', () => {
  it('boots the service through cordis.yml and disposes its service fiber', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-hardness-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, "- name: '@phoenix-ai/dsh-hardness'\n")

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier !== '@phoenix-ai/dsh-hardness') throw new Error(`unexpected Loader import: ${specifier}`)
        return HardnessRegistry
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    expect(context.get('hardness')).toBeInstanceOf(HardnessRegistry)
    await context.fiber.dispose()
    expect(context.get('hardness')).toBeUndefined()
  })
})
