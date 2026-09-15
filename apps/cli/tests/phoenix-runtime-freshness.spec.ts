import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clientArtifactsAreFresh } from '../src/phoenix-runtime-freshness.ts'

const roots: string[] = []

function fixtureRoot(sourceHead: string): string {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-runtime-freshness-'))
  roots.push(root)
  mkdirSync(join(root, '.dsh-build'), { recursive: true })
  mkdirSync(join(root, 'apps', 'web', 'dist'), { recursive: true })
  writeFileSync(join(root, '.dsh-build', 'client-build-environment.json'), JSON.stringify({
    environment: { DSH_CLIENT_COMMIT_HASH: sourceHead.slice(0, 7) },
  }))
  writeFileSync(join(root, 'apps', 'web', 'dist', 'index.html'), '<!doctype html>')
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Phoenix web runtime freshness', () => {
  it('rejects an otherwise-current build when the KIRA portrait sheet is missing', () => {
    const sourceHead = '1234567890abcdef1234567890abcdef12345678'
    const root = fixtureRoot(sourceHead)

    expect(clientArtifactsAreFresh(root, sourceHead)).toBe(false)
  })

  it('accepts the build only after the KIRA portrait sheet is present', () => {
    const sourceHead = 'abcdef1234567890abcdef1234567890abcdef12'
    const root = fixtureRoot(sourceHead)
    const portrait = join(root, 'apps', 'web', 'dist', 'assets', 'kira-agents', 'kira-portraits.webp')
    mkdirSync(join(root, 'apps', 'web', 'dist', 'assets', 'kira-agents'), { recursive: true })
    writeFileSync(portrait, 'fixture')

    expect(clientArtifactsAreFresh(root, sourceHead)).toBe(true)
  })
})
