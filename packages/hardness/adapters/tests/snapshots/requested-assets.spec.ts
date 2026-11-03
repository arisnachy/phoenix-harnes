import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@phoenix-ai/cordis'
import Include from '@phoenix-ai/cordis-plugin-include'
import Loader from '@phoenix-ai/cordis-plugin-loader'
import { expect, it, vi } from 'vitest'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import { createSubagentMissionJudge } from '../../src/mission-judge.ts'

it('delivers requested abstract-game asset provenance to a judge through Loader composition', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phoenix-requested-assets-'))
  const ctx = new Context()
  const captured: string[] = []
  const dispose = vi.fn(async () => {})
  // The independent model is the external seam. The production judge builds
  // its real request while the test composition selects the deterministic model.
  const start = vi.fn<SubagentRuntime['start']>(async (_provider, request) => {
    captured.push(request.prompt.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'))
    return {
      id: 'asset-review' as never, localAgent: undefined, dispose,
      result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: {
        verdict: 'needs_changes', summary: 'Provenance needs evidence.', evidence: ['candidate'],
        required_changes: ['Provide the asset manifest.'],
        criteria: [{ id: 'assets', verdict: 'needs_changes', evidence: ['candidate'], findings: ['Missing manifest.'] }],
        quality: { verdict: 'needs_changes', summary: 'Missing manifest.', evidence: ['candidate'], findings: ['Provide provenance.'] },
      } }),
    }
  })
  const consumer = async () => {
    const judge = createSubagentMissionJudge({
      subagents: { getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }) as never, start },
      provider: 'spawn',
    })
    await judge({
      need: { kind: 'game', inputs: ['Create Snake with original character sprites and background assets'], outputs: ['game'] },
      goal: { objective: 'Deliver the requested game', deliverables: [{ id: 'game', description: 'Playable game' }], acceptanceCriteria: [{ id: 'assets', description: 'Requested assets have provenance', mandatory: true }], qualityRequirements: [] },
      criteria: [{ id: 'assets', description: 'Requested assets have provenance', mandatory: true, status: 'TESTED', evidence: ['candidate'] }],
      artifactId: 'game', artifactMime: 'text/html', rendered: { kind: 'game', artifactId: 'game' }, evidenceId: 'candidate',
      context: { callId: 'asset-mission' as never, signal: new AbortController().signal, agent: { id: 'parent', options: { provider: 'mock', model: 'mock' } } as never },
    })
  }
  try {
    const config = join(root, 'cordis.yml')
    await writeFile(config, "- name: 'requested-assets-judge-consumer'\n")
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(name: string) {
      if (name !== 'requested-assets-judge-consumer') throw new Error(`Unexpected plugin ${name}`)
      return consumer
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
    await ctx.loader.await()
    expect(start).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    const candidateLine = captured[0]?.split('\n').find(line => line.startsWith('Candidate: '))
    if (candidateLine === undefined) throw new Error('The real judge request was not emitted')
    const candidate = JSON.parse(candidateLine.slice('Candidate: '.length)) as { qualityContract: string[] }
    expect(candidate.qualityContract).toMatchSnapshot('Requested abstract-game asset contract')
    expect(candidate.qualityContract.join(' ')).toMatch(/asset-manifest|provenance/)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
