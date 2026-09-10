import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyBaselineAutomation } from './phoenix-quarantine-verify.mjs'

const roots: string[] = []

interface TestPackageJson {
  scripts: Record<string, string>
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('PHOENIX upstream quarantine verifier', () => {
  it('accepts candidate product changes while preserving base automation', () => {
    const fixture = createFixture()
    writeFileSync(join(fixture.root, 'product.txt'), 'candidate\n')
    const candidatePackage = JSON.parse(readFileSync(join(fixture.root, 'package.json'), 'utf8')) as TestPackageJson
    candidatePackage.scripts.extra = 'node extra.mjs'
    writeFileSync(join(fixture.root, 'package.json'), `${JSON.stringify(candidatePackage)}\n`)

    expect(verifyBaselineAutomation(fixture.root, fixture.baseSha)).toEqual({
      packageScripts: 2,
      automationFiles: 1,
    })
  })

  it('rejects a candidate that replaces a protected package script', () => {
    const fixture = createFixture()
    const candidatePackage = JSON.parse(readFileSync(join(fixture.root, 'package.json'), 'utf8')) as TestPackageJson
    candidatePackage.scripts['check:ci:static'] = 'node -e "process.exit(0)"'
    writeFileSync(join(fixture.root, 'package.json'), `${JSON.stringify(candidatePackage)}\n`)

    expect(() => verifyBaselineAutomation(fixture.root, fixture.baseSha))
      .toThrow('Candidate changed protected package script "check:ci:static".')
  })

  it('rejects a candidate that modifies base-owned executable automation', () => {
    const fixture = createFixture()
    writeFileSync(join(fixture.root, 'scripts', 'gate.mjs'), 'process.exit(0)\n')

    expect(() => verifyBaselineAutomation(fixture.root, fixture.baseSha))
      .toThrow('Candidate changed protected PHOENIX automation "scripts/gate.mjs".')
  })
})

function createFixture(): { root: string; baseSha: string } {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-quarantine-verifier-'))
  roots.push(root)
  mkdirSync(join(root, 'scripts'))
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    scripts: {
      'check:ci:static': 'node scripts/gate.mjs',
      lint: 'node scripts/gate.mjs --lint',
    },
  })}\n`)
  writeFileSync(join(root, 'scripts', 'gate.mjs'), 'console.log("gate")\n')
  writeFileSync(join(root, 'product.txt'), 'base\n')
  git(root, ['init', '--initial-branch=main'])
  git(root, ['config', 'core.autocrlf', 'false'])
  git(root, ['config', 'user.name', 'Phoenix Test'])
  git(root, ['config', 'user.email', 'phoenix-test@example.invalid'])
  git(root, ['add', '.'])
  git(root, ['commit', '-m', 'base'])
  return { root, baseSha: git(root, ['rev-parse', 'HEAD']).trim() }
}

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
}
