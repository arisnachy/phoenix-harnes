/**
 * Receive updates from the official Codex plugin and OpenClaw skill sources.
 *
 * Each update is staged in a private DSH_HOME, verified through the native
 * bridge commands, and activated as one filesystem transaction. A failed
 * candidate never changes the live bridge; an activation failure is rolled
 * back from its transaction journal.
 */

import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const STATE_SCHEMA = 1
const DEFAULT_POLL_MS = 10 * 60 * 1000
const MIN_POLL_MS = 30 * 1000

const PROVIDERS = {
  codex: {
    label: 'Codex plugins',
    sourceRepository: 'https://github.com/openai/plugins.git',
    sourceBranch: 'main',
    rootRelative: 'codex',
    stateRelative: join('codex', 'arsenal.json'),
    bridgeArgs: ['codex-plugin', 'sync'],
    verifyArgs: ['codex-plugin', 'verify'],
    managedField: 'managedSkills',
  },
  openclaw: {
    label: 'OpenClaw skills',
    sourceRepository: 'https://github.com/openclaw/openclaw.git',
    sourceBranch: 'main',
    rootRelative: 'openclaw-skills',
    stateRelative: join('openclaw-skills', 'arsenal.json'),
    bridgeArgs: ['openclaw-skills', 'sync'],
    verifyArgs: ['openclaw-skills', 'verify'],
    managedField: 'managedSkills',
  },
}

/** Normalize the update mode used by the watcher and manual commands. */
export function normalizeMode(value) {
  const mode = String(value).trim().toLowerCase()
  if (!['auto', 'notify', 'off'].includes(mode)) {
    throw new Error(`PHOENIX_UPSTREAM_UPDATE_MODE must be auto, notify, or off; got ${JSON.stringify(value)}`)
  }
  return mode
}

/** Parse a single `git ls-remote` result without accepting a symbolic ref. */
export function parseRemoteHead(output) {
  const line = String(output).split(/\r?\n/).map(value => value.trim()).find(value => value.length > 0)
  const match = /^(?<commit>[0-9a-f]{40})\s+refs\/heads\/main$/i.exec(line ?? '')
  if (match?.groups?.commit === undefined) throw new Error('official upstream did not return a valid main commit')
  return match.groups.commit.toLowerCase()
}

/** Classify the relationship between the installed and observed commits. */
export function classifyUpdate(currentCommit, latestCommit) {
  if (!/^[0-9a-f]{40}$/i.test(currentCommit)) return 'invalid'
  if (!/^[0-9a-f]{40}$/i.test(latestCommit)) return 'invalid'
  return currentCommit.toLowerCase() === latestCommit.toLowerCase() ? 'current' : 'available'
}

/** Reject legacy namespaces and literal credential-like values in generated data. */
export function containsUnsafeGeneratedLiteral(text) {
  return /@deepseek-ai\//i.test(text)
    || /(?:api[_-]?key|bearer|secret|token)\s*:\s*[^$!\s][^\r\n]*/i.test(text)
}

function command(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error !== undefined) {
    if (result.error.code === 'ENOENT') throw new Error(`${bin} was not found on PATH`)
    throw result.error
  }
  if ((result.status ?? 1) !== 0) {
    const diagnostic = [result.stderr, result.stdout]
      .filter(value => typeof value === 'string')
      .map(value => value.trim())
      .find(value => value.length > 0) ?? ''
    throw new Error(`${bin} ${args.join(' ')} failed${diagnostic.length > 0 ? `: ${redact(diagnostic)}` : ''}`)
  }
  return typeof result.stdout === 'string' ? result.stdout.trim() : ''
}

function redact(text) {
  let result = text
  for (const value of Object.values(process.env)) {
    if (typeof value === 'string' && value.length >= 8) result = result.split(value).join('[REDACTED]')
  }
  return result
}

function git(args, cwd) {
  return command('git', args, { cwd })
}

function dshHome() {
  const configured = process.env.DSH_HOME?.trim()
  if (configured) return resolve(configured)
  const home = process.env.USERPROFILE?.trim() || process.env.HOME?.trim()
  if (!home) throw new Error('DSH_HOME or a Windows user home is required')
  return resolve(home, '.dsh')
}

function updateStatePath(home) {
  return join(home, 'phoenix-upstream-update.json')
}

function stagingBase(home) {
  const configured = process.env.PHOENIX_UPSTREAM_UPDATE_TEMP?.trim()
  if (configured) return resolve(configured)
  if (process.platform === 'win32') return join(parse(home).root, 'phoenix-upstream-stage')
  return join(tmpdir(), 'phoenix-upstream-stage')
}

function transactionJournalPath(home) {
  return join(home, 'phoenix-upstream-transaction.json')
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function readJson(path) {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`invalid JSON state at ${path}`)
  }
}

