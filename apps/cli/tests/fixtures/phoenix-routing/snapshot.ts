import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  createUserMessage,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  boot,
  healProfilesModuleFallback,
  loadOverlayPatches,
  resolveProfileDir,
} from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-loop'

const overlayPath = process.argv[2]
if (overlayPath === undefined) throw new Error('PHOENIX routing snapshot requires an overlay path')
let rootConfigPath = fileURLToPath(new URL('./root.cordis.yml', import.meta.url))
if (process.env.DSH_EXAMPLE_MODE === 'lib') {
  const dshHome = process.env.DSH_HOME
  if (dshHome === undefined) throw new Error('PHOENIX lib snapshot requires DSH_HOME')
  const installAnchor = fileURLToPath(new URL('../../../package.json', import.meta.url))
  healProfilesModuleFallback(installAnchor, dshHome)
  const profileDir = resolveProfileDir('phoenix-snapshot', dshHome)
  mkdirSync(profileDir, { recursive: true })
  rootConfigPath = join(profileDir, 'root.cordis.yml')
  writeFileSync(rootConfigPath, '[]\n')
}
const basePatchPath = fileURLToPath(new URL('../../../../../packages/bundle/base/cordis.patch.yml', import.meta.url))
const phoenixPatchPath = fileURLToPath(new URL('../../../config/phoenix/cordis.patch.yml', import.meta.url))

const ctx = await boot('phoenix-routing-snapshot', rootConfigPath, [
  ...loadOverlayPatches('phoenix-routing-snapshot', basePatchPath),
  ...loadOverlayPatches('phoenix-routing-snapshot', phoenixPatchPath),
  ...loadOverlayPatches('phoenix-routing-snapshot', overlayPath),
])
class SnapshotAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private readonly response: string

  constructor(response: string) {
    super()
    this.response = response
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: this.response }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: this.response } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const localAdapter = new SnapshotAdapter('local')
const freeAdapter = new SnapshotAdapter('free')
ctx.llm.registerAdapter(['phoenix-local'], localAdapter)
ctx.llm.registerAdapter(['phoenix-free'], freeAdapter)

function waitForIdle(subject: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = subject.on('agent/status', ({ agent: changed, status }) => {
      if (changed === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

async function runTask(id: string, text: string): Promise<{
  request: { provider?: string; model?: string; personaAligned: boolean }
  header: { provider?: string; model?: string }
}> {
  const localBefore = localAdapter.requests.length
  const freeBefore = freeAdapter.requests.length
  const agent = ctx.agentLoop.create(SessionId(id), { provider: 'seed', model: 'seed' })
  const idle = waitForIdle(ctx, agent)
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
  await idle
  const request = localAdapter.requests[localBefore] ?? freeAdapter.requests[freeBefore]
  if (request === undefined) throw new Error(`PHOENIX snapshot task ${id} made no request`)
  const event = agent.session.events.find(event => event.type === 'request/header')
  if (event?.type !== 'request/header') throw new Error(`PHOENIX snapshot task ${id} recorded no request header`)
  return {
    request: {
      provider: request.provider,
      model: request.model,
      personaAligned: request.system?.includes(`PHOENIX snapshot uses ${request.model}.`) ?? false,
    },
    header: {
      provider: event.data.header.config.provider,
      model: event.data.header.config.model,
    },
  }
}

try {
  const local = await runTask('phoenix-snapshot-local', 'Rename this variable.')
  const free = await runTask('phoenix-snapshot-free', 'Perform an architecture review.')
  process.stdout.write(`${JSON.stringify({ local, free })}\n`)
} finally {
  await ctx.fiber.dispose()
}
