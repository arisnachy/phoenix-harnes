/**
 * Phoenix Game Studio: durable production controller.
 *
 * Design -> playable vertical slice -> asset production -> runtime integration
 * -> independent QA -> distributable candidate.
 *
 * This module schedules real work, not AI conversations. A recorded file proves
 * that bytes existed at recording time, NEVER that gameplay or sound was tested.
 */
import { createHash } from 'node:crypto'
import { open, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { planGameAssets } from './plan-game-assets.mjs'

const STEPS = Object.freeze([
  { id: 'design', description: 'Game design document, world, story, cast, mechanics and acceptance criteria',
    checks: ['gdd', 'roster-and-levels'] },
  { id: 'vertical-slice', description: 'One playable section validates controls, physics and the core loop',
    checks: ['playable-build', 'core-loop-test'] },
  { id: 'asset-production', description: 'Produce original, consistent assets against the approved art bible',
    checks: ['visual-assets', 'audio-assets'] },
  { id: 'integration', description: 'Bind each required asset to scenes, states and runtime triggers',
    checks: ['runtime-bindings', 'integrated-build'] },
  { id: 'gameplay-qa', description: 'Play through, observe, listen, test regressions and repair',
    checks: ['complete-playthrough', 'visual-review', 'audio-review', 'regression', 'performance'] },
  { id: 'publication', description: 'Package the game and audit ownership/licensing',
    checks: ['distributable', 'license-audit'] },
])

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const valid = value => typeof value === 'string' && value.trim().length > 0
const phaseId = phase => STEPS.findIndex(step => step.id === phase)
const inside = (root, path) => {
  const child = relative(root, path)
  return child !== '' && child !== '..' && !child.startsWith('../')
    && !child.startsWith('..\\') && !isAbsolute(child)
}
const project = (stateFile, artifact) => {
  const base = dirname(resolve(stateFile))
  const candidate = resolve(base, artifact)
  if (!inside(base, candidate)) throw new Error('Evidence must be a file inside the game project')
  return candidate
}

function stageDefinitions(manifest) {
  const genre = String(manifest.gameType || manifest.genre || '').toLowerCase()
  const action = /platform|shooter|run.and.gun|beat.em.up|brawler|rpg|fighting|action/u.test(genre)
  const sound = action || (Array.isArray(manifest.audio?.cues) && manifest.audio.cues.length > 0)
    || (Array.isArray(manifest.audio?.tracks) && manifest.audio.tracks.length > 0)
  return STEPS.map((step, i) => {
    let checks = [...step.checks]
    if (!sound) checks = checks.filter(x => x !== 'audio-assets' && x !== 'audio-review')
    if (!action && step.id === 'design') checks = checks.filter(x => x !== 'roster-and-levels').concat('rules-and-levels')
    return { id: step.id, description: step.description, dependsOn: i ? [STEPS[i - 1].id] : [],
      checks, evidence: [], status: 'pending' }
  })
}

/** Create an honest, recoverable plan; this does not claim to make the game. */
export function initializeGameProduction(manifest, manifestPath, stateFile) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || !valid(manifest.title) || !valid(manifest.genre)) {
    throw new Error('A game manifest with title and genre is required')
  }
  const assetPlan = planGameAssets(manifest)
  return { schemaVersion: 1, manifestPath: resolve(manifestPath), manifestSha256: hash(JSON.stringify(manifest)),
    title: manifest.title, genre: manifest.genre, stateFile: resolve(stateFile),
    stages: stageDefinitions(manifest), assets: assetPlan.tasks.map(task => ({
      family: task.family, id: task.id, status: task.status, owner: task.owner,
      required: task.animations,
    })), designGaps: assetPlan.missingDesignDecisions,
    releaseCertified: false, releaseState: 'not-ready',
    warning: 'Proof files and checksums are not independent gameplay, visual or audio certification.' }
}