function readProviderState(home, key) {
  const provider = PROVIDERS[key]
  const path = join(home, provider.stateRelative)
  const state = readJson(path)
  if (state === undefined) return { status: 'not-configured', path }
  if (state.schema !== 1 || typeof state.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(state.sourceCommit)) {
    throw new Error(`${provider.label} state is malformed at ${path}`)
  }
  if (state.sourceRepository !== provider.sourceRepository) {
    throw new Error(`${provider.label} state points to an unexpected source`)
  }
  return { status: 'configured', path, state, commit: state.sourceCommit.toLowerCase() }
}

function bridgeCommand(args, home) {
  const sourceBin = join(ROOT, 'apps', 'cli', 'src', 'bin.ts')
  const builtBin = join(ROOT, 'apps', 'cli', 'lib', 'bin.js')
  if (existsSync(sourceBin)) return [process.execPath, ['--import', 'tsx/esm', sourceBin, ...args]]
  if (existsSync(builtBin)) return [process.execPath, [builtBin, ...args]]
  throw new Error('PHOENIX CLI entrypoint is missing')
}

function runBridge(args, home) {
  const [bin, commandArgs] = bridgeCommand(args, home)
  return command(bin, commandArgs, { cwd: ROOT, env: { ...process.env, DSH_HOME: home } })
}

function fetchHead(provider) {
  return parseRemoteHead(git(['ls-remote', provider.sourceRepository, `refs/heads/${provider.sourceBranch}`], ROOT))
}

function inspect(home) {
  const providers = {}
  let initialized = 0
  for (const key of Object.keys(PROVIDERS)) {
    const local = readProviderState(home, key)
    if (local.status === 'not-configured') {
      providers[key] = { status: 'not-configured' }
      continue
    }
    initialized += 1
    const latestCommit = fetchHead(PROVIDERS[key])
    providers[key] = {
      status: classifyUpdate(local.commit, latestCommit),
      currentCommit: local.commit,
      latestCommit,
    }
  }
  return {
    status: initialized === 0
      ? 'not-configured'
      : Object.values(providers).some(provider => provider.status === 'available') ? 'available' : 'current',
    providers,
  }
}

function seedState(stageHome, liveHome, key) {
  const provider = PROVIDERS[key]
  const source = join(liveHome, provider.stateRelative)
  if (!existsSync(source)) return
  const target = join(stageHome, provider.stateRelative)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, readFileSync(source))
}

function candidateFiles(stageHome, key) {
  const provider = PROVIDERS[key]
  const statePath = join(stageHome, provider.stateRelative)
  const state = readJson(statePath)
  if (state === undefined) throw new Error(`${provider.label} candidate did not produce a state file`)
  if (state.schema !== 1 || state.sourceRepository !== provider.sourceRepository) {
    throw new Error(`${provider.label} candidate produced an invalid state identity`)
  }
  if (typeof state.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(state.sourceCommit)) {
    throw new Error(`${provider.label} candidate produced an invalid source commit`)
  }
  const generated = [statePath]
  if (key === 'codex') generated.push(join(stageHome, 'codex', 'enabled.patch.yml'))
  for (const path of generated) {
    if (existsSync(path) && containsUnsafeGeneratedLiteral(readFileSync(path, 'utf8'))) {
      throw new Error(`${provider.label} candidate contains a legacy namespace or literal credential`)
    }
  }
  return state
}

