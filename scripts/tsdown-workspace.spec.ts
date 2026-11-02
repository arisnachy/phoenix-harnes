import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { phoenixTsdownWorkspace } from './tsdown-workspace.ts'

async function packageDirectory(root: string, path: string): Promise<void> {
  const directory = join(root, ...path.split('/'))
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: path }))
}

describe('PHOENIX tsdown workspace discovery', () => {
  it('includes real packages and excludes stale build-only workspace shells', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-tsdown-workspace-'))
    try {
      await packageDirectory(root, 'vendor/cordis')
      await packageDirectory(root, 'packages/experimental/live-agent')
      await packageDirectory(root, 'apps/cli')

      const stale = join(root, 'packages', 'experimental', 'tool-agent-team', 'lib', 'types')
      await mkdir(stale, { recursive: true })
      await writeFile(
        join(stale, 'index.js'),
        "import { TeamTaskId } from '@phoenix-ai/dsh-experimental-agent-team'\n",
      )

      expect(phoenixTsdownWorkspace(root)).toEqual([
        'apps/cli',
        'packages/experimental/live-agent',
        'vendor/cordis',
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
