import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context, type Context as CordisContext } from '@phoenix-ai/cordis'
import Include from '@phoenix-ai/cordis-plugin-include'
import Loader from '@phoenix-ai/cordis-plugin-loader'
import SystemPrompt, { renderPrompt } from '@phoenix-ai/dsh-system-prompt'
import { installHardnessProtocol } from '../../src/protocol.ts'

let root: string | undefined
let context: Context | undefined

const HardnessPromptConsumer = Object.assign((ctx: CordisContext) => {
  return installHardnessProtocol(ctx.systemPrompt)
}, { inject: ['systemPrompt'] })

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

it('assembles HARDNESS fast-path and autonomy policy through the real Loader prompt surface', async () => {
  root = await mkdtemp(join(tmpdir(), 'phoenix-hardness-autonomy-snapshot-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@phoenix-ai/dsh-system-prompt'",
    "- name: 'hardness-autonomy-snapshot-consumer'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier === '@phoenix-ai/dsh-system-prompt') return SystemPrompt
      if (specifier === 'hardness-autonomy-snapshot-consumer') return HardnessPromptConsumer
      throw new Error(`unexpected Loader import: ${specifier}`)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()

  const prompt = renderPrompt(await context.systemPrompt.assemble())
  const policy = prompt.split('\n').filter(line =>
    line.includes('Selected HARDNESS flows are the process policy')
    || line.includes('Use fast mode for bounded cosmetic')
    || line.includes('In fast mode execute the bounded change')
    || line.includes('Do not ask the user for routine file-location')
    || line.includes('Never close a mission because work progressed'),
  )

  expect(policy).toMatchInlineSnapshot(`
    [
      "Selected HARDNESS flows are the process policy for this mission. Do not preload brainstorming, planning, review, or other methodology skills merely because a generic skill catalog makes them look applicable; load process skills only when they implement selected HARDNESS flows.",
      "Use fast mode for bounded cosmetic, wording, styling, and localized implementation changes: make the smallest safe change, run targeted fresh verification, and escalate only when new evidence adds risk, scope, failure, or another real trigger.",
      "In fast mode execute the bounded change without design ceremony or routine approval: inspect, make the smallest safe change, run targeted verification, and finish only with fresh evidence.",
      "Do not ask the user for routine file-location, implementation, plan, or recovery decisions when context and tools can resolve them. Ask only for explicit permission or account authorization, safety requirements, exhausted provider quota, or a genuine external dependency Phoenix cannot safely satisfy.",
      "Never close a mission because work progressed, partial tests passed, a scaffold or mock exists, a turn ended, or an internal retry limit was reached; change strategy and keep the mission active until verified completion or a genuine external dependency.",
    ]
  `)
})
