#!/usr/bin/env node
/**
 * Plan and explicitly apply bounded retention for the isolated OpenClaw
 * runtime. Only managed version, Node, artifact, and opt-in npm-cache paths
 * are eligible; Phoenix state, OpenClaw state, credentials, and markers stay
 * outside the deletion allowlist.
 */

import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'

const SCHEMA = 1
const RUNTIME_DIRECTORY = 'openclaw-runtime'
const ROOT_NAMES = Object.freeze({
  versions: 'versions',
  node: 'node',
  artifacts: 'artifacts',
  npmCache: 'npm-cache',
})
const MARKERS = Object.freeze(['active', 'previous', 'candidate'])
const VERSION_NAME = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u
const STAGING_NAME = /^\.staging-[0-9A-Za-z._-]+$/u
const NODE_NAME = /^node-v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?-win-x64$/u
const OPENCLAW_ARTIFACT_NAME = /^openclaw-\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\.tgz$/u
const NODE_ARTIFACT_NAME = /^node-v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?-win-x64\.zip$/u

function requireHome(home) {
  const value = home ?? process.env.DSH_HOME
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('home or DSH_HOME is required')
  return resolve(value)
}

function pathKey(path) {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isWithin(root, target) {
  const child = relative(resolve(root), resolve(target))
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

function directChild(parent, target) {
  const child = relative(resolve(parent), resolve(target))
  return child !== '' && !child.startsWith('..') && !isAbsolute(child)
    && child.split(/[\\/]+/u).length === 1
}

function readJson(path) {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) return { error: 'marker-is-not-a-regular-file' }
    return { value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { absent: true }
    return { error: 'marker-is-invalid' }
  }
}

function unsafeLink(stat, path) {
  // On Windows, directory junctions are reported as symbolic links by lstat.
  // Inspecting with lstat before every traversal prevents following either a
  // POSIX link or a Windows reparse point into an unmanaged tree.
  if (stat.isSymbolicLink()) return true
  if (process.platform !== 'win32' || !stat.isDirectory()) return false
  try {
    readlinkSync(path)
    return true
  } catch (error) {
    if (['EINVAL', 'ENOTSUP', 'UNKNOWN'].includes(error?.code)) return false
    return true
  }
}

function safeDirectoryAncestors(home, issues) {
  const absoluteHome = resolve(home)
  let current = absoluteHome
  let valid = true
  while (true) {
    const stat = statPath(current)
    if (stat === undefined) {
      issues.push(issue('runtime-home-or-ancestor-missing', current))
      valid = false
    } else {
      if (unsafeLink(stat, current)) {
        issues.push(issue('runtime-home-or-ancestor-is-symlink-or-reparse', current))
        valid = false
      }
      if (!stat.isDirectory()) {
        issues.push(issue('runtime-home-or-ancestor-is-not-a-directory', current))
        valid = false
      }
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return valid
}

function markerRevisionSnapshot(root) {
  const revisions = {}
  for (const marker of MARKERS) {
    const path = markerPath(root, marker)
    const stat = statPath(path)
    if (stat === undefined) {
      revisions[marker] = { exists: false }
      continue
    }
    if (unsafeLink(stat, path) || !stat.isFile()) {
      revisions[marker] = { exists: true, safe: false }
      continue
    }
    try {
      const bytes = readFileSync(path)
      revisions[marker] = {
        exists: true,
        safe: true,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }
    } catch {
      revisions[marker] = { exists: true, safe: false }
    }
  }
  return revisions
}

function sameSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function issue(code, path, detail) {
  return { code, ...(path === undefined ? {} : { path }), ...(detail === undefined ? {} : { detail }) }
}

function markerPath(root, marker) {
  return join(root, `${marker}.json`)
}

function markerStatus(value) {
  return typeof value?.status === 'string' ? value.status : undefined
}

function addRetained(retained, path, reason) {
  const absolute = resolve(path)
  const key = pathKey(absolute)
  const existing = retained.get(key)
  if (existing === undefined) {
    retained.set(key, { path: absolute, reasons: [reason] })
    return
  }
  if (!existing.reasons.includes(reason)) existing.reasons.push(reason)
}

function inspectMarker(root, marker, retained, issues, versionsToKeep) {
  const markerFile = markerPath(root, marker)
  const parsed = readJson(markerFile)
  if (parsed.absent) return { present: false }
  if (parsed.error !== undefined || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    issues.push(issue(parsed.error ?? 'marker-is-invalid', markerFile))
    return { present: true, valid: false }
  }

  const value = parsed.value
  const status = markerStatus(value)
  const references = [
    ['runtimePath', ROOT_NAMES.versions, 'runtime'],
    ['nodePath', ROOT_NAMES.node, 'node'],
    ['artifactPath', ROOT_NAMES.artifacts, 'artifact'],
  ]
  if (status !== undefined && status !== 'none') {
    for (const [field] of references) {
      if (typeof value[field] !== 'string') issues.push(issue('marker-reference-missing', markerFile, `${marker}.${field}`))
    }
  }

  for (const [field, rootName, kind] of references) {
    const raw = value[field]
    if (raw === undefined) continue
    if (typeof raw !== 'string' || !isAbsolute(raw)) {
      issues.push(issue('marker-path-is-not-absolute', markerFile, field))
      continue
    }
    const target = resolve(raw)
    const managedRoot = join(root, rootName)
    if (!isWithin(root, target) || !isWithin(managedRoot, target)) {
      issues.push(issue('marker-path-outside-runtime-root', target, `${marker}.${field}`))
      continue
    }
    const targetStat = statPath(target)
    if (targetStat !== undefined && unsafeLink(targetStat, target)) {
      issues.push(issue('marker-path-is-symlink-or-reparse', target, `${marker}.${field}`))
      continue
    }
    if (kind === 'runtime' || kind === 'artifact') {
      if (!directChild(managedRoot, target)) {
        issues.push(issue('marker-path-must-be-managed-child', target, `${marker}.${field}`))
        continue
      }
      addRetained(retained, target, `${marker}.${field}`)
    } else {
      const nodeRelative = relative(managedRoot, target)
      const [nodeName] = nodeRelative.split(/[\\/]+/u)
      const nodeTarget = join(managedRoot, nodeName ?? '')
      if (!NODE_NAME.test(nodeName ?? '') || !isWithin(managedRoot, nodeTarget) || !directChild(managedRoot, nodeTarget)) {
        issues.push(issue('marker-node-path-must-be-managed-child', target, `${marker}.${field}`))
        continue
      }
      addRetained(retained, nodeTarget, `${marker}.${field}`)
    }
  }

  if (typeof value.version === 'string' && VERSION_NAME.test(value.version)) {
    versionsToKeep.add(value.version)
    addRetained(retained, join(root, ROOT_NAMES.artifacts, `openclaw-${value.version}.tgz`), `${marker}.version`)
  }
  return { present: true, valid: true, status }
}

function statPath(path) {
  try { return lstatSync(path) } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

function walkSafe(root, target, issues) {
  const absoluteRoot = resolve(root)
  const absoluteTarget = resolve(target)
  if (!isAbsolute(target) || !isWithin(absoluteRoot, absoluteTarget)) {
    issues.push(issue('delete-target-outside-runtime-root', absoluteTarget))
    return false
  }
  const stat = statPath(absoluteTarget)
  if (stat === undefined) return true
  if (unsafeLink(stat, absoluteTarget)) {
    issues.push(issue('delete-target-is-symlink-or-reparse', absoluteTarget))
    return false
  }
  if (!stat.isDirectory()) return true
  let entries
  try { entries = readdirSync(absoluteTarget, { withFileTypes: true }) } catch (error) {
    issues.push(issue('delete-target-cannot-be-read', absoluteTarget, error?.code ?? 'read-failed'))
    return false
  }
  for (const entry of entries) {
    const child = join(absoluteTarget, entry.name)
    if (!isWithin(absoluteRoot, child)) {
      issues.push(issue('delete-target-child-outside-runtime-root', child))
      return false
    }
    const childStat = statPath(child)
    if (childStat === undefined) continue
    if (unsafeLink(childStat, child)) {
      issues.push(issue('delete-target-contains-symlink-or-reparse', child))
      return false
    }
    if (childStat.isDirectory() && !walkSafe(absoluteRoot, child, issues)) return false
  }
  return true
}

function inspectManagedRoot(runtimeRoot, rootName, matcher, retained, targets, issues, skipped, { allowStaging = true } = {}) {
  const managedRoot = join(runtimeRoot, rootName)
  const managedStat = statPath(managedRoot)
  if (managedStat === undefined) return
  if (unsafeLink(managedStat, managedRoot)) {
    issues.push(issue('managed-root-is-symlink-or-reparse', managedRoot))
    return
  }
  if (!managedStat.isDirectory()) {
    issues.push(issue('managed-root-is-not-a-directory', managedRoot))
    return
  }

  let entries
  try { entries = readdirSync(managedRoot, { withFileTypes: true }) } catch (error) {
    issues.push(issue('managed-root-cannot-be-read', managedRoot, error?.code ?? 'read-failed'))
    return
  }
  for (const entry of entries) {
    const target = join(managedRoot, entry.name)
    const targetStat = statPath(target)
    if (targetStat === undefined) continue
    if (unsafeLink(targetStat, target)) {
      issues.push(issue('managed-entry-is-symlink-or-reparse', target))
      continue
    }
    if (!matcher(entry.name, targetStat)) continue
    if (rootName === ROOT_NAMES.versions && STAGING_NAME.test(entry.name) && !allowStaging) {
      skipped.push({ path: resolve(target), reason: 'live-installer-or-runtime-lock-not-held' })
      continue
    }
    const key = pathKey(target)
    const retainedEntry = retained.get(key)
    if (retainedEntry !== undefined) {
      retainedEntry.reasons.sort()
      continue
    }
    if (!walkSafe(runtimeRoot, target, issues)) continue
    targets.push({ path: resolve(target), kind: rootName, reason: 'unreferenced-managed-install' })
  }
}

function sortEntries(entries) {
  return entries.sort((left, right) => left.path.localeCompare(right.path, 'en', { sensitivity: 'base' }))
}

/**
 * Build a dry-run retention plan for the isolated OpenClaw runtime.
 * @param {object} options
 * @param {string} [options.home] - DSH_HOME containing `openclaw-runtime`.
 * @param {boolean} [options.includeNpmCache=true] - Include the dedicated npm cache when it is a safe managed directory.
 * @param {boolean} [options.runtimeLockHeld=false] - The caller's shared OpenClaw runtime lock is held while planning.
 * @param {boolean} [options.installerBusy=false] - A live installer suppresses staging and npm-cache targets.
 * @returns {object} A secret-free plan. `status: blocked` is fail-closed and has no executable targets.
 */
export function planOpenClawRuntimeRetention({ home, includeNpmCache = true, runtimeLockHeld = false, installerBusy = false } = {}) {
  const resolvedHome = requireHome(home)
  const runtimeRoot = join(resolvedHome, RUNTIME_DIRECTORY)
  const retained = new Map()
  const versionsToKeep = new Set()
  const issues = []
  const targets = []
  const skipped = []
  const markerRevisionsBefore = markerRevisionSnapshot(runtimeRoot)
  if (basename(runtimeRoot) !== RUNTIME_DIRECTORY || pathKey(dirname(runtimeRoot)) !== pathKey(resolvedHome)) {
    issues.push(issue('runtime-root-must-be-openclaw-runtime-child', runtimeRoot))
  }
  safeDirectoryAncestors(resolvedHome, issues)
  const rootStat = statPath(runtimeRoot)
  if (rootStat !== undefined && unsafeLink(rootStat, runtimeRoot)) issues.push(issue('runtime-root-is-symlink-or-reparse', runtimeRoot))
  if (rootStat !== undefined && !rootStat.isDirectory()) issues.push(issue('runtime-root-is-not-a-directory', runtimeRoot))

  for (const marker of MARKERS) inspectMarker(runtimeRoot, marker, retained, issues, versionsToKeep)

  inspectManagedRoot(
    runtimeRoot,
    ROOT_NAMES.versions,
    (name, stat) => stat.isDirectory() && (VERSION_NAME.test(name) || STAGING_NAME.test(name)),
    retained,
    targets,
    issues,
    skipped,
    { allowStaging: runtimeLockHeld === true && installerBusy !== true },
  )
  inspectManagedRoot(
    runtimeRoot,
    ROOT_NAMES.node,
    (name, stat) => stat.isDirectory() && NODE_NAME.test(name),
    retained,
    targets,
    issues,
  )
  inspectManagedRoot(
    runtimeRoot,
    ROOT_NAMES.artifacts,
    (name, stat) => stat.isFile() && (OPENCLAW_ARTIFACT_NAME.test(name) || NODE_ARTIFACT_NAME.test(name)),
    retained,
    targets,
    issues,
  )

  for (const version of versionsToKeep) {
    const artifact = join(runtimeRoot, ROOT_NAMES.artifacts, `openclaw-${version}.tgz`)
    const artifactStat = statPath(artifact)
    if (artifactStat !== undefined && unsafeLink(artifactStat, artifact)) issues.push(issue('retained-artifact-is-symlink-or-reparse', artifact))
  }

  if (includeNpmCache === true) {
    const npmCache = join(runtimeRoot, ROOT_NAMES.npmCache)
    const npmStat = statPath(npmCache)
    if (npmStat !== undefined) {
      if (runtimeLockHeld !== true) skipped.push({ path: resolve(npmCache), reason: 'runtime-lock-not-held' })
      else if (installerBusy === true) skipped.push({ path: resolve(npmCache), reason: 'live-installer' })
      else if (unsafeLink(npmStat, npmCache)) issues.push(issue('npm-cache-is-symlink-or-reparse', npmCache))
      else if (!npmStat.isDirectory()) issues.push(issue('npm-cache-is-not-a-directory', npmCache))
      else if (walkSafe(runtimeRoot, npmCache, issues)) targets.push({ path: resolve(npmCache), kind: ROOT_NAMES.npmCache, reason: 'explicit-npm-cache-retention' })
    }
  }

  const markerRevisions = markerRevisionSnapshot(runtimeRoot)
  if (!sameSnapshot(markerRevisionsBefore, markerRevisions)) issues.push(issue('markers-changed-during-plan', runtimeRoot))
  const retainedEntries = sortEntries([...retained.values()].map((entry) => ({ path: entry.path, reasons: [...entry.reasons] })))
  const uniqueTargets = new Map()
  for (const target of targets) uniqueTargets.set(pathKey(target.path), target)
  const blocked = issues.length > 0
  return {
    schema: SCHEMA,
    status: blocked ? 'blocked' : 'ready',
    dryRun: true,
    home: resolvedHome,
    runtimeRoot,
    includeNpmCache: includeNpmCache === true,
    runtimeLockHeld: runtimeLockHeld === true,
    installerBusy: installerBusy === true,
    markerRevisions,
    retainedHeads: retainedEntries.map((entry) => entry.path),
    retained: retainedEntries,
    targets: blocked ? [] : sortEntries([...uniqueTargets.values()]),
    skipped,
    issues,
  }
}

function validPlan(plan) {
  return plan !== null && typeof plan === 'object' && plan.schema === SCHEMA
    && typeof plan.home === 'string' && isAbsolute(plan.home)
    && typeof plan.runtimeRoot === 'string' && isAbsolute(plan.runtimeRoot)
    && basename(plan.runtimeRoot) === RUNTIME_DIRECTORY
    && pathKey(dirname(plan.runtimeRoot)) === pathKey(plan.home)
    && plan.markerRevisions !== undefined
    && Array.isArray(plan.retainedHeads)
    && Array.isArray(plan.targets)
}

function targetKeys(targets) {
  return new Set(targets.map((entry) => pathKey(entry?.path ?? '')))
}

function sameTargetSet(left, right) {
  const a = targetKeys(left)
  const b = targetKeys(right)
  return a.size === b.size && [...a].every((key) => b.has(key))
}

function verifyDeleteTarget(runtimeRoot, item, issues) {
  if (item === null || typeof item !== 'object' || typeof item.path !== 'string' || !isAbsolute(item.path)) {
    issues.push(issue('delete-target-is-not-absolute', typeof item?.path === 'string' ? item.path : undefined))
    return undefined
  }
  const target = resolve(item.path)
  if (!isWithin(runtimeRoot, target) || target === resolve(runtimeRoot)) {
    issues.push(issue('delete-target-outside-runtime-root', target))
    return undefined
  }
  const runtimeStat = statPath(runtimeRoot)
  if (runtimeStat === undefined) {
    issues.push(issue('runtime-root-disappeared', runtimeRoot))
    return undefined
  }
  if (unsafeLink(runtimeStat, runtimeRoot) || !runtimeStat.isDirectory()) {
    issues.push(issue('runtime-root-is-symlink-or-reparse', runtimeRoot))
    return undefined
  }
  const relativeTarget = relative(runtimeRoot, target)
  const [rootName] = relativeTarget.split(/[\\/]+/u)
  if (![...Object.values(ROOT_NAMES)].includes(rootName)) {
    issues.push(issue('delete-target-not-in-allowlist', target))
    return undefined
  }
  const managedRoot = join(runtimeRoot, rootName)
  const managedStat = statPath(managedRoot)
  if (managedStat === undefined || unsafeLink(managedStat, managedRoot) || !managedStat.isDirectory()) {
    issues.push(issue('managed-root-is-not-safe', managedRoot))
    return undefined
  }
  const isNpmCacheRoot = rootName === ROOT_NAMES.npmCache && target === managedRoot
  if (!isNpmCacheRoot && !directChild(managedRoot, target)) {
    issues.push(issue('delete-target-must-be-managed-child', target))
    return undefined
  }
  const stat = statPath(target)
  const targetName = relative(managedRoot, target)
  const nameAllowed = rootName === ROOT_NAMES.versions
    ? (VERSION_NAME.test(targetName) || STAGING_NAME.test(targetName)) && (stat === undefined || stat.isDirectory())
    : rootName === ROOT_NAMES.node
      ? NODE_NAME.test(targetName) && (stat === undefined || stat.isDirectory())
      : rootName === ROOT_NAMES.artifacts
        ? (OPENCLAW_ARTIFACT_NAME.test(targetName) || NODE_ARTIFACT_NAME.test(targetName)) && (stat === undefined || stat.isFile())
        : rootName === ROOT_NAMES.npmCache && targetName === ''
  if (!nameAllowed) {
    issues.push(issue('delete-target-name-or-type-not-managed', target))
    return undefined
  }
  if (stat === undefined) return { target, stat: undefined }
  if (!walkSafe(runtimeRoot, target, issues)) return undefined
  return { target, stat }
}

/**
 * Apply a previously generated plan only after explicit caller confirmation.
 * The default is a second dry run. Every target is revalidated immediately
 * before deletion, including absolute containment and link/reparse checks.
 * @param {object} plan - Value returned by `planOpenClawRuntimeRetention`.
 * @param {object} [options]
 * @param {boolean} [options.confirm=false] - Explicit caller authorization for deletion.
 * @param {boolean} [options.dryRun=true] - Keep true to return the plan without deleting.
 * @param {boolean} [options.runtimeLockHeld=false] - The caller's shared OpenClaw runtime lock is held for the whole operation.
 * @returns {object} Execution result with removed targets or fail-closed issues.
 */
export function executeOpenClawRuntimeRetention(plan, { confirm = false, dryRun = true, runtimeLockHeld = false } = {}) {
  if (!validPlan(plan)) throw new TypeError('a valid OpenClaw retention plan is required')
  if (dryRun !== false) return { ...plan, executed: false }
  if (confirm !== true) throw new Error('explicit retention confirmation is required')
  if (plan.runtimeLockHeld !== true || runtimeLockHeld !== true) throw new Error('shared OpenClaw runtime lock is required')
  if (plan.status === 'blocked') return { ...plan, executed: false, status: 'blocked' }

  const runtimeRoot = resolve(plan.runtimeRoot)
  const freshPlan = planOpenClawRuntimeRetention({
    home: plan.home,
    includeNpmCache: plan.includeNpmCache,
    runtimeLockHeld: true,
    installerBusy: plan.installerBusy === true,
  })
  const issues = []
  const removed = []
  const skipped = []
  if (freshPlan.status === 'blocked') issues.push(issue('fresh-retention-plan-blocked', runtimeRoot))
  if (pathKey(freshPlan.runtimeRoot) !== pathKey(runtimeRoot)) issues.push(issue('fresh-runtime-root-mismatch', freshPlan.runtimeRoot))
  if (!sameSnapshot(plan.markerRevisions, freshPlan.markerRevisions)) issues.push(issue('marker-revision-changed-before-apply', runtimeRoot))
  if (!sameSnapshot(plan.retainedHeads, freshPlan.retainedHeads)) issues.push(issue('retained-heads-changed-before-apply', runtimeRoot))
  const freshTargetKeys = targetKeys(freshPlan.targets)
  for (const item of plan.targets) {
    if (typeof item?.path !== 'string' || !isAbsolute(item.path)) issues.push(issue('delete-target-is-not-absolute', item?.path))
    else if (!freshTargetKeys.has(pathKey(item.path))) issues.push(issue('plan-target-not-fresh-eligible', resolve(item.path)))
  }
  if (!sameTargetSet(plan.targets, freshPlan.targets)) issues.push(issue('retention-target-set-changed-before-apply', runtimeRoot))
  if (issues.length > 0) {
    return {
      schema: SCHEMA,
      status: 'blocked',
      dryRun: false,
      executed: false,
      runtimeRoot,
      removed,
      skipped,
      issues,
    }
  }
  const verifiedTargets = []
  for (const item of freshPlan.targets) {
    const verified = verifyDeleteTarget(runtimeRoot, item, issues)
    if (verified === undefined) continue
    if (verified.stat === undefined) skipped.push(verified.target)
    else verifiedTargets.push(verified)
  }
  if (issues.length > 0) {
    return {
      schema: SCHEMA,
      status: 'blocked',
      dryRun: false,
      executed: false,
      runtimeRoot,
      removed: [],
      skipped,
      issues,
    }
  }
  const expectedRemaining = new Set(freshPlan.targets.map((entry) => pathKey(entry.path)))
  for (const initial of verifiedTargets) {
    // Re-read every target after the complete preflight so an initial plan
    // tampering cannot cause a partial cleanup before a later invalid item is
    // discovered. The second check closes the normal plan-to-delete window.
    const currentPlan = planOpenClawRuntimeRetention({
      home: plan.home,
      includeNpmCache: plan.includeNpmCache,
      runtimeLockHeld: true,
      installerBusy: plan.installerBusy === true,
    })
    if (currentPlan.status === 'blocked'
      || !sameSnapshot(currentPlan.markerRevisions, freshPlan.markerRevisions)
      || !sameSnapshot(currentPlan.retainedHeads, freshPlan.retainedHeads)
      || !sameTargetSet(currentPlan.targets, [...expectedRemaining].map((path) => ({ path })))) {
      issues.push(issue('retention-references-changed-before-delete', runtimeRoot))
      break
    }
    const verified = verifyDeleteTarget(runtimeRoot, { path: initial.target }, issues)
    if (verified === undefined) break
    if (verified.stat === undefined) {
      skipped.push(verified.target)
      continue
    }
    try {
      // recursive is enabled only after the absolute target and every child
      // have passed the link/reparse and root containment checks above.
      rmSync(verified.target, {
        recursive: verified.stat.isDirectory(),
        force: false,
        maxRetries: 3,
        retryDelay: 250,
      })
      removed.push(verified.target)
      expectedRemaining.delete(pathKey(verified.target))
    } catch (error) {
      issues.push(issue('delete-failed', verified.target, error?.code ?? String(error)))
    }
  }
  return {
    schema: SCHEMA,
    status: issues.length > 0 ? 'blocked' : 'applied',
    dryRun: false,
    executed: true,
    runtimeRoot,
    removed,
    skipped,
    issues,
  }
}

/**
 * Apply a retention plan with the explicit execution API.
 * @param {object} plan - Value returned by `planOpenClawRuntimeRetention`.
 * @param {object} [options]
 * @param {boolean} [options.confirm=false] - Explicit caller authorization for deletion.
 * @param {boolean} [options.runtimeLockHeld=false] - The caller's shared OpenClaw runtime lock is held for the whole operation.
 * @returns {object} The non-dry-run execution result.
 */
export function applyOpenClawRuntimeRetention(plan, options = {}) {
  return executeOpenClawRuntimeRetention(plan, { ...options, dryRun: false })
}
