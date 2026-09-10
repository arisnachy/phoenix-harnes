/**
 * Verify that an upstream candidate cannot replace PHOENIX's acceptance
 * orchestration before the credential-free quarantine gate executes it.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const executableExtensions = new Set(['.cjs', '.cmd', '.js', '.mjs', '.mts', '.ps1', '.sh', '.ts'])

/**
 * Compare candidate automation with the exact PHOENIX base commit.
 * @param {string} candidateRoot - Candidate Git working tree.
 * @param {string} baseSha - Full immutable PHOENIX base commit.
 * @returns {{ packageScripts: number, automationFiles: number }} Verified item counts.
 */
export function verifyBaselineAutomation(candidateRoot, baseSha) {
  if (!/^[0-9a-f]{40}$/u.test(baseSha)) {
    throw new Error(`Expected a full lowercase base SHA, got ${JSON.stringify(baseSha)}.`)
  }
  const root = resolve(candidateRoot)
  const baselinePackage = JSON.parse(gitText(root, ['show', `${baseSha}:package.json`]))
  const candidatePackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const baselineScripts = requireScripts(baselinePackage, 'baseline')
  const candidateScripts = requireScripts(candidatePackage, 'candidate')

  for (const [name, command] of Object.entries(baselineScripts)) {
    if (candidateScripts[name] !== command) {
      throw new Error(`Candidate changed protected package script ${JSON.stringify(name)}.`)
    }
  }

  const automationFiles = gitText(root, ['ls-tree', '-r', '--name-only', baseSha, '--', 'scripts'])
    .split(/\r?\n/u)
    .filter(path => path !== '' && executableExtensions.has(extname(path)))
  for (const path of automationFiles) {
    const baseline = gitBuffer(root, ['show', `${baseSha}:${path}`])
    const candidate = readFileSync(resolve(root, path))
    if (!baseline.equals(candidate)) {
      throw new Error(`Candidate changed protected PHOENIX automation ${JSON.stringify(path)}.`)
    }
  }

  return {
    packageScripts: Object.keys(baselineScripts).length,
    automationFiles: automationFiles.length,
  }
}

/**
 * Run the candidate's static gate after its orchestration matches the base.
 * @param {string} candidateRoot - Candidate Git working tree.
 * @returns {void}
 */
export function runStaticGate(candidateRoot) {
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(executable, ['run', 'check:ci:static'], {
    cwd: resolve(candidateRoot),
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`PHOENIX static quarantine gate exited with status ${String(result.status)}.`)
  }
}

function requireScripts(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || typeof value.scripts !== 'object' || value.scripts === null || Array.isArray(value.scripts)) {
    throw new Error(`${label} package.json must contain a scripts object.`)
  }
  for (const [name, command] of Object.entries(value.scripts)) {
    if (typeof command !== 'string') throw new Error(`${label} package script ${JSON.stringify(name)} must be a string.`)
  }
  return value.scripts
}

function gitText(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
}

function gitBuffer(root, args) {
  return execFileSync('git', ['-C', root, ...args])
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [candidateRoot, baseSha, option] = process.argv.slice(2)
  if (candidateRoot === undefined || baseSha === undefined || (option !== undefined && option !== '--check-only')) {
    throw new Error('Usage: node phoenix-quarantine-verify.mjs <candidate-root> <base-sha> [--check-only]')
  }
  const verified = verifyBaselineAutomation(candidateRoot, baseSha)
  console.log(`Verified ${verified.packageScripts} package scripts and ${verified.automationFiles} executable automation files against ${baseSha}.`)
  if (option !== '--check-only') runStaticGate(candidateRoot)
}
