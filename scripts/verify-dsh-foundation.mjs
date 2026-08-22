import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const manifest = JSON.parse(await readFile(new URL('../PHOENIX_UPSTREAM.json', import.meta.url), 'utf8'))
const expected = manifest?.upstream?.commit
const expectedVersion = manifest?.upstream?.version
if (typeof expected !== 'string' || !/^[0-9a-f]{40}$/.test(expected)) {
  throw new Error('PHOENIX_UPSTREAM.json must pin an exact 40-character upstream commit SHA')
}

let actual
try {
  actual = execFileSync('git', ['-C', 'upstream/deepseek-harness', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  throw new Error('DeepSeek Harness submodule is missing. Clone/update with git submodule update --init --recursive.')
}
if (actual !== expected) {
  throw new Error(`DeepSeek Harness upstream mismatch: expected ${expected}, found ${actual}`)
}

const packageJson = JSON.parse(await readFile('upstream/deepseek-harness/package.json', 'utf8'))
if (expectedVersion && packageJson.version !== expectedVersion) {
  throw new Error(`DeepSeek Harness version mismatch: expected ${expectedVersion}, found ${packageJson.version}`)
}

const bundle = JSON.parse(await readFile('packages/dsh-phoenix/package.json', 'utf8'))
if (bundle?.dsh?.bundle?.patch !== './cordis.patch.yml') {
  throw new Error('@phoenix/dsh-bundle must declare its DSH bundle patch')
}

console.log(`PHOENIX upstream verified: DeepSeek Harness ${packageJson.version} @ ${actual}`)