/** Dependency ordering and pending work remain stable on repeated calls. */
export function nextGameWork(state) {
  const ready = state.stages.find(step => step.status !== 'complete'
    && step.dependsOn.every(id => state.stages.find(other => other.id === id)?.status === 'complete'))
  if (!ready) {
    return { stage: null, state: 'candidate-awaiting-independent-review',
      releaseCertified: false }
  }
  const verified = new Set(ready.evidence.map(item => item.check))
  return { stage: ready.id, description: ready.description,
    remainingChecks: ready.checks.filter(check => !verified.has(check)),
    evidence: ready.evidence.length,
    assetTasks: ready.id === 'asset-production' ? state.assets : undefined,
    designGaps: ready.id === 'design' ? state.designGaps : undefined,
    action: 'Create or reuse the deliverable, execute its corresponding real test, then record evidence.' }
}

async function verifyArtifacts(state) {
  for (const stage of state.stages) for (const item of stage.evidence) {
    const path = project(state.stateFile, item.artifact)
    const checked = await realpath(path)
    if (!inside(dirname(state.stateFile), checked)) throw new Error('Evidence escapes the project: ' + item.artifact)
    const bytes = await readFile(checked)
    if (hash(bytes) !== item.sha256) {
      throw new Error('Evidence changed: ' + item.artifact + '. Invalidate its stage and rerun checks.')
    }
    for (const dependency of item.dependencies || []) {
      const actual = await realpath(project(state.stateFile, dependency.artifact))
      if (!inside(dirname(state.stateFile), actual)
        || hash(await readFile(actual)) !== dependency.sha256) {
        throw new Error('Bound resource changed: ' + dependency.artifact + '. Invalidate integration.')
      }
    }
  }
}
async function loadState(stateFile) {
  const parsed = JSON.parse(await readFile(stateFile, 'utf8'))
  if (parsed.schemaVersion !== 1 || resolve(parsed.stateFile) !== resolve(stateFile)
    || !Array.isArray(parsed.stages) || !valid(parsed.manifestPath)) {
    throw new Error('Invalid or relocated production state')
  }
  const manifest = JSON.parse(await readFile(parsed.manifestPath, 'utf8'))
  if (hash(JSON.stringify(manifest)) !== parsed.manifestSha256) {
    throw new Error('Manifest changed; regenerate the production plan before continuing.')
  }
  await verifyArtifacts(parsed)
  return parsed
}
async function saveState(path, state, create = false) {
  const lockPath = path + '.lock'
  let lock
  try {
    lock = await open(lockPath, 'wx')
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Production state is locked by another writer')
    throw error
  }
  const temp = path + '.tmp-' + process.pid
  try {
    if (create) {
      try {
        await stat(path)
        throw new Error('Production state already exists; use next/status to resume')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    await writeFile(temp, JSON.stringify(state, null, 2) + '\n', 'utf8')
    await rename(temp, path)
  } finally {
    await unlink(temp).catch(() => {})
    await lock.close()
    await unlink(lockPath)
  }
}

/**
 * Integration gate: a preset counts only after its real runtime usage is traced.
 * Production must provide a complete bindings JSON; a list of file names is not
 * proof of actual drawing, state activation, spawn or sound playback.
 */
async function inspectRuntimeBindings(state, artifact) {
  const report = JSON.parse(await readFile(artifact, 'utf8'))
  if (!Array.isArray(report.bindings)) throw new Error('Runtime evidence needs a bindings array')
  const used = new Set()
  const dependencies = []
  for (const task of state.assets) {
    const key = task.family + ':' + task.id
    if (used.has(key)) throw new Error('Duplicate required asset in production plan: ' + key)
    used.add(key)
    const match = report.bindings.filter(x => x && x.family === task.family && x.id === task.id)
    if (match.length !== 1) throw new Error('Missing or duplicate runtime binding: ' + key)
    const entry = match[0]
    if (!valid(entry.source) || !valid(entry.runtimeTarget) || !valid(entry.proof)
      || !Number.isInteger(entry.observedCount) || entry.observedCount < 1) {
      throw new Error('No executed scene/draw/play trace for asset ' + key)
    }
    for (const name of [entry.source, entry.proof]) {
      const location = project(state.stateFile, name)
      const actual = await realpath(location)
      if (!inside(dirname(state.stateFile), actual)) throw new Error('Binding file escapes project: ' + name)
      if (!(await stat(actual)).isFile()) throw new Error('Binding dependency is not a file: ' + name)
      const bytes = await readFile(actual)
      if (!bytes.length) throw new Error('Binding dependency is empty: ' + name)
      dependencies.push({ artifact: relative(dirname(state.stateFile), actual), sha256: hash(bytes) })
    }
  }
  return dependencies.filter((item, i) => dependencies.findIndex(other => other.artifact === item.artifact) === i)
}

/** Record file-backed evidence only for the current stage, never skip ahead. */
export async function recordGameEvidence(state, stageId, check, artifact, runner) {
  const expected = nextGameWork(state)
  if (expected.stage !== stageId) throw new Error('Only current stage ' + expected.stage + ' may be updated')
  const stage = state.stages.find(x => x.id === stageId)
  if (!stage.checks.includes(check)) throw new Error('Unknown check for ' + stageId + ': ' + check)
  if (!valid(runner)) throw new Error('A real runner or reviewer must be identified')
  const path = project(state.stateFile, artifact)
  const actual = await realpath(path)
  if (!inside(dirname(state.stateFile), actual)) throw new Error('Evidence symlinks cannot escape the game project')
  if (!(await stat(actual)).isFile()) throw new Error('Evidence must be a regular file')
  const bytes = await readFile(actual)
  if (!bytes.length) throw new Error('Evidence file is empty')
  const checksum = hash(bytes)
  const dependencies = check === 'runtime-bindings' ? await inspectRuntimeBindings(state, actual) : []
  const existing = stage.evidence.find(item => item.check === check)
  if (existing) {
    if (existing.artifact === relative(dirname(state.stateFile), path)
      && existing.sha256 === checksum && existing.runner === runner) return state
    throw new Error('Conflicting evidence for ' + check + '; invalidate and retest')
  }
  stage.evidence.push({ check, artifact: relative(dirname(state.stateFile), path),
    runner, sha256: checksum, dependencies, validation: 'existence-and-integrity-only' })
  if (stage.checks.every(id => stage.evidence.some(item => item.check === id))) stage.status = 'complete'
  if (state.stages.every(item => item.status === 'complete')) {
    state.releaseState = 'candidate-awaiting-independent-review'
  }
  // Approval requires actual observation and separate human/QA signoff.
  state.releaseCertified = false
  return state
}

/** A failed regression removes the stage and all dependent evidence. */
export function invalidateGameStage(state, stageId, reason) {
  const index = phaseId(stageId)
  if (index < 0 || !valid(reason)) throw new Error('Valid stage and failure reason required')
  for (const stage of state.stages.slice(index)) {
    stage.status = 'pending'
    stage.evidence = []
  }
  state.releaseState = 'not-ready'
  state.releaseCertified = false
  state.lastFailure = { stage: stageId, reason }
  return state
}

async function main(args) {
  const [operation, ...values] = args
  if (operation === 'init' && values.length === 2) {
    const [manifestPath, stateFile] = values.map(resolve)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const state = initializeGameProduction(manifest, manifestPath, stateFile)
    await saveState(stateFile, state, true)
    return nextGameWork(state)
  }
  if (['status', 'next'].includes(operation) && values.length === 1) {
    const state = await loadState(resolve(values[0]))
    return operation === 'status'
      ? { title: state.title, stages: state.stages.map(x => ({ id: x.id, status: x.status,
        done: x.evidence.length, total: x.checks.length })), releaseState: state.releaseState,
        releaseCertified: false, next: nextGameWork(state) }
      : nextGameWork(state)
  }
  if (operation === 'record' && values.length === 5) {
    const [stateFile, stage, check, artifact, runner] = values
    const path = resolve(stateFile)
    const state = await loadState(path)
    await recordGameEvidence(state, stage, check, artifact, runner)
    await saveState(path, state)
    return nextGameWork(state)
  }
  if (operation === 'invalidate' && values.length === 3) {
    const [stateFile, stage, reason] = values
    const path = resolve(stateFile)
    const state = await loadState(path)
    invalidateGameStage(state, stage, reason)
    await saveState(path, state)
    return nextGameWork(state)
  }
  throw new Error('Usage: production-engine.mjs init MANIFEST STATE | next STATE | status STATE | record STATE STAGE CHECK ARTIFACT RUNNER | invalidate STATE STAGE REASON')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  }).catch(error => {
    process.stderr.write(JSON.stringify({ state: 'blocked', error: String(error.message || error) }) + '\n')
    process.exitCode = 1
  })
}
