import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractRelativeImportSpecs, extractSymbols, RepoBrainIndex } from '../src/index.ts'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'phoenix-repo-brain-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function indexAt(root: string): RepoBrainIndex {
  return new RepoBrainIndex({
    root,
    maxFiles: 100,
    maxFileBytes: 64 * 1024,
    maxTermsPerFile: 512,
    defaultLimit: 10,
  })
}

describe('PHOENIX Repo Brain', () => {
  it('extracts structural symbols and relative imports without an LLM', () => {
    const text = `import { helper } from './helper.js'\nexport interface FlightPlan {}\nexport function routeMission() { return helper() }`
    expect(extractSymbols(text, '.ts')).toEqual(expect.arrayContaining(['FlightPlan', 'routeMission']))
    expect(extractRelativeImportSpecs(text)).toEqual(['./helper.js'])
  })

  it('reuses unchanged files on refresh and rereads only changed files', async () => {
    const root = await fixture()
    await writeFile(join(root, 'alpha.ts'), 'export function alpha() { return 1 }\n')
    await writeFile(join(root, 'beta.ts'), 'export function beta() { return 2 }\n')
    const brain = indexAt(root)

    expect(await brain.refresh()).toMatchObject({ files: 2, reread: 2, reused: 0 })
    expect(await brain.refresh()).toMatchObject({ files: 2, reread: 0, reused: 2 })

    await new Promise(resolve => setTimeout(resolve, 10))
    await writeFile(join(root, 'beta.ts'), 'export function betaChanged() { return 3 }\n')
    expect(await brain.refresh()).toMatchObject({ files: 2, reread: 1, reused: 1 })
    expect((await brain.search('betaChanged'))[0]?.path).toBe('beta.ts')
  })

  it('ranks symbol/path matches and computes reverse import impact', async () => {
    const root = await fixture()
    await writeFile(join(root, 'core.ts'), 'export function phoenixKernel() { return true }\n')
    await writeFile(join(root, 'router.ts'), `import { phoenixKernel } from './core.js'\nexport const route = () => phoenixKernel()\n`)
    await writeFile(join(root, 'app.ts'), `import { route } from './router.js'\nexport const app = route\n`)
    const brain = indexAt(root)
    await brain.refresh()

    expect((await brain.search('phoenixKernel'))[0]?.path).toBe('core.ts')
    expect(await brain.impact('core.ts', 3)).toEqual([
      { path: 'router.ts', depth: 1 },
      { path: 'app.ts', depth: 2 },
    ])
  })

  it('refuses impact paths that escape the repository root', async () => {
    const root = await fixture()
    await writeFile(join(root, 'safe.ts'), 'export const safe = true\n')
    const brain = indexAt(root)
    await brain.refresh()
    await expect(brain.impact('../outside.ts')).rejects.toThrow(/escapes repository root/)
  })
})