function stage(home, inspection, id) {
  const stageHome = join(stagingBase(home), id)
  rmSync(stageHome, { recursive: true, force: true })
  mkdirSync(stageHome, { recursive: true })
  const changed = []
  try {
    for (const [key, result] of Object.entries(inspection.providers)) {
      if (result.status !== 'available') continue
      const provider = PROVIDERS[key]
      seedState(stageHome, home, key)
      runBridge(provider.bridgeArgs, stageHome)
      runBridge(provider.verifyArgs, stageHome)
      const candidate = candidateFiles(stageHome, key)
      if (candidate.sourceCommit.toLowerCase() !== result.latestCommit.toLowerCase()) {
        const refreshedCommit = fetchHead(provider)
        if (candidate.sourceCommit.toLowerCase() !== refreshedCommit.toLowerCase()) {
          throw new Error(`${provider.label} advanced during staging; candidate ${candidate.sourceCommit} is behind ${refreshedCommit}`)
        }
        result.latestCommit = refreshedCommit
      }
      changed.push({ key, previous: readProviderState(home, key).state, candidate })
    }
    return { stageHome, changed }
  } catch (error) {
    throw new Error(`staging failed; live bridges were left untouched: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function managedSkills(state) {
  return Array.isArray(state?.managedSkills) ? state.managedSkills.filter(value => typeof value === 'string') : []
}

/** Build the ordered rename operations used by the activation transaction. */
export function buildActivationPlan(home, stageHome, backupRoot, changed) {
  const operations = []
  const add = (kind, from, to) => {
    if (existsSync(from)) operations.push({ kind, from, to, state: 'pending' })
  }
  for (const item of changed) {
    const provider = PROVIDERS[item.key]
    const liveRoot = join(home, provider.rootRelative)
    const candidateRoot = join(stageHome, provider.rootRelative)
    const backupRootForProvider = join(backupRoot, provider.rootRelative)
    if (!existsSync(candidateRoot)) throw new Error(`${provider.label} candidate root is missing`)
    add('provider-backup', liveRoot, backupRootForProvider)
    operations.push({ kind: 'provider-activate', from: candidateRoot, to: liveRoot, state: 'pending' })

    const previous = new Set(managedSkills(item.previous))
    const next = new Set(managedSkills(item.candidate))
    const all = [...new Set([...previous, ...next])].sort()
    const skillBackups = []
    const skillActivations = []
    for (const name of all) {
      const prefix = item.key === 'codex' ? 'codex-' : 'openclaw-'
      if (!new RegExp(`^${prefix}[a-z0-9-]+(?:\\.md)?$`).test(name)) throw new Error(`unsafe managed skill path ${JSON.stringify(name)}`)
      const live = join(home, 'skills', name)
      const candidate = join(stageHome, 'skills', name)
      const backup = join(backupRoot, 'skills', item.key, name)
      if (existsSync(live)) skillBackups.push({ kind: 'skill-backup', from: live, to: backup, state: 'pending' })
      if (next.has(name)) {
        if (!existsSync(candidate)) throw new Error(`${provider.label} candidate skill is missing: ${name}`)
        skillActivations.push({ kind: 'skill-activate', from: candidate, to: live, state: 'pending' })
      }
    }
    operations.push(...skillBackups, ...skillActivations)
  }
  return operations
}

function writeJournal(path, journal) {
  writeJson(path, journal)
}

async function renameWithRetry(from, to) {
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      renameSync(from, to)
      return
    } catch (error) {
      lastError = error
      const code = error?.code
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(code) || attempt === 4) throw error
      await sleep(250 * (attempt + 1))
    }
  }
  throw lastError
}

async function rollbackJournal(journal, path) {
  const operations = [...journal.operations].reverse()
  for (const operation of operations) {
    if (operation.state === 'pending') continue
    if (!existsSync(operation.to) || existsSync(operation.from)) continue
    mkdirSync(dirname(operation.from), { recursive: true })
    await renameWithRetry(operation.to, operation.from)
    operation.state = 'rolled-back'
    writeJournal(path, journal)
  }
}

async function recoverTransaction(home) {
  const path = transactionJournalPath(home)
  const journal = readJson(path)
  if (journal === undefined || journal.status === 'completed' || journal.status === 'rolled-back') return
  if (!Array.isArray(journal.operations)) throw new Error('upstream transaction journal is malformed')
  journal.status = 'rolling-back'
  writeJournal(path, journal)
  await rollbackJournal(journal, path)
  journal.status = 'rolled-back'
  journal.recoveredAt = new Date().toISOString()
  writeJournal(path, journal)
}

async function activate(home, stageHome, changed, id) {
  const transactionRoot = join(home, '.phoenix-upstream-updates', id)
  const backupRoot = join(transactionRoot, 'backup')
  const journalPath = transactionJournalPath(home)
  const operations = buildActivationPlan(home, stageHome, backupRoot, changed)
  const journal = {
    schema: 1,
    id,
    status: 'activating',
    startedAt: new Date().toISOString(),
    operations,
  }
  writeJournal(journalPath, journal)
  try {
    for (const operation of operations) {
      operation.state = 'in-flight'
      writeJournal(journalPath, journal)
      mkdirSync(dirname(operation.to), { recursive: true })
      await renameWithRetry(operation.from, operation.to)
      operation.state = 'done'
      writeJournal(journalPath, journal)
    }
    for (const item of changed) runBridge(PROVIDERS[item.key].verifyArgs, home)
    journal.status = 'completed'
    journal.completedAt = new Date().toISOString()
    writeJournal(journalPath, journal)
    rmSync(stageHome, { recursive: true, force: true })
  } catch (error) {
    journal.status = 'rolling-back'
    journal.error = redact(error instanceof Error ? error.message : String(error))
    writeJournal(journalPath, journal)
    try {
      await rollbackJournal(journal, journalPath)
      journal.status = 'rolled-back'
      journal.rolledBackAt = new Date().toISOString()
      writeJournal(journalPath, journal)
    } catch (rollbackError) {
      journal.status = 'recovery-required'
      journal.rollbackError = redact(rollbackError instanceof Error ? rollbackError.message : String(rollbackError))
      writeJournal(journalPath, journal)
      throw new Error(`activation failed and rollback needs recovery: ${journal.rollbackError}`)
    }
    throw new Error(`activation failed and was rolled back: ${journal.error}`)
  }
}

function saveState(home, state) {
  writeJson(updateStatePath(home), { schema: STATE_SCHEMA, ...state, checkedAt: new Date().toISOString() })
}

function outputInspection(inspection, quiet) {
  if (quiet && inspection.status !== 'available') return
  for (const [key, provider] of Object.entries(inspection.providers)) {
    const label = PROVIDERS[key].label
    if (provider.status === 'not-configured') process.stdout.write(`INFO ${label}: not configured; automatic intake is idle.\n`)
    else process.stdout.write(`${provider.status === 'available' ? 'UPDATE' : 'PASS'} ${label}: ${provider.currentCommit.slice(0, 12)}${provider.latestCommit ? ` -> ${provider.latestCommit.slice(0, 12)}` : ''}\n`)
  }
}

async function cycle(home, mode, options = {}) {
  const quiet = options.quiet === true
  if (mode === 'off') {
    saveState(home, { mode, status: 'off', providers: {} })
    return 0
  }
  try {
    await recoverTransaction(home)
    const inspection = inspect(home)
    outputInspection(inspection, quiet)
    if (inspection.status !== 'available') {
      saveState(home, { mode, status: inspection.status, providers: inspection.providers })
      return 0
    }
    saveState(home, { mode, status: 'available', providers: inspection.providers })
    if (mode === 'notify' || options.apply !== true) return 0
    const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
    const candidate = stage(home, inspection, id)
    await activate(home, candidate.stageHome, candidate.changed, id)
    saveState(home, { mode, status: 'applied', transactionId: id, providers: inspection.providers })
    if (!quiet) process.stdout.write(`PASS Codex/OpenClaw upstream update activated transaction ${id}.\n`)
    return 0
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error))
    saveState(home, { mode, status: 'blocked', error: message })
    if (!quiet) process.stderr.write(`BLOCKED upstream update: ${message}\n`)
    return 1
  }
}

async function localDoctor(home, mode) {
  let failures = 0
  try {
    await recoverTransaction(home)
    for (const key of Object.keys(PROVIDERS)) {
      const state = readProviderState(home, key)
      if (state.status === 'not-configured') process.stdout.write(`INFO ${PROVIDERS[key].label}: not configured\n`)
      else process.stdout.write(`PASS ${PROVIDERS[key].label}: ${state.commit.slice(0, 12)}\n`)
    }
  } catch (error) {
    failures += 1
    process.stdout.write(`FAIL ${error instanceof Error ? error.message : String(error)}\n`)
  }
  process.stdout.write(`PHOENIX upstream update mode: ${mode}\n`)
  return failures === 0 ? 0 : 1
}

function parentAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function pollInterval() {
  const value = Number(process.env.PHOENIX_UPSTREAM_UPDATE_POLL_MS ?? DEFAULT_POLL_MS)
  if (!Number.isFinite(value)) return DEFAULT_POLL_MS
  return Math.max(MIN_POLL_MS, Math.floor(value))
}

function sleep(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

async function watch(home, mode, parentPid) {
  while (parentAlive(parentPid)) {
    await cycle(home, mode, { apply: mode === 'auto', quiet: true })
    await sleep(pollInterval())
  }
}

function printHelp() {
  process.stdout.write('PHOENIX upstream update intake\n\nCommands:\n  dsh upstream-update --check\n  dsh upstream-update --apply\n  dsh upstream-update --doctor\n\nEnvironment:\n  PHOENIX_UPSTREAM_UPDATE_MODE=auto|notify|off\n  PHOENIX_UPSTREAM_UPDATE_POLL_MS=milliseconds (minimum 30000)\n\nUpdates are fetched from official Codex plugins and OpenClaw skills sources, staged, verified, and activated transactionally.\n')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    printHelp()
    return 0
  }
  const mode = normalizeMode(process.env.PHOENIX_UPSTREAM_UPDATE_MODE ?? 'auto')
  const home = dshHome()
  if (args.includes('--doctor')) return await localDoctor(home, mode)
  if (args.includes('--watch')) {
    const index = args.indexOf('--parent-pid')
    const parentPid = Number(index >= 0 ? args[index + 1] : NaN)
    if (!Number.isInteger(parentPid) || parentPid <= 0) throw new Error('--watch requires --parent-pid <pid>')
    await watch(home, mode, parentPid)
    return 0
  }
  if (args.includes('--apply')) return await cycle(home, mode, { apply: true })
  return await cycle(home, mode, { apply: false })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(code => process.exitCode = code).catch(error => {
    process.stderr.write(`PHOENIX upstream update: ${redact(error instanceof Error ? error.message : String(error))}\n`)
    process.exitCode = 1
  })
}
